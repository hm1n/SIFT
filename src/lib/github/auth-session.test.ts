import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
  GITHUB_SESSION_MAX_AGE_SECONDS,
  encryptGitHubSession,
  getGitHubSessionFromRequest,
  getGitHubTokenFromRequest,
} from "./auth-session";

const TOKEN = "github_pat_sensitive";
const USER_ID = 44727850;

function encrypt(token: string, githubUserId = USER_ID) {
  return encryptGitHubSession({ token, githubUserId });
}

/**
 * 사용자 번호가 없던 형식의 쿠키입니다. `[발급 시각 8바이트][토큰]`이고 형식 번호가 없습니다.
 * 같은 키로 만들었으므로 복호화와 GCM 인증 태그 검사는 통과합니다.
 */
function legacyCookie(token: string): string {
  const issuedAt = Buffer.alloc(8);
  issuedAt.writeBigUInt64BE(BigInt(Date.now()));
  const iv = randomBytes(12);
  const key = Buffer.from(process.env[GITHUB_SESSION_KEY_ENV] as string, "base64");
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.concat([issuedAt, Buffer.from(token, "utf8")])), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

beforeEach(() => {
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  delete process.env[GITHUB_SESSION_KEY_ENV];
  vi.useRealTimers();
});

function requestWith(value: string) {
  return new NextRequest("https://example.com", { headers: { cookie: `${GITHUB_SESSION_COOKIE}=${value}` } });
}

describe("GitHub 인증 세션", () => {
  it("요청 쿠키의 암호화된 값에서만 토큰을 읽는다", () => {
    const encrypted = encrypt(TOKEN);
    const request = new NextRequest("https://example.com", { headers: { cookie: `${GITHUB_SESSION_COOKIE}=${encrypted}` } });
    expect(encrypted).not.toContain(TOKEN);
    expect(getGitHubTokenFromRequest(request)).toBe(TOKEN);
  });

  it("쿠키가 없으면 기존 auth_revoked 오류를 던진다", () => {
    const request = new NextRequest("https://example.com", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(() => getGitHubTokenFromRequest(request)).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  it("변조된 쿠키는 auth_revoked 오류로 처리한다", () => {
    const request = new NextRequest("https://example.com", { headers: { cookie: `${GITHUB_SESSION_COOKIE}=tampered` } });
    expect(() => getGitHubTokenFromRequest(request)).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  // 쿠키 값을 복사해 두면 `Max-Age`가 지나도 브라우저 밖에서 그대로 재생할 수 있습니다.
  // 수명은 서버가 판단해야 합니다.
  it("수명이 지난 값을 복사해 다시 보내면 auth_revoked 오류로 처리한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T00:00:00Z"));
    const encrypted = encrypt(TOKEN);
    expect(getGitHubTokenFromRequest(requestWith(encrypted))).toBe(TOKEN);

    vi.advanceTimersByTime(GITHUB_SESSION_MAX_AGE_SECONDS * 1000 - 1000);
    expect(getGitHubTokenFromRequest(requestWith(encrypted))).toBe(TOKEN);

    vi.advanceTimersByTime(2000);
    expect(() => getGitHubTokenFromRequest(requestWith(encrypted))).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  it("발급 시각이 미래인 값은 auth_revoked 오류로 처리한다", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00Z"));
    const encrypted = encrypt(TOKEN);
    vi.setSystemTime(new Date("2026-08-27T11:00:00Z"));
    expect(() => getGitHubTokenFromRequest(requestWith(encrypted))).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  it("토큰과 사용자 번호를 함께 싣고 그대로 돌려준다", () => {
    const encrypted = encrypt(TOKEN);
    expect(encrypted).not.toContain(String(USER_ID));
    expect(getGitHubSessionFromRequest(requestWith(encrypted))).toEqual({ token: TOKEN, githubUserId: USER_ID });
  });

  /**
   * 사용자 번호가 없던 형식은 복호화 자체는 성공합니다. 형식 번호로 걸러내지 않으면 토큰 앞부분을
   * 사용자 번호로 읽고 잘린 토큰을 그대로 쓰게 됩니다.
   */
  it("사용자 번호가 없던 형식의 쿠키는 auth_revoked로 처리해 다시 로그인시킨다", () => {
    const request = requestWith(legacyCookie(TOKEN));
    expect(() => getGitHubSessionFromRequest(request)).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  it("사용자 번호가 없던 형식의 쿠키에서 잘린 토큰을 돌려주지 않는다", () => {
    const request = requestWith(legacyCookie(TOKEN));
    expect(() => getGitHubTokenFromRequest(request)).toThrow(expect.objectContaining({ kind: "auth_revoked" }));
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])("사용자 번호가 %s이면 세션을 발급하지 않는다", (githubUserId) => {
    expect(() => encrypt(TOKEN, githubUserId)).toThrow(expect.objectContaining({ kind: "server_error" }));
  });
});

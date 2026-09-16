import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { GitHubFetchError } from "./errors";

export const GITHUB_SESSION_COOKIE = "github_session";
export const GITHUB_SESSION_KEY_ENV = "GITHUB_SESSION_ENCRYPTION_KEY";
export const GITHUB_SESSION_MAX_AGE_SECONDS = 28800;

const COOKIE_OPTIONS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function createGitHubSessionCookie(value: string): string {
  return `${GITHUB_SESSION_COOKIE}=${value}; ${COOKIE_OPTIONS}; Max-Age=${GITHUB_SESSION_MAX_AGE_SECONDS}`;
}

export function deleteGitHubSessionCookie(): string {
  return `${GITHUB_SESSION_COOKIE}=; ${COOKIE_OPTIONS}; Max-Age=0`;
}

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const VERSION_LENGTH = 1;
const ISSUED_AT_LENGTH = 8;
const USER_ID_LENGTH = 8;
const HEADER_LENGTH = VERSION_LENGTH + ISSUED_AT_LENGTH + USER_ID_LENGTH;

/**
 * 평문 머리의 형식 번호입니다.
 *
 * 사용자 번호가 없던 형식의 쿠키는 복호화가 실패하지 않습니다. 암호화 키가 같고 GCM 인증 태그도
 * 맞으므로 유효한 값으로 통과하고, 바이트를 자르는 위치만 달라집니다. 그러면 토큰 앞부분을 사용자
 * 번호로 읽고 토큰은 앞이 잘린 채 남아, 조용히 틀린 값으로 GitHub를 호출하게 됩니다. 이 한 바이트가
 * 그 경우를 구분하는 유일한 근거입니다.
 */
const SESSION_VERSION = 1;

export interface GitHubSession {
  readonly token: string;
  /**
   * GitHub 사용자 번호입니다. 아이디 문자열은 사용자가 바꿀 수 있어서 저장 키로 쓰면 이름을 바꾸는
   * 순간 자기 데이터를 잃습니다. 번호는 바뀌지 않습니다.
   */
  readonly githubUserId: number;
}

/** 64비트로 실어 나르지만 JSON과 JavaScript 정수 범위를 벗어난 값은 받지 않습니다. */
function assertUserId(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GitHubFetchError("server_error", "The GitHub user id is not valid.");
  }
}

function encryptionKey(): Buffer {
  const encodedKey = process.env[GITHUB_SESSION_KEY_ENV];
  if (!encodedKey) throw new GitHubFetchError("server_error", "The GitHub session encryption key is not configured.");

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new GitHubFetchError("server_error", "The GitHub session encryption key must be a base64-encoded 32-byte value.");
  }
  return key;
}

/**
 * 형식 번호와 발급 시각과 사용자 번호를 평문 앞에 붙여 함께 암호화합니다.
 *
 * 발급 시각을 넣는 이유는 이렇습니다. 쿠키의 `Max-Age`는 브라우저에게만 하는 부탁이라 값을 복사해
 * 두면 만료 뒤에도 그대로 씁니다. 서버가 수명을 판단할 근거는 요청에 실려 온 값 안에만 있을 수
 * 있습니다. GCM 인증 태그가 평문 전체를 덮으므로 이 세 값은 모두 변조되지 않습니다.
 */
export function encryptGitHubSession(session: GitHubSession): string {
  assertUserId(session.githubUserId);
  const header = Buffer.alloc(HEADER_LENGTH);
  header.writeUInt8(SESSION_VERSION, 0);
  header.writeBigUInt64BE(BigInt(Date.now()), VERSION_LENGTH);
  header.writeBigUInt64BE(BigInt(session.githubUserId), VERSION_LENGTH + ISSUED_AT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const plaintext = Buffer.concat([header, Buffer.from(session.token, "utf8")]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptGitHubSession(value: string): GitHubSession {
  try {
    const payload = Buffer.from(value, "base64url");
    if (payload.length <= IV_LENGTH + TAG_LENGTH + HEADER_LENGTH) throw new Error("Invalid session payload");
    const iv = payload.subarray(0, IV_LENGTH);
    const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(payload.subarray(IV_LENGTH + TAG_LENGTH)), decipher.final()]);
    // 사용자 번호가 없던 형식입니다. 다시 로그인시켜야 합니다. 자세한 근거는 SESSION_VERSION 주석에 있습니다.
    if (plaintext.readUInt8(0) !== SESSION_VERSION) throw new Error("Unsupported session version");
    const age = Date.now() - Number(plaintext.readBigUInt64BE(VERSION_LENGTH));
    if (age < 0 || age > GITHUB_SESSION_MAX_AGE_SECONDS * 1000) throw new Error("Expired session");
    const githubUserId = Number(plaintext.readBigUInt64BE(VERSION_LENGTH + ISSUED_AT_LENGTH));
    if (!Number.isSafeInteger(githubUserId) || githubUserId <= 0) throw new Error("Invalid GitHub user id");
    return { token: plaintext.subarray(HEADER_LENGTH).toString("utf8"), githubUserId };
  } catch (error) {
    if (error instanceof GitHubFetchError) throw error;
    throw new GitHubFetchError("auth_revoked", "The GitHub sign-in session is missing or invalid.");
  }
}

export function getGitHubSessionFromRequest(request: NextRequest): GitHubSession {
  const encryptedSession = request.cookies.get(GITHUB_SESSION_COOKIE)?.value;
  if (!encryptedSession) throw new GitHubFetchError("auth_revoked", "There is no GitHub sign-in session.");
  return decryptGitHubSession(encryptedSession);
}

export function getGitHubTokenFromRequest(request: NextRequest): string {
  return getGitHubSessionFromRequest(request).token;
}

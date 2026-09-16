import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GA_USER_ID_SECRET_ENV, toAnalyticsUserId } from "./user-id";

const GITHUB_USER_ID = 1234567;
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes(".test.")) return [];
    return [full];
  });
}

afterEach(() => {
  delete process.env[GA_USER_ID_SECRET_ENV];
});

describe("toAnalyticsUserId", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("returns null when the secret is %s", (_label, value) => {
    if (value !== undefined) process.env[GA_USER_ID_SECRET_ENV] = value;
    expect(toAnalyticsUserId(GITHUB_USER_ID)).toBeNull();
  });

  /** 재방문과 기기 간 집계가 성립하려면 같은 사용자가 언제나 같은 값이어야 합니다. */
  it("returns the same value for the same user", () => {
    process.env[GA_USER_ID_SECRET_ENV] = "secret";
    expect(toAnalyticsUserId(GITHUB_USER_ID)).toBe(toAnalyticsUserId(GITHUB_USER_ID));
  });

  it("returns different values for different users", () => {
    process.env[GA_USER_ID_SECRET_ENV] = "secret";
    expect(toAnalyticsUserId(GITHUB_USER_ID)).not.toBe(toAnalyticsUserId(GITHUB_USER_ID + 1));
  });

  /** 비밀값이 바뀌면 같은 사용자가 다른 사람으로 집계됩니다. 유출 사고가 아닌 한 교체하지 않는 근거입니다. */
  it("returns a different value when the secret changes", () => {
    process.env[GA_USER_ID_SECRET_ENV] = "secret";
    const before = toAnalyticsUserId(GITHUB_USER_ID);
    process.env[GA_USER_ID_SECRET_ENV] = "another-secret";
    expect(toAnalyticsUserId(GITHUB_USER_ID)).not.toBe(before);
  });

  /**
   * 원본 GitHub 사용자 번호가 결과에 남으면 안 됩니다. 이 번호를 GitHub 공개 API에 넣으면 계정
   * 아이디가 그대로 나오므로, 남으면 이슈 #125가 금지한 로그인 아이디를 함께 보내는 것이 됩니다.
   */
  it("does not leak the original GitHub user id and fits the GA4 value limit", () => {
    process.env[GA_USER_ID_SECRET_ENV] = "secret";
    const userId = toAnalyticsUserId(GITHUB_USER_ID);
    expect(userId).not.toContain(String(GITHUB_USER_ID));
    expect(userId).toMatch(/^[0-9a-f]{64}$/);
    expect(userId!.length).toBeLessThanOrEqual(100);
  });

  /**
   * `NEXT_PUBLIC_` 접두사가 붙으면 Next.js가 클라이언트 번들에 인라인해 누구나 같은 해시를 계산할
   * 수 있고, 그러면 변환의 의미가 사라집니다(이슈 #125 제약).
   */
  it("uses a server-only environment variable name", () => {
    expect(GA_USER_ID_SECRET_ENV.startsWith("NEXT_PUBLIC_")).toBe(false);
  });

  /**
   * 이 모듈을 클라이언트 컴포넌트가 가져오면 번들러가 따라 들어가 비밀값을 읽는 코드가 브라우저로
   * 넘어갑니다. `node:crypto` 때문에 빌드가 깨질 수도 있지만, 깨지지 않는 경로가 생기더라도
   * 서버에서만 부른다는 경계는 남아야 하므로 소스로 고정합니다.
   */
  it("is not imported by any client component", () => {
    const files = sourceFiles(SRC);
    // 훑을 파일이 없으면 통과가 아니라 탐색이 깨진 것입니다.
    expect(files.length).toBeGreaterThan(10);
    const importers = files.filter((path) => readFileSync(path, "utf8").includes("@/lib/analytics/user-id"));
    expect(importers.length).toBeGreaterThan(0);
    for (const path of importers) {
      expect(readFileSync(path, "utf8").trimStart().startsWith('"use client"')).toBe(false);
    }
  });
});

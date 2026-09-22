import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DAILY_ANALYSIS_LIMIT } from "@/features/usage-limit/quota";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import { DatabaseError } from "@/lib/db/client";
import { handleGetAnalysisUsage } from "./route";

const USER_ID = 4472785;
/** 한국 시간 2026-09-22 정오입니다. 날짜 경계에서 멀리 떨어진 시각을 고릅니다. */
const NOON_KST = Date.parse("2026-09-22T03:00:00Z");

function request(githubUserId: number | null = USER_ID) {
  return new NextRequest("https://example.com/api/usage/analysis", {
    method: "GET",
    headers:
      githubUserId === null
        ? undefined
        : { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId })}` },
  });
}

beforeEach(() => {
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  delete process.env[GITHUB_SESSION_KEY_ENV];
});

describe("GET /api/usage/analysis", () => {
  it("아직 한 번도 안 돌렸으면 0이다", async () => {
    const response = await handleGetAnalysisUsage(request(), createInMemoryStore(), () => NOON_KST);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      used: 0,
      limit: DAILY_ANALYSIS_LIMIT,
      // 한국 시간 2026-09-23 자정입니다.
      resetAt: "2026-09-22T15:00:00.000Z",
    });
  });

  it("쓴 만큼을 돌려준다", async () => {
    const store = createInMemoryStore();
    await store.consumeAnalysisQuota(USER_ID, "2026-09-22", DAILY_ANALYSIS_LIMIT);
    await store.consumeAnalysisQuota(USER_ID, "2026-09-22", DAILY_ANALYSIS_LIMIT);

    const response = await handleGetAnalysisUsage(request(), store, () => NOON_KST);

    expect(await response.json()).toMatchObject({ used: 2 });
  });

  /**
   * 화면을 그리는 것만으로 횟수가 줄면 안 됩니다. 읽기만 하는 연산과 쓰는 연산을 나눠 둔 이유입니다.
   */
  it("읽어도 횟수가 늘지 않는다", async () => {
    const store = createInMemoryStore();
    for (let i = 0; i < 5; i += 1) {
      await handleGetAnalysisUsage(request(), store, () => NOON_KST);
    }

    expect(await store.getAnalysisQuotaUsage(USER_ID, "2026-09-22")).toBe(0);
    // 다섯 번 읽었어도 상한만큼 그대로 쓸 수 있습니다.
    expect(await store.consumeAnalysisQuota(USER_ID, "2026-09-22", DAILY_ANALYSIS_LIMIT)).toBe(1);
  });

  it("남의 횟수를 돌려주지 않는다", async () => {
    const store = createInMemoryStore();
    await store.consumeAnalysisQuota(USER_ID + 1, "2026-09-22", DAILY_ANALYSIS_LIMIT);

    const response = await handleGetAnalysisUsage(request(), store, () => NOON_KST);

    expect(await response.json()).toMatchObject({ used: 0 });
  });

  it("한국 자정을 넘기면 다른 날로 센다", async () => {
    const store = createInMemoryStore();
    await store.consumeAnalysisQuota(USER_ID, "2026-09-22", DAILY_ANALYSIS_LIMIT);

    const sameDay = await handleGetAnalysisUsage(request(), store, () =>
      Date.parse("2026-09-22T14:59:59.999Z")
    );
    const nextDay = await handleGetAnalysisUsage(request(), store, () =>
      Date.parse("2026-09-22T15:00:00Z")
    );

    expect(await sameDay.json()).toMatchObject({ used: 1 });
    expect(await nextDay.json()).toMatchObject({ used: 0, resetAt: "2026-09-23T15:00:00.000Z" });
  });

  it("세션이 없으면 401이다", async () => {
    const response = await handleGetAnalysisUsage(request(null), createInMemoryStore(), () => NOON_KST);

    expect(response.status).toBe(401);
  });

  it("저장 계층이 실패하면 오류 봉투로 돌려준다", async () => {
    const store: SiftStore = {
      ...createInMemoryStore(),
      async getAnalysisQuotaUsage() {
        throw new DatabaseError("query_failed", "데이터베이스 질의에 실패했습니다.");
      },
    };

    const response = await handleGetAnalysisUsage(request(), store, () => NOON_KST);

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(await response.json()).toMatchObject({ error: { kind: expect.any(String) } });
  });
});

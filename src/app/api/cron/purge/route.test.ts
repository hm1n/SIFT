import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RETENTION_DAYS } from "@/features/saved-interviews/retention";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import { handlePurge } from "./route";

const SECRET = "cron-secret-value";
const OWNER_ID = 44727850;
const DAY_MS = 86_400_000;

let savedSecret: string | undefined;

beforeEach(() => {
  savedSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
  vi.useRealTimers();
});

function request(authorization: string | null = `Bearer ${SECRET}`): NextRequest {
  return new NextRequest("https://example.com/api/cron/purge", {
    headers: authorization === null ? {} : { authorization },
  });
}

async function seed(store: SiftStore): Promise<{ analysisId: string; interviewId: string }> {
  const analysisId = await store.saveAnalysis({
    githubUserId: OWNER_ID,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: [],
    candidates: {},
    stageASummary: {},
  });
  const interviewId = await store.createInterview({
    githubUserId: OWNER_ID,
    analysisId,
    candidateKey: "c1",
    title: "스트리밍 렌더링 최적화",
    evidence: {},
  });
  if (interviewId === null) throw new Error("seed failed");
  return { analysisId, interviewId };
}

describe("GET /api/cron/purge", () => {
  it("헤더가 없으면 401이고 아무것도 지우지 않는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handlePurge(request(null), store);

    expect(response.status).toBe(401);
    expect(await store.getInterview(interviewId, OWNER_ID)).not.toBeNull();
  });

  it("헤더 값이 다르면 401이다", async () => {
    // 헤더는 ByteString이라 한글을 담을 수 없습니다. 값이 다르다는 것만 보면 됩니다.
    const response = await handlePurge(request("Bearer another-secret"), createInMemoryStore());

    expect(response.status).toBe(401);
  });

  /**
   * 값을 두지 않은 배포에서 통과시키면 이 경로가 아무에게나 열립니다. 지우는 일이라 되돌릴 수 없습니다.
   */
  it("CRON_SECRET이 없으면 열지 않는다", async () => {
    delete process.env.CRON_SECRET;

    const response = await handlePurge(request("Bearer undefined"), createInMemoryStore());

    expect(response.status).toBe(401);
  });

  it("90일 동안 열지 않은 인터뷰를 지운다", async () => {
    vi.useFakeTimers();
    const store = createInMemoryStore();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const old = await seed(store);
    vi.setSystemTime(new Date(Date.parse("2026-01-01T00:00:00Z") + (RETENTION_DAYS + 1) * DAY_MS));
    const fresh = await seed(store);

    const body = await (await handlePurge(request(), store)).json();

    expect(body.interviews).toBe(1);
    expect(await store.getInterview(old.interviewId, OWNER_ID)).toBeNull();
    expect(await store.getInterview(fresh.interviewId, OWNER_ID)).not.toBeNull();
  });

  /**
   * 인터뷰를 여는 것이 기준을 갱신합니다. 매일 여는 인터뷰가 만든 지 90일이 지났다고 사라지면
   * 사용자는 쓰고 있던 것을 잃습니다.
   */
  it("최근에 연 인터뷰는 오래된 것이어도 남긴다", async () => {
    vi.useFakeTimers();
    const store = createInMemoryStore();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { interviewId } = await seed(store);
    vi.setSystemTime(new Date(Date.parse("2026-01-01T00:00:00Z") + (RETENTION_DAYS + 1) * DAY_MS));
    await store.getInterview(interviewId, OWNER_ID);

    const body = await (await handlePurge(request(), store)).json();

    expect(body.interviews).toBe(0);
    expect(await store.getInterview(interviewId, OWNER_ID)).not.toBeNull();
  });

  /**
   * `repository_analysis` → `interview_session`만 cascade이고 반대 방향은 없습니다. 인터뷰를 지우는
   * 경로가 분석을 남기면 근거 스냅샷 속 비공개 코드가 그대로 남습니다.
   */
  it("딸린 인터뷰가 모두 사라진 오래된 분석을 함께 지운다", async () => {
    vi.useFakeTimers();
    const store = createInMemoryStore();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { analysisId } = await seed(store);
    vi.setSystemTime(new Date(Date.parse("2026-01-01T00:00:00Z") + (RETENTION_DAYS + 1) * DAY_MS));

    const body = await (await handlePurge(request(), store)).json();

    expect(body).toMatchObject({ interviews: 1, analyses: 1 });
    expect(await store.getAnalysis(analysisId, OWNER_ID)).toBeNull();
  });

  /** 경험을 아직 고르지 않은 분석입니다. 사용자가 후보를 고르는 사이에 사라지면 안 됩니다. */
  it("인터뷰가 없어도 최근에 저장한 분석은 남긴다", async () => {
    const store = createInMemoryStore();
    const analysisId = await store.saveAnalysis({
      githubUserId: OWNER_ID,
      repoOwner: "hm1n",
      repoName: "SIFT",
      contributionItems: [],
      candidates: {},
      stageASummary: {},
    });

    const body = await (await handlePurge(request(), store)).json();

    expect(body.analyses).toBe(0);
    expect(await store.getAnalysis(analysisId, OWNER_ID)).not.toBeNull();
  });

  it("인터뷰가 남아 있는 분석은 지우지 않는다", async () => {
    vi.useFakeTimers();
    const store = createInMemoryStore();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { analysisId, interviewId } = await seed(store);
    // 인터뷰는 계속 열고 있어 정리 대상이 아닙니다.
    vi.setSystemTime(new Date(Date.parse("2026-01-01T00:00:00Z") + (RETENTION_DAYS + 1) * DAY_MS));
    await store.getInterview(interviewId, OWNER_ID);

    const body = await (await handlePurge(request(), store)).json();

    expect(body.analyses).toBe(0);
    expect(await store.getAnalysis(analysisId, OWNER_ID)).not.toBeNull();
  });

  it("기준 시각을 응답에 싣는다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:00:00Z"));

    const body = await (await handlePurge(request(), createInMemoryStore())).json();

    expect(body.before).toBe(new Date(Date.parse("2026-09-15T00:00:00Z") - RETENTION_DAYS * DAY_MS).toISOString());
  });

  it("저장 계층이 실패하면 503이다", async () => {
    const fail = async () => {
      throw new DatabaseError("query_failed", "흉내 낸 오류");
    };
    const store = { purgeInterviewsOpenedBefore: fail, purgeAnalysesWithoutInterviews: fail } as unknown as SiftStore;

    const response = await handlePurge(request(), store);

    expect(response.status).toBe(503);
  });
});

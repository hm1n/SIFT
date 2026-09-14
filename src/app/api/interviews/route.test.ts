import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { MAX_CREATE_INTERVIEW_BODY_BYTES } from "@/features/saved-interviews/request";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import { DatabaseError } from "@/lib/db/client";
import type { SiftStore } from "@/lib/db/store";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleCreateInterview, handleListInterviews } from "./route";
import { emptyInterviewProgress } from "@/features/experience-block/progress";

const OWNER_ID = 44727850;
const OTHER_ID = 13579246;
const snapshot = evidenceSnapshotFixture();

/**
 * 셸에 남아 있던 값을 잃지 않게 시작할 때 치우고 끝나면 되돌립니다. `client.test.ts`와 같은 방식입니다.
 */
let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[GITHUB_SESSION_KEY_ENV];
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[GITHUB_SESSION_KEY_ENV];
  else process.env[GITHUB_SESSION_KEY_ENV] = savedKey;
});

function cookieFor(githubUserId: number): string {
  return `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId })}`;
}

function request(
  body: unknown,
  { userId = OWNER_ID, authenticated = true, method = "POST", headers = {} }: {
    userId?: number;
    authenticated?: boolean;
    method?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  return new NextRequest("https://example.com/api/interviews", {
    method,
    headers: { ...(authenticated ? { cookie: cookieFor(userId) } : {}), ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const ANALYSIS = {
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: ["성능 개선"],
  candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
  stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
};

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    analysis: ANALYSIS,
    candidateKey: "c1",
    title: "스트리밍 렌더링 최적화",
    evidence: snapshot,
    ...overrides,
  };
}

/** 언제나 오류를 던지는 저장 계층입니다. 연결이 끊긴 상태를 흉내 냅니다. */
function brokenStore(kind: "query_failed" | "config_missing"): SiftStore {
  const fail = async () => {
    throw new DatabaseError(kind, "흉내 낸 오류");
  };
  return {
    saveAnalysis: fail, createInterview: fail, appendTurn: fail, listInterviews: fail,
    getInterview: fail, deleteInterview: fail, purgeInterviewsOpenedBefore: fail,
  } as unknown as SiftStore;
}

describe("POST /api/interviews", () => {
  it("분석 한 줄과 인터뷰 한 줄을 함께 만든다", async () => {
    const store = createInMemoryStore();
    const response = await handleCreateInterview(request(createBody()), store);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.interviewId).toBe("string");
    expect(typeof body.analysisId).toBe("string");

    const stored = await store.getInterview(body.interviewId, OWNER_ID);
    expect(stored).toMatchObject({ repoOwner: "hm1n", repoName: "SIFT", title: "스트리밍 렌더링 최적화" });
  });

  /**
   * 확정할 때마다 분석을 새로 저장하면 같은 분석이 여러 줄로 쌓이고, 목록에 같은 저장소가 여러 번
   * 나오며, 후보 화면을 복원할 때 어느 줄이 진짜인지 알 수 없게 됩니다.
   */
  it("분석 식별자를 보내면 같은 분석에 인터뷰를 하나 더 붙인다", async () => {
    const store = createInMemoryStore();
    const first = await (await handleCreateInterview(request(createBody()), store)).json();
    const second = await (
      await handleCreateInterview(request(createBody({ analysisId: first.analysisId, candidateKey: "c2" })), store)
    ).json();

    expect(second.analysisId).toBe(first.analysisId);
    expect(second.interviewId).not.toBe(first.interviewId);
    expect((await store.listInterviews(OWNER_ID))).toHaveLength(2);
  });

  /**
   * 지워졌거나 남의 분석을 가리키는 식별자입니다. 요청이 분석 결과를 함께 들고 왔으므로 새 줄을
   * 만들면 되고, 만든 줄은 요청한 사람의 것이라 남의 데이터에 닿지 않습니다.
   */
  it("남의 분석 식별자를 보내면 그 분석에 붙이지 않고 새로 저장한다", async () => {
    const store = createInMemoryStore();
    const mine = await (await handleCreateInterview(request(createBody()), store)).json();

    const theirs = await (
      await handleCreateInterview(request(createBody({ analysisId: mine.analysisId }), { userId: OTHER_ID }), store)
    ).json();

    expect(theirs.analysisId).not.toBe(mine.analysisId);
    expect(await store.listInterviews(OWNER_ID)).toHaveLength(1);
    expect(await store.listInterviews(OTHER_ID)).toHaveLength(1);
  });

  it("세션이 없으면 401이다", async () => {
    const response = await handleCreateInterview(request(createBody(), { authenticated: false }), createInMemoryStore());
    expect(response.status).toBe(401);
    expect((await response.json()).error.kind).toBe("unauthorized");
  });

  it("JSON이 아니면 400이다", async () => {
    const response = await handleCreateInterview(request("{"), createInMemoryStore());
    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("invalid_json");
  });

  it.each([
    ["analysis가 없으면", { analysis: undefined }],
    ["저장소 이름이 비었으면", { analysis: { ...ANALYSIS, repoOwner: " " } }],
    ["기여 항목이 문자열 배열이 아니면", { analysis: { ...ANALYSIS, contributionItems: [1] } }],
    ["candidateKey가 없으면", { candidateKey: "" }],
    ["title이 없으면", { title: "  " }],
    ["근거 스냅샷 모양이 아니면", { evidence: { 이상한: "값" } }],
  ])("%s 400이다", async (_label, overrides) => {
    const response = await handleCreateInterview(request(createBody(overrides)), createInMemoryStore());
    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("invalid_request");
  });

  it("선언한 길이가 상한을 넘으면 본문을 읽기 전에 413이다", async () => {
    const response = await handleCreateInterview(
      request(createBody(), { headers: { "content-length": String(MAX_CREATE_INTERVIEW_BODY_BYTES + 1) } }),
      createInMemoryStore()
    );
    expect(response.status).toBe(413);
  });

  // 연결이 끊긴 것은 다시 시도할 여지가 있고 설정이 없는 것은 없습니다. 두 갈래를 나눕니다.
  it.each([
    ["query_failed", 503, "storage_failed"],
    ["config_missing", 500, "server_error"],
  ] as const)("저장 계층이 %s를 던지면 %i이다", async (kind, status, errorKind) => {
    const response = await handleCreateInterview(request(createBody()), brokenStore(kind));
    expect(response.status).toBe(status);
    expect((await response.json()).error.kind).toBe(errorKind);
  });
});

describe("GET /api/interviews", () => {
  it("마지막으로 이어간 시각이 최근인 순서로 돌려준다", async () => {
    const store = createInMemoryStore();
    const first = await (await handleCreateInterview(request(createBody({ title: "먼저" })), store)).json();
    const second = await (await handleCreateInterview(request(createBody({ title: "나중" })), store)).json();
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId: second.interviewId,
      turn: [{ role: "answer", text: "답변" }],
      blockState: { version: 1 } as never,
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    const body = await (await handleListInterviews(request(null, { method: "GET" }), store)).json();

    expect(body.interviews.map((item: { title: string }) => item.title)).toEqual(["나중", "먼저"]);
    expect(body.interviews[1].id).toBe(first.interviewId);
  });

  // JSON에는 날짜 타입이 없습니다. 타입만 `Date`로 남으면 받는 쪽이 `getTime()`을 부르다 깨집니다.
  it("시각을 ISO 문자열로 내보내고 openedAt은 싣지 않는다", async () => {
    const store = createInMemoryStore();
    await handleCreateInterview(request(createBody()), store);

    const [item] = (await (await handleListInterviews(request(null, { method: "GET" }), store)).json()).interviews;

    expect(typeof item.createdAt).toBe("string");
    expect(new Date(item.updatedAt).toISOString()).toBe(item.updatedAt);
    expect(item).not.toHaveProperty("openedAt");
  });

  it("다른 사용자의 인터뷰는 목록에 없다", async () => {
    const store = createInMemoryStore();
    await handleCreateInterview(request(createBody()), store);

    const body = await (await handleListInterviews(request(null, { method: "GET", userId: OTHER_ID }), store)).json();
    expect(body.interviews).toEqual([]);
  });

  it("세션이 없으면 401이다", async () => {
    const response = await handleListInterviews(request(null, { method: "GET", authenticated: false }), createInMemoryStore());
    expect(response.status).toBe(401);
  });

  it("저장 계층이 끊기면 503이다", async () => {
    const response = await handleListInterviews(request(null, { method: "GET" }), brokenStore("query_failed"));
    expect(response.status).toBe(503);
  });
});

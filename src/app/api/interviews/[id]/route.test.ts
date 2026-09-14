import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleDeleteInterview, handleGetInterview } from "./route";

const OWNER_ID = 44727850;
const OTHER_ID = 13579246;

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[GITHUB_SESSION_KEY_ENV];
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[GITHUB_SESSION_KEY_ENV];
  else process.env[GITHUB_SESSION_KEY_ENV] = savedKey;
});

function request(
  { userId = OWNER_ID, authenticated = true, method = "GET" }: {
    userId?: number;
    authenticated?: boolean;
    method?: string;
  } = {}
): NextRequest {
  return new NextRequest("https://example.com/api/interviews/x", {
    method,
    headers: authenticated
      ? { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId: userId })}` }
      : {},
  });
}

async function seed(store: SiftStore, githubUserId = OWNER_ID) {
  const analysisId = await store.saveAnalysis({
    githubUserId,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: [],
    candidates: {},
    stageASummary: {},
  });
  const interviewId = await store.createInterview({
    githubUserId,
    analysisId,
    candidateKey: "c1",
    title: "스트리밍 렌더링 최적화",
    evidence: { commits: ["sha-1"] },
  });
  if (interviewId === null) throw new Error("seed failed");
  return { analysisId, interviewId };
}

function brokenStore(): SiftStore {
  const fail = async () => {
    throw new DatabaseError("query_failed", "흉내 낸 오류");
  };
  return {
    saveAnalysis: fail, createInterview: fail, appendTurn: fail, listInterviews: fail,
    getInterview: fail, deleteInterview: fail, purgeInterviewsOpenedBefore: fail,
  } as unknown as SiftStore;
}

describe("GET /api/interviews/[id]", () => {
  it("저장된 대화와 블록 상태와 근거를 돌려준다", async () => {
    const store = createInMemoryStore();
    const { interviewId, analysisId } = await seed(store);
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "question", text: "질문" }, { role: "answer", text: "답변" }],
      blockState: { ...emptyExperienceBlockState(), version: 1 },
      expectedBlockVersion: 0,
    });

    const body = await (await handleGetInterview(request(), interviewId, store)).json();

    expect(body.interview).toMatchObject({
      id: interviewId,
      analysisId,
      candidateKey: "c1",
      repoOwner: "hm1n",
      repoName: "SIFT",
      blockVersion: 1,
      evidence: { commits: ["sha-1"] },
    });
    expect(body.interview.history).toEqual([
      { role: "question", text: "질문" },
      { role: "answer", text: "답변" },
    ]);
  });

  /**
   * 없는 것과 남의 것을 구분해 알려 주면 다른 사람의 인터뷰가 있는지 없는지를 알 수 있게 됩니다.
   */
  it.each([
    ["다른 사용자의 인터뷰", OTHER_ID],
  ])("%s는 404다", async (_label, userId) => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handleGetInterview(request({ userId }), interviewId, store);
    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("not_found");
  });

  it("없는 인터뷰는 404다", async () => {
    const store = createInMemoryStore();
    const response = await handleGetInterview(request(), "11111111-1111-4111-8111-111111111111", store);
    expect(response.status).toBe(404);
  });

  it("uuid가 아닌 식별자도 404다", async () => {
    const store = createInMemoryStore();
    const response = await handleGetInterview(request(), "없는-값", store);
    expect(response.status).toBe(404);
  });

  it("세션이 없으면 401이다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    const response = await handleGetInterview(request({ authenticated: false }), interviewId, store);
    expect(response.status).toBe(401);
  });

  it("저장 계층이 끊기면 503이다", async () => {
    const response = await handleGetInterview(request(), "11111111-1111-4111-8111-111111111111", brokenStore());
    expect(response.status).toBe(503);
  });
});

describe("DELETE /api/interviews/[id]", () => {
  it("지우면 204이고 목록에서 사라진다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handleDeleteInterview(request({ method: "DELETE" }), interviewId, store);

    expect(response.status).toBe(204);
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
  });

  it("다른 사용자의 인터뷰는 지우지 못하고 404다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handleDeleteInterview(request({ method: "DELETE", userId: OTHER_ID }), interviewId, store);

    expect(response.status).toBe(404);
    expect(await store.listInterviews(OWNER_ID)).toHaveLength(1);
  });

  it("이미 지운 인터뷰는 404다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    await handleDeleteInterview(request({ method: "DELETE" }), interviewId, store);

    const again = await handleDeleteInterview(request({ method: "DELETE" }), interviewId, store);
    expect(again.status).toBe(404);
  });

  it("세션이 없으면 401이고 아무것도 지우지 않는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handleDeleteInterview(
      request({ method: "DELETE", authenticated: false }),
      interviewId,
      store
    );

    expect(response.status).toBe(401);
    expect(await store.listInterviews(OWNER_ID)).toHaveLength(1);
  });
});

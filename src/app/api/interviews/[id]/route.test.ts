import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleDeleteInterview, handleGetInterview, handlePatchInterview } from "./route";

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
  { userId = OWNER_ID, authenticated = true, method = "GET", body }: {
    userId?: number;
    authenticated?: boolean;
    method?: string;
    body?: unknown;
  } = {}
): NextRequest {
  return new NextRequest("https://example.com/api/interviews/x", {
    method,
    headers: authenticated
      ? { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId: userId })}` }
      : {},
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
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
    getInterview: fail, completeInterview: fail, deleteInterview: fail, purgeInterviewsOpenedBefore: fail,
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
      progress: emptyInterviewProgress(),
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

/**
 * 인터뷰를 끝난 것으로 표시합니다(이슈 #115). 목록의 기호와 세션 화면의 버튼 문구가 이 값을 읽습니다.
 */
describe("PATCH /api/interviews/[id]", () => {
  function patch(overrides: Parameters<typeof request>[0] = {}) {
    return request({ method: "PATCH", body: { status: "completed" }, ...overrides });
  }

  it("끝난 것으로 표시하면 204이고 목록의 상태가 바뀐다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handlePatchInterview(patch(), interviewId, store);

    expect(response.status).toBe(204);
    expect((await store.listInterviews(OWNER_ID))[0].status).toBe("completed");
  });

  // 진행 중으로 되돌리는 조작은 화면에 없습니다. 받아 두면 쓰지 않는 경로가 남습니다.
  it.each([
    ["되돌리는 값", { status: "in_progress" }],
    ["모르는 값", { status: "archived" }],
    ["status가 없으면", {}],
  ])("%s은 400이다", async (_label, body) => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handlePatchInterview(patch({ body }), interviewId, store);

    expect(response.status).toBe(400);
    expect((await store.listInterviews(OWNER_ID))[0].status).toBe("in_progress");
  });

  it("JSON이 아니면 400이다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    const response = await handlePatchInterview(patch({ body: "{" }), interviewId, store);
    expect(response.status).toBe(400);
  });

  it("다른 사용자의 인터뷰는 404이고 그대로 남는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const response = await handlePatchInterview(patch({ userId: OTHER_ID }), interviewId, store);

    expect(response.status).toBe(404);
    expect((await store.listInterviews(OWNER_ID))[0].status).toBe("in_progress");
  });

  it("세션이 없으면 401이다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    const response = await handlePatchInterview(patch({ authenticated: false }), interviewId, store);
    expect(response.status).toBe(401);
  });

  it("저장 계층이 끊기면 503이다", async () => {
    const response = await handlePatchInterview(patch(), "11111111-1111-4111-8111-111111111111", brokenStore());
    expect(response.status).toBe(503);
  });
});

/**
 * 끝난 인터뷰의 블록 문장 편집입니다(이슈 #115). 저장 전용 경로를 새로 만들지 않고 이 PATCH에
 * 분기를 하나 더 둡니다.
 */
describe("PATCH /api/interviews/[id] 블록 편집", () => {
  const SENTENCE = "사용자가 직접 고친 문장";

  function editBody(overrides: Record<string, unknown> = {}) {
    return { blockEdit: { block: "problem", sentences: [SENTENCE], expectedBlockVersion: 1, ...overrides } };
  }

  /** 끝난 인터뷰 하나를 만듭니다. 블록 상태에는 저장소를 인용하는 문장이 하나 들어 있습니다. */
  async function seedCompleted(store: SiftStore) {
    const { interviewId, analysisId } = await seed(store);
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "question", text: "질문" }, { role: "answer", text: "답변" }],
      blockState: {
        ...emptyExperienceBlockState(),
        version: 1,
        display: {
          ...emptyExperienceBlockState().display,
          problem: [{ text: "모델이 쓴 문장", claimIds: ["c1"] }],
        },
      },
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });
    await store.completeInterview(interviewId, OWNER_ID);
    return { interviewId, analysisId };
  }

  it("고친 문장을 저장하고 오른 블록 버전을 돌려준다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody() }),
      interviewId,
      store
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ blockVersion: 2 });
    const saved = await store.getInterview(interviewId, OWNER_ID);
    // 고친 문장에 예전 주장이 따라오지 않습니다(설계 8절). 서버가 문장을 새로 만듭니다.
    expect(saved?.blockState.display.problem).toEqual([{ text: SENTENCE, claimIds: [] }]);
    expect(saved?.blockVersion).toBe(2);
  });

  it("이력과 다른 블록은 건드리지 않는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    await handlePatchInterview(request({ method: "PATCH", body: editBody() }), interviewId, store);

    const saved = await store.getInterview(interviewId, OWNER_ID);
    expect(saved?.history).toHaveLength(2);
    expect(saved?.blockState.display.action).toEqual([]);
  });

  it("빈 문장만 보내면 블록을 비운다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody({ sentences: ["  ", ""] }) }),
      interviewId,
      store
    );

    expect(response.status).toBe(200);
    expect((await store.getInterview(interviewId, OWNER_ID))?.blockState.display.problem).toEqual([]);
  });

  // 진행 중인 인터뷰를 고쳐 두면 이어간 뒤 모델이 그 블록을 건드리는 순간 고친 문장이 사라집니다.
  it("진행 중인 인터뷰는 400이고 문장이 그대로 남는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [],
      blockState: { ...emptyExperienceBlockState(), version: 1 },
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody() }),
      interviewId,
      store
    );

    expect(response.status).toBe(400);
    expect((await store.getInterview(interviewId, OWNER_ID))?.blockVersion).toBe(1);
  });

  it("다른 곳이 먼저 고쳤으면 409이고 아무것도 쓰지 않는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody({ expectedBlockVersion: 0 }) }),
      interviewId,
      store
    );

    expect(response.status).toBe(409);
    const saved = await store.getInterview(interviewId, OWNER_ID);
    expect(saved?.blockState.display.problem).toEqual([{ text: "모델이 쓴 문장", claimIds: ["c1"] }]);
  });

  it.each([
    ["모르는 블록 이름", { block: "unknown" }],
    ["문자열이 아닌 문장", { sentences: [1] }],
    ["음수 버전", { expectedBlockVersion: -1 }],
    ["문장 수 상한 초과", { sentences: Array.from({ length: BLOCK_MAX_STATEMENTS + 1 }, (_, i) => `문장 ${i}`) }],
    ["바이트 상한 초과", { sentences: ["가".repeat(BLOCK_MAX_BYTES)] }],
  ])("%s은 400이다", async (_label, overrides) => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody(overrides) }),
      interviewId,
      store
    );

    expect(response.status).toBe(400);
    expect((await store.getInterview(interviewId, OWNER_ID))?.blockVersion).toBe(1);
  });

  it("다른 사용자의 인터뷰는 404이고 그대로 남는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seedCompleted(store);

    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody(), userId: OTHER_ID }),
      interviewId,
      store
    );

    expect(response.status).toBe(404);
    expect((await store.getInterview(interviewId, OWNER_ID))?.blockVersion).toBe(1);
  });

  it("저장소가 답하지 않으면 503이다", async () => {
    const response = await handlePatchInterview(
      request({ method: "PATCH", body: editBody() }),
      "11111111-1111-4111-8111-111111111111",
      brokenStore()
    );

    expect(response.status).toBe(503);
  });
});

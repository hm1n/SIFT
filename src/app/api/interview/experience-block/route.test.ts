import { APICallError, NoObjectGeneratedError } from "ai";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyInterviewProgress, recordAsked } from "@/features/experience-block/progress";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { MAX_EXPERIENCE_BLOCK_BODY_BYTES } from "@/features/experience-block/request";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import { handleExperienceBlockUpdate, type GenerateBlockUpdate } from "./route";

const snapshot = evidenceSnapshotFixture();

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    snapshot,
    history: [{ turnId: "t1", question: "질문", answer: "답변" }],
    state: emptyExperienceBlockState(),
    targetBlock: "problem",
    targetElement: "a",
    answerTurnId: "t1",
    ...overrides,
  };
}

function request(
  body: unknown,
  { authenticated = true, headers = {} }: { authenticated?: boolean; headers?: Record<string, string> } = {}
): NextRequest {
  return new NextRequest("https://example.com/api/interview/experience-block", {
    method: "POST",
    headers: {
      ...(authenticated ? { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId: 4472785 })}` } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function alwaysOutput(output: unknown): GenerateBlockUpdate {
  return async () => output as never;
}

const emptyOutput = { ops: [], display: [], evaluation: [] };

beforeEach(() => {
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  delete process.env[GITHUB_SESSION_KEY_ENV];
});

describe("POST /api/interview/experience-block", () => {
  it("모델 출력을 검증해 적용한 새 상태를 돌려준다", async () => {
    const output = {
      ops: [
        {
          op: "add",
          tempId: "a",
          block: "problem",
          text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠습니다.",
          sources: [{ source: "user", commitSha: null, filePath: null }],
        },
      ],
      display: [
        {
          block: "problem",
          sentences: [{ text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠습니다.", claimIds: ["new:a"] }],
        },
      ],
      evaluation: [{ block: "problem", sufficient: true, askable: false, reason: "sufficient" }],
      targetResponse: "provided",
    };

    const response = await handleExperienceBlockUpdate(request(requestBody()), {
      generate: alwaysOutput(output),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.state.version).toBe(1);
    expect(body.affectedBlocks).toEqual(["problem"]);
    expect(body.display.problem).toEqual([
      {
        text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠습니다.",
        userStatement: true,
        repositorySources: [],
      },
    ]);
    expect(body.conflicts.problem).toEqual([]);
    expect(body.warnings).toEqual([]);
    expect(body.targetResponse).toBe("provided");
  });

  it("세션이 없으면 401 unauthorized로 거절한다", async () => {
    const response = await handleExperienceBlockUpdate(
      request(requestBody(), { authenticated: false }),
      { generate: alwaysOutput(emptyOutput) }
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "unauthorized" } });
  });

  it("세션 암호화 키가 없으면 500 server_error로 알린다", async () => {
    const authenticated = request(requestBody());
    delete process.env[GITHUB_SESSION_KEY_ENV];

    const response = await handleExperienceBlockUpdate(authenticated, {
      generate: alwaysOutput(emptyOutput),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "server_error" } });
  });

  it("JSON이 아니면 400 invalid_json으로 거절한다", async () => {
    const response = await handleExperienceBlockUpdate(request("{"), {
      generate: alwaysOutput(emptyOutput),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "invalid_json" } });
  });

  it("요청 계약을 어기면 422 invalid_request로 거절한다", async () => {
    const response = await handleExperienceBlockUpdate(
      request(requestBody({ targetBlock: "unknown" })),
      { generate: alwaysOutput(emptyOutput) }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "invalid_request" } });
  });

  it("본문 상한을 넘으면 413 body_too_large로 거절한다", async () => {
    const oversized = "x".repeat(MAX_EXPERIENCE_BLOCK_BODY_BYTES + 1);
    const response = await handleExperienceBlockUpdate(
      request(requestBody({ padding: oversized })),
      { generate: alwaysOutput(emptyOutput) }
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "body_too_large" } });
  });

  it("모델 출력이 리듀서 검증을 통과하지 못하면 502 block_update_rejected로 거절한다", async () => {
    const invalidOutput = {
      ops: [{ op: "retract", claimId: "존재하지-않음" }],
      display: [],
      evaluation: [],
    };

    const response = await handleExperienceBlockUpdate(request(requestBody()), {
      generate: alwaysOutput(invalidOutput),
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "block_update_rejected" } });
  });

  it("모델 호출 실패는 mapInterviewLlmError로 분류해 보낸다", async () => {
    const response = await handleExperienceBlockUpdate(request(requestBody()), {
      generate: async () => {
        throw new APICallError({
          message: "invalid key",
          url: "https://api.openai.com/v1/responses",
          requestBodyValues: {},
          statusCode: 401,
        });
      },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "llm_auth" } });
  });

  it("모델 구조화 출력이 스키마와 안 맞으면 502 schema_validation으로 보낸다", async () => {
    // `generateObject`가 던지는 실패입니다. 자유 텍스트 스트리밍(질문 생성)에는 없는 분류라
    // `mapInterviewLlmError`에 새로 추가한 갈래이므로 직접 재현합니다.
    const response = await handleExperienceBlockUpdate(request(requestBody()), {
      generate: async () => {
        throw new NoObjectGeneratedError({
          response: { id: "resp1", timestamp: new Date(), modelId: "gpt-5.6-luna" },
          usage: {} as never,
          finishReason: "stop",
        });
      },
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "schema_validation" } });
  });
});

/**
 * 이슈 #115가 이 경로에 얹은 저장입니다. 저장 전용 API를 새로 만들지 않고 이미 있는 이 요청에
 * 얹었습니다. 무상태 서버라 클라이언트가 이미 매 턴 근거와 이력과 블록 상태를 전부 보내고 있습니다.
 */
describe("POST /api/interview/experience-block 저장", () => {
  const OWNER_ID = 4472785;

  /**
   * `emptyOutput`은 `targetBlock` 평가가 없어 검증에서 거절됩니다. 저장은 블록 갱신이 성공한 뒤에만
   * 일어나므로 여기서는 통과하는 출력을 씁니다.
   */
  const acceptedOutput = {
    ops: [],
    display: [],
    evaluation: [{ block: "problem", sufficient: false, askable: true, reason: "askable" }],
    targetResponse: "provided",
  };

  async function seed(store: SiftStore) {
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
      title: "제목",
      evidence: {},
    });
    if (interviewId === null) throw new Error("seed failed");
    return interviewId;
  }

  it("save가 없으면 저장하지 않고 skipped를 돌려준다", async () => {
    const store = createInMemoryStore();
    const response = await handleExperienceBlockUpdate(request(requestBody()), {
      generate: alwaysOutput(acceptedOutput),
      store,
    });

    await expect(response.json()).resolves.toMatchObject({ save: "skipped" });
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
  });

  it("save가 있으면 그 턴을 이어 붙이고 saved를 돌려준다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seed(store);

    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId, expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(acceptedOutput), store }
    );

    await expect(response.json()).resolves.toMatchObject({ save: "saved" });
    const stored = await store.getInterview(interviewId, OWNER_ID);
    expect(stored?.history).toEqual([
      { role: "question", text: "질문" },
      { role: "answer", text: "답변" },
    ]);
    expect(stored?.blockVersion).toBe(1);
  });

  it("밀린 턴을 함께 이어 붙인다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seed(store);
    const history = [
      { turnId: "t0", question: "밀린 질문", answer: "밀린 답변" },
      { turnId: "t1", question: "질문", answer: "답변" },
    ];

    await handleExperienceBlockUpdate(
      request(requestBody({ history, save: { interviewId, expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1, pendingTurnIds: ["t0"] } })),
      { generate: alwaysOutput(acceptedOutput), store }
    );

    const stored = await store.getInterview(interviewId, OWNER_ID);
    expect(stored?.history.map((message) => message.text)).toEqual(["밀린 질문", "밀린 답변", "질문", "답변"]);
  });

  /**
   * 블록 갱신은 이미 성공했습니다. 여기서 실패를 올리면 사용자는 방금 화면에 그려진 답변과 블록을
   * 잃습니다. 저장 실패는 응답에 실어 화면이 안내만 하게 합니다.
   */
  it("저장이 실패해도 요청은 성공하고 갱신된 상태를 그대로 돌려준다", async () => {
    const failing = {
      ...createInMemoryStore(),
      appendTurn: async () => {
        throw new DatabaseError("query_failed", "흉내 낸 오류");
      },
    } as unknown as SiftStore;

    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId: "11111111-1111-4111-8111-111111111111", expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(acceptedOutput), store: failing }
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.save).toBe("failed");
    expect(body.state.version).toBe(1);
  });

  /**
   * 진행 상태를 저장하지 않으면 복원한 인터뷰가 사용자가 이미 답하지 못한 요소를 예산만큼 다시
   * 묻습니다. 반영에 필요한 반응은 모델 출력에서 서버가 계산하므로 서버가 반영해 저장합니다.
   */
  it("이번 답변의 반응을 진행 상태에 반영해 저장한다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seed(store);
    const unknownOutput = {
      ...acceptedOutput,
      evaluation: [{ block: "problem", sufficient: false, askable: true, reason: "unknown" }],
      targetResponse: "unknown",
    };

    // 클라이언트가 보내는 값은 질문을 보낸 기록까지 들어 있고 이번 답변의 반응은 아직 없습니다.
    const asked = recordAsked(emptyInterviewProgress(), "problem", "a");

    await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId, expectedBlockVersion: 0, progress: asked, askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(unknownOutput), store }
    );

    const stored = await store.getInterview(interviewId, OWNER_ID);
    // `targetBlock`은 problem, `targetElement`는 a입니다.
    expect(stored?.progress.problem.elements.a.firstUnknownAskedCount).toBe(1);
    expect(stored?.progress.problem.visited).toBe(true);
    // 겨냥하지 않은 블록은 그대로입니다.
    expect(stored?.progress.result.visited).toBe(false);
  });

  it("보내온 진행 상태의 모양이 어긋나면 422다", async () => {
    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId: "x", expectedBlockVersion: 0, progress: { problem: {} }, askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(acceptedOutput), store: createInMemoryStore() }
    );
    expect(response.status).toBe(422);
  });

  it("다른 탭이 먼저 저장했으면 version_conflict를 돌려준다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seed(store);
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "answer", text: "다른 탭의 답변" }],
      blockState: { ...emptyExperienceBlockState(), version: 1 },
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId, expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(acceptedOutput), store }
    );

    await expect(response.json()).resolves.toMatchObject({ save: "version_conflict" });
    const stored = await store.getInterview(interviewId, OWNER_ID);
    expect(stored?.history.map((message) => message.text)).toEqual(["다른 탭의 답변"]);
  });

  it("남의 인터뷰에 저장하려 하면 not_found를 돌려준다", async () => {
    const store = createInMemoryStore();
    const analysisId = await store.saveAnalysis({
      githubUserId: 99_999_999,
      repoOwner: "other",
      repoName: "repo",
      contributionItems: [],
      candidates: {},
      stageASummary: {},
    });
    const theirs = await store.createInterview({
      githubUserId: 99_999_999, analysisId, candidateKey: "c", title: "남의 것", evidence: {},
    });

    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId: theirs, expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1 } })),
      { generate: alwaysOutput(acceptedOutput), store }
    );

    await expect(response.json()).resolves.toMatchObject({ save: "not_found" });
  });

  // 조용히 넘기면 밀렸다고 보고한 턴이 저장되지 않은 채로 요청만 성공하고, 사용자는 밀린 대화가
  // 저장된 줄 압니다.
  it("밀린 턴 식별자가 이력에 없으면 422다", async () => {
    const response = await handleExperienceBlockUpdate(
      request(requestBody({ save: { interviewId: "x", expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1, pendingTurnIds: ["없는턴"] } })),
      { generate: alwaysOutput(acceptedOutput), store: createInMemoryStore() }
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { kind: "invalid_request" } });
  });

  it.each([
    ["interviewId가 없으면", { expectedBlockVersion: 0, progress: emptyInterviewProgress(), askedCountAtQuestion: 1 }],
    ["기대 버전이 음수면", { interviewId: "x", expectedBlockVersion: -1 }],
    ["기대 버전이 정수가 아니면", { interviewId: "x", expectedBlockVersion: 1.5 }],
  ])("save에서 %s 422다", async (_label, save) => {
    const response = await handleExperienceBlockUpdate(request(requestBody({ save })), {
      generate: alwaysOutput(acceptedOutput),
      store: createInMemoryStore(),
    });
    expect(response.status).toBe(422);
  });
});

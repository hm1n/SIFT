import { APICallError, NoObjectGeneratedError } from "ai";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { MAX_EXPERIENCE_BLOCK_BODY_BYTES } from "@/features/experience-block/request";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import {
  encryptGitHubToken,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleExperienceBlockUpdate, type GenerateBlockUpdate } from "./route";

const snapshot = evidenceSnapshotFixture();

function requestBody(overrides: Record<string, unknown> = {}) {
  return {
    snapshot,
    history: [{ turnId: "t1", question: "질문", answer: "답변" }],
    state: emptyExperienceBlockState(),
    targetBlock: "problem",
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
      ...(authenticated ? { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubToken("token")}` } : {}),
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

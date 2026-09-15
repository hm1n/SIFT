import { APICallError, LoadAPIKeyError, NoObjectGeneratedError } from "ai";
import { describe, expect, it } from "vitest";
import { LLM_ERROR_COPY, LLM_ERROR_CONTEXT } from "@/copy/interview";
import { mapInterviewLlmError } from "./llm-error";

/**
 * 이 함수가 만든 `message`는 화면이 그대로 그립니다. 인터뷰 화면은 오류 박스 첫 줄
 * (`interview-stream-view.tsx`), 분석 화면은 `StatusScreen`의 sub입니다. 그래서 여기 있는 문구는
 * 전부 한국어여야 합니다.
 *
 * 이슈 #128에서 `schema_validation` 한 갈래만 영어 리터럴로 남아 있었습니다. `context` 인자는 이미
 * 한국어로 바뀐 뒤라 한 문장 안에서 언어가 갈렸습니다("The structured response for 질문 생성 did
 * not match the output schema."). 분류는 맞고 문구만 틀린 경우라 기존 테스트가 전부 통과했습니다.
 */
const HANGUL = /[가-힣]/;

function apiCallError(statusCode: number, responseBody?: string): APICallError {
  return new APICallError({
    message: "call failed",
    url: "http://localhost/v1/chat",
    requestBodyValues: {},
    statusCode,
    responseBody,
  });
}

function noObjectGenerated(): NoObjectGeneratedError {
  return new NoObjectGeneratedError({
    text: "{",
    response: { id: "1", timestamp: new Date(0), modelId: "test" },
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {
        noCacheTokens: undefined,
        cacheReadTokens: undefined,
        cacheWriteTokens: undefined,
      },
      outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
    },
    finishReason: "stop",
  });
}

describe("mapInterviewLlmError", () => {
  it("구조화 출력이 스키마를 벗어나면 schema_validation으로 옮기고 한국어로 알린다", () => {
    const mapped = mapInterviewLlmError(noObjectGenerated(), LLM_ERROR_CONTEXT.blockUpdate);

    expect(mapped.kind).toBe("schema_validation");
    expect(mapped.message).toBe(LLM_ERROR_COPY.schemaMismatch(LLM_ERROR_CONTEXT.blockUpdate));
    expect(mapped.message).toContain(LLM_ERROR_CONTEXT.blockUpdate);
  });

  /**
   * 갈래마다 따로 단정하지 않고 한 번에 훑습니다. 다음에 갈래가 하나 늘어도 영어 리터럴이 그대로
   * 남으면 여기서 걸립니다. 분류가 무엇인지는 각 갈래를 만든 테스트가 따로 봅니다.
   */
  it.each([
    ["구조화 출력 실패", noObjectGenerated()],
    ["API 키 없음", new LoadAPIKeyError({ message: "missing" })],
    ["중단", new DOMException("aborted", "AbortError")],
    ["시간 초과", new DOMException("timed out", "TimeoutError")],
    ["인증 실패(401)", apiCallError(401)],
    ["인증 실패(403)", apiCallError(403)],
    ["한도 초과(429)", apiCallError(429)],
    ["한도 초과(413)", apiCallError(413, JSON.stringify({ error: { code: "rate_limit_exceeded" } }))],
    ["요청 과대(413)", apiCallError(413)],
    ["시간 초과(408)", apiCallError(408)],
    ["시간 초과(504)", apiCallError(504)],
    ["모델 설정(404)", apiCallError(404)],
    ["일시 장애(503)", apiCallError(503)],
    ["거절(400)", apiCallError(400)],
    ["거절(422)", apiCallError(422)],
    ["분류 밖 상태 코드", apiCallError(418)],
    ["네트워크", new TypeError("fetch failed")],
    ["알 수 없음", new Error("boom")],
  ])("%s 문구는 한국어다", (_label, error) => {
    const mapped = mapInterviewLlmError(error, LLM_ERROR_CONTEXT.questionGeneration);

    expect(mapped.message).toMatch(HANGUL);
    // 영어 문장이 섞이면 걸립니다. 기술 용어 한 단어는 남을 수 있으므로 연속 두 단어를 봅니다.
    expect(mapped.message).not.toMatch(/[A-Za-z]{4,}\s+[A-Za-z]{4,}/);
  });
});

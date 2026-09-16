import { describe, expect, it } from "vitest";
import { QUESTION_REQUEST_COPY } from "@/copy/interview";
import { ExperienceCandidateOutputError } from "@/features/experience-candidates/errors";
import { generationEmptyError } from "./errors";
import type { InterviewQuestionStream } from "./question-generation";
import { createQuestionSseStream, resolveGenerationErrorKind } from "./question-stream";
import { createSseEventParser } from "./sse";
import type { InterviewStreamEvent } from "./sse";

function questionStream(
  firstText: string,
  rest: (string | Error)[],
  onClose?: () => void
): InterviewQuestionStream {
  const queue = [...rest];
  return {
    firstText,
    async next() {
      const next = queue.shift();
      if (next === undefined) return null;
      if (next instanceof Error) throw next;
      return next;
    },
    async close() {
      onClose?.();
    },
  };
}

async function readEvents(stream: ReadableStream<Uint8Array>): Promise<InterviewStreamEvent[]> {
  const parser = createSseEventParser();
  const events: InterviewStreamEvent[] = [];
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    events.push(...parser.push(decoder.decode(value, { stream: true })));
  }
  return events;
}

describe("createQuestionSseStream", () => {
  it("첫 조각부터 seq 1로 보내고 done에 마지막 seq를 싣는다", async () => {
    const events = await readEvents(
      createQuestionSseStream(questionStream("첫 조각", [" 둘째", " 셋째"]))
    );

    expect(events).toEqual([
      { type: "chunk", seq: 1, text: "첫 조각" },
      { type: "chunk", seq: 2, text: " 둘째" },
      { type: "chunk", seq: 3, text: " 셋째" },
      // `done`의 seq가 실제 마지막 청크와 같아야 수신부가 완결로 받습니다.
      { type: "done", seq: 3 },
    ]);
  });

  it("전송 중 생성 실패는 분류를 그대로 실은 error 이벤트로 보낸다", async () => {
    const events = await readEvents(
      createQuestionSseStream(
        questionStream("첫 조각", [
          new ExperienceCandidateOutputError("llm_rate_limit", "AI 호출 한도에 걸렸습니다."),
        ])
      )
    );

    expect(events).toEqual([
      { type: "chunk", seq: 1, text: "첫 조각" },
      { type: "error", kind: "llm_rate_limit", message: "AI 호출 한도에 걸렸습니다." },
    ]);
  });

  /**
   * 분류를 아는 실패는 `mapInterviewLlmError`를 거쳐 한국어 message를 답니다. 그 밖의 예외는 원문이
   * 영어일 수 있고 화면이 이 값을 오류 박스 첫 줄에 그대로 그립니다.
   */
  it("분류를 모르는 실패는 원문 대신 화면 문구를 싣는다", async () => {
    const events = await readEvents(
      createQuestionSseStream(questionStream("첫 조각", [new Error("Unexpected token < in JSON")]))
    );

    expect(events).toEqual([
      { type: "chunk", seq: 1, text: "첫 조각" },
      { type: "error", kind: "llm_failure", message: QUESTION_REQUEST_COPY.generationFailed },
    ]);
  });

  it("스트림이 끝나면 생성 자원을 정리한다", async () => {
    let closed = false;
    await readEvents(createQuestionSseStream(questionStream("조각", [], () => {
      closed = true;
    })));

    expect(closed).toBe(true);
  });

  it("클라이언트가 먼저 끊으면 오류 이벤트를 만들지 않는다", async () => {
    const controller = new AbortController();
    const stream = createQuestionSseStream(
      questionStream("첫 조각", [" 둘째"]),
      { signal: controller.signal }
    );
    controller.abort();

    const events = await readEvents(stream);

    expect(events).toEqual([{ type: "chunk", seq: 1, text: "첫 조각" }]);
  });
});

describe("resolveGenerationErrorKind", () => {
  it("아는 분류는 그대로 옮긴다", () => {
    expect(resolveGenerationErrorKind(new ExperienceCandidateOutputError("llm_timeout", "시간 초과"))).toBe(
      "llm_timeout"
    );
    expect(resolveGenerationErrorKind(generationEmptyError())).toBe("generation_empty");
  });

  it("모르는 실패는 전송 실패가 아니라 생성 실패로 둔다", () => {
    // 연결은 이미 열려 있으므로 전송 문제가 아닙니다. `stream_*`로 떨어뜨리면 수신부가 이어받기
    // 안내를 내보냅니다.
    expect(resolveGenerationErrorKind(new Error("알 수 없는 실패"))).toBe("llm_failure");
    expect(resolveGenerationErrorKind(null)).toBe("llm_failure");
  });
});

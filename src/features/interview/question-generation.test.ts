import { APICallError } from "ai";
import { describe, expect, it } from "vitest";
import { ExperienceCandidateOutputError } from "@/features/experience-candidates/errors";
import { InterviewStreamError } from "./errors";
import { evidenceSnapshotFixture } from "./question-fixture";
import { serializedByteLength } from "@/features/experience-candidates/evidence-snapshot";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES } from "./history";
import {
  INTERVIEW_QUESTION_BYTES_PER_OUTPUT_TOKEN,
  INTERVIEW_QUESTION_MAX_OUTPUT_TOKENS,
  INTERVIEW_QUESTION_MAX_RETRIES,
  buildInterviewQuestionPrompt,
  interviewQuestionPromptBytes,
  interviewQuestionRequestOptions,
  toItemBoundedTextStream,
  toInterviewQuestionMessages,
  startInterviewQuestionStream,
  toThrowingTextStream,
  type GenerateInterviewQuestion,
} from "./question-generation";

const snapshot = evidenceSnapshotFixture();

function chunks(...texts: string[]): GenerateInterviewQuestion {
  return () =>
    (async function* () {
      for (const text of texts) yield text;
    })();
}

function failsWith(error: unknown, ...before: string[]): GenerateInterviewQuestion {
  return () =>
    (async function* () {
      for (const text of before) yield text;
      throw error;
    })();
}

async function collect(stream: { firstText: string; next: () => Promise<string | null> }) {
  const texts = [stream.firstText];
  for (;;) {
    const text = await stream.next();
    if (text === null) return texts;
    texts.push(text);
  }
}

describe("startInterviewQuestionStream", () => {
  it("첫 조각을 받은 뒤에 스트림을 돌려준다", async () => {
    const stream = await startInterviewQuestionStream(snapshot, {
      generate: chunks("첫 조각", " 둘째 조각"),
    });

    expect(stream.firstText).toBe("첫 조각");
    await expect(collect(stream)).resolves.toEqual(["첫 조각", " 둘째 조각"]);
  });

  it("빈 조각은 건너뛴다", async () => {
    // provider가 빈 텍스트 델타를 보내면 그대로 흘려 `seq`만 늘고 화면에 붙는 내용이 없는 청크가
    // 생깁니다. `done`의 마지막 `seq` 검증은 통과하는데 질문은 그만큼 비어 보입니다.
    const stream = await startInterviewQuestionStream(snapshot, {
      generate: chunks("", "첫 조각", "", "둘째 조각"),
    });

    await expect(collect(stream)).resolves.toEqual(["첫 조각", "둘째 조각"]);
  });

  it("조각이 하나도 없으면 generation_empty로 알린다", async () => {
    await expect(
      startInterviewQuestionStream(snapshot, { generate: chunks("", "") })
    ).rejects.toMatchObject({ kind: "generation_empty" });
  });

  it("첫 조각 전의 provider 실패는 분류를 실어 던진다", async () => {
    const apiError = new APICallError({
      message: "rate limit",
      url: "https://api.groq.com",
      requestBodyValues: {},
      statusCode: 429,
    });

    await expect(
      startInterviewQuestionStream(snapshot, { generate: failsWith(apiError) })
    ).rejects.toMatchObject({ kind: "llm_rate_limit" });
  });

  it("첫 조각 뒤의 실패는 스트림을 소비할 때 던진다", async () => {
    const apiError = new APICallError({
      message: "server error",
      url: "https://api.groq.com",
      requestBodyValues: {},
      statusCode: 500,
    });
    const stream = await startInterviewQuestionStream(snapshot, {
      generate: failsWith(apiError, "첫 조각"),
    });

    expect(stream.firstText).toBe("첫 조각");
    await expect(stream.next()).rejects.toMatchObject({ kind: "llm_failure" });
  });

  it("첫 조각이 시한 안에 오지 않으면 llm_timeout으로 알린다", async () => {
    const generate: GenerateInterviewQuestion = (_prompt, abortSignal) =>
      (async function* () {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          abortSignal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(abortSignal.reason);
          });
        });
        yield "늦은 조각";
      })();

    await expect(
      startInterviewQuestionStream(snapshot, { generate, firstChunkTimeoutMs: 10 })
    ).rejects.toMatchObject({ kind: "llm_timeout" });
  });

  it("이미 중단된 signal을 받으면 provider 호출을 시작하기 전에 끊는다", async () => {
    // route가 본문을 읽고 프롬프트를 접는 동안 클라이언트가 끊으면 이 지점에서 signal이 이미
    // aborted입니다. `addEventListener`는 이미 발생한 abort에 대해 불리지 않으므로, 상태를 먼저
    // 보지 않으면 받을 사람이 없는 응답을 위해 provider 호출이 무료 등급 일일 토큰을 씁니다.
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const generate: GenerateInterviewQuestion = () => {
      called = true;
      return (async function* () {
        yield "호출되면 안 되는 조각";
      })();
    };

    await expect(
      startInterviewQuestionStream(snapshot, { generate, signal: controller.signal })
    ).rejects.toMatchObject({ kind: "llm_timeout" });
    expect(called).toBe(false);
  });

  it("중단된 스트림이 조용히 끝나도 generation_empty로 뭉개지 않는다", async () => {
    // provider가 중단을 예외가 아니라 정상 종료로 알리는 경우입니다. 실측에서 `textStream`이 실제로
    // 이렇게 동작했습니다. 시간 초과가 "질문을 만들지 못했습니다"로 뭉개지면 안 됩니다.
    const generate: GenerateInterviewQuestion = (_prompt, abortSignal) =>
      (async function* () {
        await new Promise<void>((resolve) => abortSignal.addEventListener("abort", () => resolve()));
      })();

    await expect(
      startInterviewQuestionStream(snapshot, { generate, firstChunkTimeoutMs: 10 })
    ).rejects.toMatchObject({ kind: "llm_timeout" });
  });
});

describe("toThrowingTextStream", () => {
  it("error 부분을 던진다", async () => {
    const failure = new Error("provider failed");
    const iterate = async () => {
      const texts: string[] = [];
      for await (const text of toThrowingTextStream({
        fullStream: (async function* () {
          yield { type: "text-delta" as const, text: "앞부분" };
          yield { type: "error" as const, error: failure };
        })(),
        usage: Promise.resolve(null),
        response: Promise.resolve(null),
        text: Promise.resolve(null),
      })) {
        texts.push(text);
      }
      return texts;
    };

    await expect(iterate()).rejects.toBe(failure);
  });

  it("abort 부분을 중단 예외로 던진다", async () => {
    const iterate = async () => {
      const texts: string[] = [];
      for await (const text of toThrowingTextStream({
        fullStream: (async function* () {
          yield { type: "abort" as const, reason: "client closed" };
        })(),
        usage: Promise.resolve(null),
        response: Promise.resolve(null),
        text: Promise.resolve(null),
      })) {
        texts.push(text);
      }
      return texts;
    };

    await expect(iterate()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("계약에 없는 부분은 무시한다", async () => {
    const texts: string[] = [];
    for await (const text of toThrowingTextStream({
      fullStream: (async function* () {
        yield { type: "start" as const };
        yield { type: "text-start" as const };
        yield { type: "text-delta" as const, text: "본문" };
        yield { type: "finish" as const };
      })(),
      usage: Promise.resolve(null),
      response: Promise.resolve(null),
      text: Promise.resolve(null),
    })) {
      texts.push(text);
    }

    expect(texts).toEqual(["본문"]);
  });
});

describe("오류 종류", () => {
  it("generation_empty는 전송 오류가 아니라 인터뷰 스트림 오류다", async () => {
    const error = await startInterviewQuestionStream(snapshot, { generate: chunks() }).catch(
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(InterviewStreamError);
    expect(error).not.toBeInstanceOf(ExperienceCandidateOutputError);
  });
});

describe("interviewQuestionPromptBytes", () => {
  it("시스템 프롬프트와 근거를 함께 잰다", () => {
    const prompt = buildInterviewQuestionPrompt(snapshot);

    expect(interviewQuestionPromptBytes(prompt)).toBe(
      new TextEncoder().encode(`${prompt.system}\n\n${prompt.evidence}`).byteLength
    );
    // 근거만 재면 시스템 프롬프트가 상한 밖에 남습니다. Stage A가 기여 항목을 빠뜨려 같은 결함을
    // 겪은 적이 있습니다.
    expect(interviewQuestionPromptBytes(prompt)).toBeGreaterThan(
      new TextEncoder().encode(prompt.evidence).byteLength
    );
  });
});

describe("대화 이력", () => {
  const history = [
    { role: "question" as const, text: "왜 이 구조를 골랐나요?" },
    { role: "answer" as const, text: "재시도 비용을 줄이려고요." },
  ];

  it("이력이 없으면 첫 질문 프롬프트와 같다", () => {
    // 첫 질문 경로는 지금과 같은 문자열을 받아야 합니다.
    const first = buildInterviewQuestionPrompt(snapshot);

    expect(first.history).toEqual([]);
    expect(first).toEqual(buildInterviewQuestionPrompt(snapshot, { history: [] }));
  });

  it("이력이 있으면 시스템 프롬프트에 꼬리 질문 규칙이 붙는다", () => {
    const followUp = buildInterviewQuestionPrompt(snapshot, { history });

    expect(followUp.system).not.toBe(buildInterviewQuestionPrompt(snapshot).system);
    expect(followUp.system).toContain("이미 물은 것을 다시 묻지 않습니다");
    // 근거는 매 턴 전량이 그대로 실립니다.
    expect(followUp.evidence).toBe(buildInterviewQuestionPrompt(snapshot).evidence);
  });

  it("프롬프트 바이트에 이력이 들어간다", () => {
    const first = buildInterviewQuestionPrompt(snapshot);
    const followUp = buildInterviewQuestionPrompt(snapshot, { history });

    expect(interviewQuestionPromptBytes(followUp)).toBeGreaterThan(
      interviewQuestionPromptBytes(first)
    );
  });

  it("근거를 첫 사용자 메시지에 두고 질문과 답변을 자리로 가른다", () => {
    // 접두사가 `시스템 + 근거`로 고정되어야 나중에 캐싱을 얹을 때 캐시가 맞습니다.
    const prompt = buildInterviewQuestionPrompt(snapshot, { history });

    expect(toInterviewQuestionMessages(prompt)).toEqual([
      { role: "user", content: prompt.evidence },
      { role: "assistant", content: history[0].text },
      { role: "user", content: history[1].text },
    ]);
  });

  it("이력이 없으면 사용자 메시지 하나만 보낸다", () => {
    expect(toInterviewQuestionMessages(buildInterviewQuestionPrompt(snapshot))).toHaveLength(1);
  });
});

describe("출력 상한", () => {
  it("생성 호출에 출력 상한을 싣는다", () => {
    // 상한이 빠지면 질문이 이력 항목 상한을 넘길 수 있고, 그때 클라이언트는 제출을 잠급니다.
    // 서버에 상한이 없으면 다시 생성해도 또 넘칠 수 있어 사용자가 빠져나오지 못합니다.
    const options = interviewQuestionRequestOptions(
      buildInterviewQuestionPrompt(snapshot),
      new AbortController().signal
    );

    expect(options.maxOutputTokens).toBe(INTERVIEW_QUESTION_MAX_OUTPUT_TOKENS);
    expect(options.maxRetries).toBe(INTERVIEW_QUESTION_MAX_RETRIES);
  });

  it("상한이 이력 항목 상한 안에서 유도된 값이다", () => {
    // 출력 상한을 이력 항목 상한과 따로 움직이면 유도가 깨집니다. 두 상수 가운데 하나만 바뀌면
    // 이 단언이 먼저 깨져서 다른 하나를 함께 보게 합니다.
    expect(
      INTERVIEW_QUESTION_MAX_OUTPUT_TOKENS * INTERVIEW_QUESTION_BYTES_PER_OUTPUT_TOKEN
    ).toBeLessThanOrEqual(INTERVIEW_HISTORY_ITEM_MAX_BYTES);
    // 2026-09-09 실측의 출력 최대는 356토큰입니다. 상한이 그보다 낮으면 정상 질문을 자릅니다.
    expect(INTERVIEW_QUESTION_MAX_OUTPUT_TOKENS).toBeGreaterThan(356);
  });
});

describe("toItemBoundedTextStream", () => {
  async function collect(source: AsyncIterable<string>): Promise<string> {
    let text = "";
    for await (const delta of source) text += delta;
    return text;
  }

  async function* deltas(...values: string[]): AsyncIterable<string> {
    for (const value of values) yield value;
  }

  it("상한 안의 스트림은 그대로 흘린다", async () => {
    expect(await collect(toItemBoundedTextStream(deltas("가", "나", "다")))).toBe("가나다");
  });

  it("토큰당 바이트가 관측 표본을 넘겨도 상한에서 끊는다", async () => {
    // `maxOutputTokens`는 토큰을 세고 계약은 바이트를 셉니다. 토큰 하나가 몇 바이트가 되는지는
    // 우리가 정하는 값이 아니므로, 관측 최대 4.87을 넘는 출력이 오면 토큰 상한만으로는 항목
    // 상한을 지키지 못합니다. 그때 클라이언트는 제출을 잠급니다.
    const chunk = "가".repeat(1_000);
    const bounded = toItemBoundedTextStream(deltas(chunk, chunk, chunk, chunk, chunk));

    const text = await collect(bounded);

    expect(serializedByteLength(text)).toBeLessThanOrEqual(INTERVIEW_HISTORY_ITEM_MAX_BYTES);
    // 상한까지는 채웁니다. 넘긴 조각만 버리고 앞의 내용을 함께 버리지 않습니다.
    expect(serializedByteLength(text)).toBe(INTERVIEW_HISTORY_ITEM_MAX_BYTES);
  });

  it("코드 포인트 경계에서 자른다", async () => {
    // 바이트로 자르면 서로게이트 쌍이 쪼개져 깨진 문자가 남습니다.
    const text = await collect(toItemBoundedTextStream(deltas("가나다라"), 7));

    expect(text).toBe("가나");
    expect([...text]).toHaveLength(2);
  });

  it("상한을 채운 뒤에는 남은 조각을 읽지 않는다", async () => {
    let pulled = 0;
    async function* counted(): AsyncIterable<string> {
      for (let index = 0; index < 5; index += 1) {
        pulled += 1;
        yield "가".repeat(1_000);
      }
    }

    await collect(toItemBoundedTextStream(counted()));

    // 5,000자를 다 받으면 15,000바이트입니다. 상한을 채운 조각에서 멈춰야 합니다.
    expect(pulled).toBeLessThan(5);
  });
});

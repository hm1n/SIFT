// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { encodeSseEvent } from "@/features/interview/sse";
import { useExperienceInterview } from "./use-experience-interview";
import { emptyExperienceBlockState, type BlockEvaluation, type ExperienceBlockState, type TargetResponse } from "./types";

afterEach(cleanup);

const QUESTION_URL = "/api/interview/stream";
const BLOCK_UPDATE_URL = "/api/interview/experience-block";
const snapshot = evidenceSnapshotFixture();

function controllableResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    response: { ok: true, status: 200, body: stream } as unknown as Response,
    push(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
  };
}

function completeQuestion(source: ReturnType<typeof controllableResponse>, text: string) {
  source.push(encodeSseEvent({ type: "chunk", seq: 1, text }));
  source.push(encodeSseEvent({ type: "done", seq: 1 }));
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const ASKABLE: BlockEvaluation = { sufficient: false, askable: true, reason: "askable" };
const SUFFICIENT: BlockEvaluation = { sufficient: true, askable: false, reason: "sufficient" };

function blockUpdateBody(
  overrides: {
    evaluation?: Partial<ExperienceBlockState["evaluation"]>;
    targetResponse?: TargetResponse;
  } = {}
) {
  const base = emptyExperienceBlockState();
  const state: ExperienceBlockState = {
    ...base,
    version: base.version + 1,
    evaluation: { ...base.evaluation, ...overrides.evaluation },
  };
  return { state, affectedBlocks: [], targetResponse: overrides.targetResponse ?? "provided" };
}

/** 질문 요청과 블록 갱신 요청을 URL로 갈라 각자의 큐에서 응답을 꺼내는 fetch 목입니다. */
function makeFetchImpl({
  questionSources,
  blockUpdateResponses,
}: {
  questionSources: ReturnType<typeof controllableResponse>[];
  blockUpdateResponses: Response[];
}) {
  let questionIndex = 0;
  let blockUpdateIndex = 0;
  return vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === QUESTION_URL) return questionSources[questionIndex++].response;
    if (url === BLOCK_UPDATE_URL) return blockUpdateResponses[blockUpdateIndex++];
    throw new Error(`unexpected url: ${url}`);
  });
}

/** `fetchImpl.mock.calls`에서 body를 파싱합니다. 두 번째 인자가 없는 GET 호출은 쓰지 않으므로 항상 있습니다. */
function callBody(call: [RequestInfo | URL, RequestInit?]): unknown {
  return JSON.parse((call[1] as RequestInit).body as string);
}

const immediate = {
  sleep: async () => {},
  retryDelaysMs: [] as number[],
  scheduleFrame: (callback: () => void) => {
    callback();
    return 0;
  },
  cancelFrame: () => {},
};

describe("useExperienceInterview", () => {
  it("첫 질문은 initialTarget(problem.a)을 요청 본문에 싣는다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(callBody(fetchImpl.mock.calls[0])).toEqual({ snapshot, targetBlock: "problem", targetElement: "a" });
  });

  it("답변마다 블록 갱신을 호출해 반환된 상태를 반영하고, 충분해진 블록은 다음 질문에서 건너뛴다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: SUFFICIENT } }))],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3)); // 질문1, 블록갱신1, 질문2
    const blockUpdateCall = fetchImpl.mock.calls[1];
    expect(String(blockUpdateCall[0])).toBe(BLOCK_UPDATE_URL);
    expect(callBody(blockUpdateCall)).toMatchObject({
      targetBlock: "problem",
      targetElement: "a",
      answerTurnId: "t1",
      history: [{ turnId: "t1", question: "문제 상황을 알려주세요", answer: "화면이 비어 있었습니다." }],
    });
    expect(result.current.blockState.evaluation.problem).toEqual(SUFFICIENT);
    // problem이 충분해졌으므로 다음 질문은 alternatives로 이동합니다.
    expect(callBody(fetchImpl.mock.calls[2])).toMatchObject({ targetBlock: "alternatives", targetElement: "a" });
    expect(result.current.turnsUsed).toBe(1);
  });

  it("currentTarget이 다음 질문의 대상을 따라간다", async () => {
    // 블록 패널의 "수집 중" 카드와 답변 입력 아래의 현재 블록 안내가 이 값을 읽습니다. ref로만
    // 들고 있으면 대상이 바뀌어도 렌더가 일어나지 않아 화면이 앞 블록에 멈춥니다.
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: SUFFICIENT } }))],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(result.current.currentTarget).toEqual({ targetBlock: "problem", targetElement: "a" });
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    await waitFor(() =>
      expect(result.current.currentTarget).toEqual({ targetBlock: "alternatives", targetElement: "a" })
    );
  });

  it("블록 갱신을 호출하는 동안 isBlockUpdating이 참이다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    // 응답을 우리가 풀어 줄 때까지 붙잡아 호출 중인 구간을 만듭니다.
    let release: (response: Response) => void = () => {};
    const blockUpdate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return (fetchImpl.mock.calls.length === 1 ? q1 : q2).response;
      return blockUpdate;
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });
    await waitFor(() => expect(result.current.isBlockUpdating).toBe(true));

    await act(async () => {
      release(jsonResponse(200, blockUpdateBody({})));
    });
    await waitFor(() => expect(result.current.isBlockUpdating).toBe(false));
  });

  it("블록 갱신이 실패해도 질문은 그대로 요청되고, 재시도로 미반영 턴을 다시 반영한다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE } })),
      ],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    // 실패해도 질문은 그대로 요청됩니다(질문1, 블록갱신 실패, 질문2).
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(result.current.unreflectedTurnId).toBe("t1");
    // 블록 패널이 어느 카드에 오류를 그릴지 정하려면 미반영 턴이 겨냥했던 블록도 알아야 합니다.
    expect(result.current.unreflectedBlocks).toEqual(["problem"]);
    // 실패만으로 같은 블록에 고정하지 않습니다. 이전 평가(null)로도 계속 이동 정책을 따릅니다.
    completeQuestion(q2, "다른 질문");
    await waitFor(() => expect(result.current.messages).toHaveLength(3));

    act(() => {
      result.current.retryUnreflectedBlockUpdate();
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(result.current.unreflectedTurnId).toBeNull());
    await waitFor(() => expect(result.current.unreflectedBlocks).toEqual([]));
    expect(result.current.blockState.evaluation.problem).toEqual(ASKABLE);
  });

  it("블록 갱신 실패를 다음 질문 요청의 lastOutcome에 실어 보낸다 (구현검토 P1-5)", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } })],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    // 질문1, 블록갱신 실패, 질문2(블록 갱신 실패 사실을 lastOutcome에 실어 보냄).
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const secondQuestionBody = callBody(fetchImpl.mock.calls[2] as [RequestInfo | URL, RequestInit?]);
    expect(secondQuestionBody).toMatchObject({
      lastOutcome: { blockUpdateFailed: true, targetResponse: null, conflicts: [] },
    });
  });

  it("정상 반영에 provided 응답, 충돌 없는 흔한 턴은 다음 질문 요청에 lastOutcome을 싣지 않는다 (구현검토 P1-5)", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ targetResponse: "provided" }))],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const secondQuestionBody = callBody(fetchImpl.mock.calls[2] as [RequestInfo | URL, RequestInit?]) as Record<string, unknown>;
    expect(secondQuestionBody.lastOutcome).toBeUndefined();
  });

  it("성공한 다음 턴이 앞서 실패한 턴의 미반영 표시를 지우지 않는다 (구현검토 P1-2, R3)", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const q3 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2, q3],
      blockUpdateResponses: [
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }), // t1 실패
        jsonResponse(200, blockUpdateBody()), // t2 성공
      ],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "질문1");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t1 답변"));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3)); // 질문1, 블록갱신 실패, 질문2
    expect(result.current.unreflectedTurnId).toBe("t1");

    completeQuestion(q2, "질문2");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t2 답변"));

    await waitFor(() => expect(result.current.turnsUsed).toBe(2));
    // t2는 성공했지만 t1은 여전히 미반영이어야 합니다. 단일 슬롯이던 이전 구현은 t2 성공이
    // t1의 실패 기록을 통째로 지웠습니다.
    expect(result.current.unreflectedTurnId).toBe("t1");
  });

  it("미반영 재처리가 끝나기 전까지는 현재 답변의 블록 갱신을 시작하지 않는다 (추가 재검증 2026-09-12, S3)", async () => {
    // 이전 구현은 새 블록 갱신 호출이 시작될 때마다 진행 중이던 호출을 무조건 abort했습니다. 그래서
    // t1 재처리가 시작되며 마침 진행 중이던 t2의 호출을 abort하면, t2는 미반영으로도 등록되지 못한
    // 채 사라졌습니다. 이 테스트는 그 경합이 다시 생기지 않는지, 즉 t1 재처리와 t2의 블록 갱신이
    // 결코 동시에 실행되지 않는지를 직접 확인합니다.
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const questionSources = [q1, q2];
    let questionIndex = 0;
    let blockUpdateCalls = 0;
    let resolveDelayedRetry!: (value: unknown) => void;
    const delayedRetryJson = new Promise<unknown>((resolve) => {
      resolveDelayedRetry = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return questionSources[questionIndex++].response;
      if (url === BLOCK_UPDATE_URL) {
        blockUpdateCalls += 1;
        if (blockUpdateCalls === 1) return jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }); // t1, 실패
        if (blockUpdateCalls === 2) return { ok: true, status: 200, json: () => delayedRetryJson } as unknown as Response; // t1 재처리, 응답 지연
        return jsonResponse(200, { state: { ...emptyExperienceBlockState(), version: 2 }, affectedBlocks: [], targetResponse: "provided" }); // t2
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "질문1");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t1 답변"));
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));

    completeQuestion(q2, "질문2");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    // t1 재처리를 걸어 둡니다(응답은 아직 오지 않아 큐를 점유합니다).
    act(() => result.current.retryUnreflectedBlockUpdate());
    await waitFor(() => expect(blockUpdateCalls).toBe(2));

    // t2를 제출합니다. t1 재처리가 아직 끝나지 않았으므로 t2의 블록 갱신 호출은 큐에서 기다려야
    // 하고, 이 시점에는 아직 나가면 안 됩니다.
    await act(async () => {
      result.current.submitAnswer("t2 답변");
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(blockUpdateCalls).toBe(2);

    // t1 재처리 응답이 도착하면 그제서야 큐가 넘어가 t2의 블록 갱신이 실행됩니다.
    await act(async () => {
      resolveDelayedRetry({ state: { ...emptyExperienceBlockState(), version: 1 }, affectedBlocks: [], targetResponse: "provided" });
      await delayedRetryJson;
    });
    await waitFor(() => expect(blockUpdateCalls).toBe(3));
    await waitFor(() => expect(result.current.blockState.version).toBe(2));
    // t1도 이번 재처리로 성공해 미반영 목록에서 빠집니다. t2가 겹쳐 들어와 사라지는 일도,
    // t1의 낡은 버전이 t2의 결과를 덮어쓰는 일도 없습니다.
    expect(result.current.unreflectedTurnId).toBeNull();
  });

  it("유효한 질문 후보가 없으면 질문을 만들지 않고 완료 대기 상태로 둔다. 사용자가 종료해야 실제로 끝난다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1],
      blockUpdateResponses: [
        jsonResponse(
          200,
          blockUpdateBody({ evaluation: { problem: SUFFICIENT, alternatives: SUFFICIENT, action: SUFFICIENT, result: SUFFICIENT } })
        ),
      ],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("모든 블록이 이 답변 하나로 충분해졌다고 가정합니다.");
    });

    await waitFor(() => expect(result.current.isReadyToFinish).toBe(true));
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 질문1, 블록갱신1. 질문2는 없습니다.
    expect(result.current.isEnded).toBe(false);
    expect(result.current.endReason).toBeNull();

    act(() => {
      result.current.endInterview();
    });
    expect(result.current.isEnded).toBe(true);
    expect(result.current.endReason).toBe("user");
  });

  it("완료 대기 상태에서도 종료 전에는 보충 답변을 제출할 수 있다. 보충 답변은 턴으로 세지 않는다 (구현검토 P1-4, R7 / 추가 재검증 2026-09-12, S5)", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1],
      blockUpdateResponses: [
        jsonResponse(
          200,
          blockUpdateBody({ evaluation: { problem: SUFFICIENT, alternatives: SUFFICIENT, action: SUFFICIENT, result: SUFFICIENT } })
        ),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: SUFFICIENT, alternatives: SUFFICIENT, action: SUFFICIENT, result: SUFFICIENT } })),
      ],
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("모든 블록이 이 답변 하나로 충분해졌다고 가정합니다.");
    });
    await waitFor(() => expect(result.current.isReadyToFinish).toBe(true));
    expect(result.current.isEnded).toBe(false);
    // 완료 안내 전 마지막 실제 질문·답변까지의 턴 수입니다. 이 값이 보충 답변으로 늘면 안 됩니다.
    expect(result.current.turnsUsed).toBe(1);

    // 완료 대기 안내가 "질문" 자리에 들어와야 보충 답변을 받아도 질문·답변 교대 계약이 깨지지
    // 않습니다(구현검토 P1-4 1차 수정의 회귀, 재검증에서 발견). 답변만 이어 붙이면 다음 실제 질문
    // 요청에서 서버가 이력 모양을 거절합니다.
    await waitFor(() => expect(result.current.messages.at(-1)?.role).toBe("question"));
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    let accepted = false;
    act(() => {
      accepted = result.current.submitAnswer("사실 결과 확인 방법을 하나 더 적고 싶습니다.");
    });
    expect(accepted).toBe(true);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3)); // 질문1, 블록갱신1, 블록갱신2(보충)
    expect(result.current.isEnded).toBe(false);
    // 완료 안내에 대한 보충 답변은 설계 6-1절 "안내 메시지는 턴에 포함하지 않는다"에 따라 턴으로
    // 세지 않습니다. 이전 구현은 이 답변도 그대로 세어 실제 질문 한 번인데 turnsUsed가 2가
    // 됐습니다(추가 재검증 2026-09-12, S5).
    expect(result.current.turnsUsed).toBe(1);
    // 여전히 완료 대기라 다시 완료 안내가 붙고, 그 뒤로도 보충 답변을 또 받을 수 있습니다.
    await waitFor(() => expect(result.current.messages.at(-1)?.role).toBe("question"));
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
  });

  it("블록 갱신이 진행 중일 때 종료하면 그 호출을 끊고 미반영으로 등록한 뒤 한 번 더 반영을 시도한다 (구현검토 P1-2, R6)", async () => {
    const q1 = controllableResponse();
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return q1.response;
      if (url === BLOCK_UPDATE_URL) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        });
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

    act(() => {
      result.current.endInterview();
    });

    // 끊긴 호출은 실패로 취급하지 않지만(사용자가 끊은 것이지 오류가 아닙니다), 그 턴의 정보를
    // 잃지 않도록 미반영으로 등록하고 한 번 더 반영을 시도합니다(이 목은 재시도도 다시 걸어 두어
    // 그 호출도 끝나지 않고 남습니다).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.unreflectedTurnId).toBe("t1");
    expect(result.current.isEnded).toBe(true);
    // 원래 호출과 종료 시점의 재시도, 둘 다 나갑니다. 끊긴 자리에서 다음 "질문" 요청은 나오지 않습니다.
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("언마운트하면 진행 중이던 블록 갱신을 끊고 그 뒤 응답이 와도 다음 질문을 요청하지 않는다 (구현검토 P1-3, R5)", async () => {
    const q1 = controllableResponse();
    let blockUpdateSignal: AbortSignal | undefined;
    let resolveBlockUpdate!: (value: Response) => void;
    const blockUpdatePromise = new Promise<Response>((resolve) => {
      resolveBlockUpdate = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return q1.response;
      if (url === BLOCK_UPDATE_URL) {
        blockUpdateSignal = init?.signal ?? undefined;
        return blockUpdatePromise;
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const { result, unmount } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "질문1");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t1 답변"));
    await waitFor(() => expect(blockUpdateSignal).toBeDefined());

    const callsBeforeUnmount = fetchImpl.mock.calls.length;
    unmount();

    // 언마운트 뒤에야 블록 갱신이 응답합니다(정상 응답이며 abort로 인한 거절이 아닙니다).
    await act(async () => {
      resolveBlockUpdate(jsonResponse(200, blockUpdateBody()));
      await blockUpdatePromise;
    });

    expect(blockUpdateSignal?.aborted).toBe(true);
    // 언마운트 뒤에는 다음 질문을 요청하지 않습니다.
    expect(fetchImpl).toHaveBeenCalledTimes(callsBeforeUnmount);
  });

  it("언마운트하면 재처리 큐에 남은 다른 미반영 턴의 블록 갱신도 더 이상 실행하지 않는다 (추가 재검증 2026-09-12, S4)", async () => {
    // 이전 구현은 큐에 남은 다음 항목을 무조건 실행해, 언마운트 후에도 네트워크 요청이 하나 더 나갔습니다.
    // 큐가 자기 차례에 오면 그때마다 언마운트 여부를 다시 확인해야 이 문제가 생기지 않습니다.
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const questionSources = [q1, q2];
    let questionIndex = 0;
    let blockUpdateCalls = 0;
    let resolveT1Retry!: (value: unknown) => void;
    const t1RetryJson = new Promise<unknown>((resolve) => {
      resolveT1Retry = resolve;
    });
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return questionSources[questionIndex++].response;
      if (url === BLOCK_UPDATE_URL) {
        blockUpdateCalls += 1;
        if (blockUpdateCalls === 1) return jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }); // t1 실패
        if (blockUpdateCalls === 2) return jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }); // t2 실패
        if (blockUpdateCalls === 3) return { ok: true, status: 200, json: () => t1RetryJson } as unknown as Response; // t1 재처리, 응답 지연
        throw new Error("t2 재처리 호출이 언마운트 뒤에도 나가면 안 됩니다");
      }
      throw new Error(`unexpected url: ${url}`);
    });
    const { result, unmount } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "질문1");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t1 답변"));
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));

    completeQuestion(q2, "질문2");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => result.current.submitAnswer("t2 답변"));
    await waitFor(() => expect(blockUpdateCalls).toBe(2)); // t1, t2 모두 실패해 둘 다 미반영입니다.

    // 둘 다 한꾹에 재처리합니다. 큐 순서상 t1이 먼저 실행되고 t2는 그 뒤에서 기다립니다.
    act(() => result.current.retryUnreflectedBlockUpdate());
    await waitFor(() => expect(blockUpdateCalls).toBe(3)); // t1 재처리만 나갔고 t2는 아직 큐에서 대기 중입니다.

    unmount();

    // t1 재처리가 성공으로 끝나면 큐가 t2로 넘어가지만, 언마운트되었으므로 t2의 블록 갱신 호출은
    // 나가지 않아야 합니다(이전 구현은 여기서 네 번째 호출을 내보냈습니다).
    await act(async () => {
      resolveT1Retry({ state: { ...emptyExperienceBlockState(), version: 1 }, affectedBlocks: [], targetResponse: "provided" });
      await t1RetryJson;
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(blockUpdateCalls).toBe(3);
  });

  it("열 턴을 채우면 사용자 조작 없이 자동으로 종료하고 사유를 turn_limit으로 남긴다", async () => {
    const questionSources = Array.from({ length: 10 }, () => controllableResponse());
    const blockUpdateResponses = Array.from({ length: 10 }, () => jsonResponse(200, blockUpdateBody()));
    const fetchImpl = makeFetchImpl({ questionSources, blockUpdateResponses });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );

    for (let turn = 1; turn <= 10; turn += 1) {
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2 * turn - 1));
      completeQuestion(questionSources[turn - 1], `질문 ${turn}`);
      await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
      act(() => {
        result.current.submitAnswer(`답변 ${turn}`);
      });
      if (turn < 10) {
        await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2 * turn + 1));
      }
    }

    // 평가가 끝까지 null이라 problem은 스스로 닫히지 않습니다. 두 요소를 번갈아 묻다가, 남은 질문
    // 수가 미확인 블록 수 이하가 되는 시점(예약 예산, progress.test.ts와 같은 규칙)에만 다음
    // 미확인 블록으로 강제 이동합니다.
    const targets = fetchImpl.mock.calls
      .filter((call) => String(call[0]) === QUESTION_URL)
      .map((call) => callBody(call) as { targetBlock: string; targetElement: string });
    expect(targets.map((t) => `${t.targetBlock}.${t.targetElement}`)).toEqual([
      "problem.a",
      "problem.b",
      "problem.a",
      "problem.b",
      "problem.a",
      "problem.b",
      "problem.a",
      "alternatives.a",
      "action.a",
      "result.a",
    ]);

    await waitFor(() => expect(result.current.turnsUsed).toBe(10));
    await waitFor(() => expect(result.current.isEnded).toBe(true));
    expect(result.current.endReason).toBe("turn_limit");
    // 열 번째 질문(질문 10) 뒤에 열한 번째 질문 요청은 없습니다.
    expect(fetchImpl).toHaveBeenCalledTimes(20);
  });

  it("마지막 턴의 블록 갱신이 실패해도 열 턴 자동 종료가 한 번 더 반영을 시도한다 (구현검토 P1-2, R9)", async () => {
    const questionSources = Array.from({ length: 10 }, () => controllableResponse());
    const blockUpdateResponses = [
      ...Array.from({ length: 9 }, () => jsonResponse(200, blockUpdateBody())),
      jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }), // 10번째 턴 실패
      jsonResponse(200, blockUpdateBody()), // 종료 시 재시도는 성공
    ];
    const fetchImpl = makeFetchImpl({ questionSources, blockUpdateResponses });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );

    for (let turn = 1; turn <= 10; turn += 1) {
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2 * turn - 1));
      completeQuestion(questionSources[turn - 1], `질문 ${turn}`);
      await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
      act(() => {
        result.current.submitAnswer(`답변 ${turn}`);
      });
    }

    await waitFor(() => expect(result.current.isEnded).toBe(true));
    expect(result.current.endReason).toBe("turn_limit");
    // 질문 10회 + 블록 갱신 10회 + 상한 종료가 시도한 마지막 재처리 1회 = 21회입니다. 이전
    // 구현은 `inner.endInterview()`를 곧장 불러 이 재처리 없이 그대로 끝났습니다.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(21));
    expect(result.current.unreflectedTurnId).toBeNull();
  });
});

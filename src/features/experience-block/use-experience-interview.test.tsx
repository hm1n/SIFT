// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { encodeSseEvent } from "@/features/interview/sse";
import type { BlockUpdateSaveStatus } from "@/features/saved-interviews/save-status";
import { emptyInterviewProgress, recordAsked, recordResponse } from "./progress";
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
    version?: number;
    save?: BlockUpdateSaveStatus;
  } = {}
) {
  const base = emptyExperienceBlockState();
  const state: ExperienceBlockState = {
    ...base,
    version: overrides.version ?? base.version + 1,
    evaluation: { ...base.evaluation, ...overrides.evaluation },
  };
  return {
    state,
    affectedBlocks: [],
    targetResponse: overrides.targetResponse ?? "provided",
    save: overrides.save ?? "skipped",
  };
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

  it("재처리 중 updatingBlock이 currentTarget이 아니라 그 턴의 블록을 가리킨다", async () => {
    // 블록 패널은 "수집 중" 카드를 이 값으로 정합니다. `isBlockUpdating` 불리언만 있으면 화면이
    // `currentTarget`이라고 짐작해야 하는데, 재처리는 예전 턴의 대상을 갱신하므로 그 짐작이 틀려
    // 관계없는 카드가 수집 중으로 보였습니다(PR #121 리뷰 1라운드).
    const questions = [controllableResponse(), controllableResponse(), controllableResponse()];
    // 재처리 응답을 우리가 풀어 줄 때까지 붙잡아 호출 중인 구간을 만듭니다.
    let release: (response: Response) => void = () => {};
    const heldRetry = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let questionIndex = 0;
    let blockUpdateCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === QUESTION_URL) return questions[questionIndex++].response;
      blockUpdateCalls += 1;
      // 1번 턴은 실패해 미반영으로 남고, 2번 턴은 성공해 대상을 다음 블록으로 넘깁니다.
      if (blockUpdateCalls === 1) return jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } });
      if (blockUpdateCalls === 2) return jsonResponse(200, blockUpdateBody({ evaluation: { problem: SUFFICIENT } }));
      return heldRetry;
    });
    const { result } = renderHook(() =>
      useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate })
    );

    await waitFor(() => expect(questionIndex).toBe(1));
    completeQuestion(questions[0], "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });
    await waitFor(() => expect(result.current.unreflectedBlocks).toEqual(["problem"]));

    await waitFor(() => expect(questionIndex).toBe(2));
    completeQuestion(questions[1], "조금 더 자세히 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => {
      result.current.submitAnswer("로그가 비어 있었습니다.");
    });

    // 2번 턴이 problem을 충분으로 만들어 다음 질문은 다른 블록을 겨냥합니다. 여기서 두 값이 갈립니다.
    await waitFor(() => expect(result.current.currentTarget.targetBlock).not.toBe("problem"));
    expect(result.current.unreflectedBlocks).toEqual(["problem"]);

    act(() => {
      result.current.retryUnreflectedBlockUpdate();
    });

    await waitFor(() => expect(result.current.isBlockUpdating).toBe(true));
    expect(result.current.updatingBlock).toBe("problem");
    expect(result.current.updatingBlock).not.toBe(result.current.currentTarget.targetBlock);

    await act(async () => {
      release(jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE } })));
    });
    await waitFor(() => expect(result.current.updatingBlock).toBeNull());
  });

  it("큐에 들어간 턴을 다시 등록하지 않는다", async () => {
    // 직렬 큐는 동시 실행만 막고 이미 들어간 중복은 지우지 않습니다. `isBlockUpdating`으로도 막지
    // 못합니다. 그 값은 큐에 넣는 시점이 아니라 `runApplyTurn`이 차례를 잡았을 때 참이 됩니다
    // (PR #121 리뷰 2라운드, backlog 3번).
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    let release: (response: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    let blockUpdateCalls = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input) === QUESTION_URL) return (blockUpdateCalls === 0 ? q1 : q2).response;
      blockUpdateCalls += 1;
      if (blockUpdateCalls === 1) return jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } });
      return held;
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
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));
    expect(blockUpdateCalls).toBe(1);

    // 한 틱 안에 두 번 부르면 예전에는 큐에 두 번 들어가 갱신 요청이 두 번 나갔습니다.
    act(() => {
      result.current.retryUnreflectedBlockUpdate();
      result.current.retryUnreflectedBlockUpdate();
    });
    await waitFor(() => expect(result.current.isBlockUpdating).toBe(true));
    expect(blockUpdateCalls).toBe(2);

    await act(async () => {
      release(jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE } })));
    });
    await waitFor(() => expect(result.current.unreflectedTurnId).toBeNull());
    // 큐에 남아 있던 중복이 뒤늦게 실행되지 않습니다.
    expect(blockUpdateCalls).toBe(2);
  });

  it("재처리가 큐에만 있을 때 종료해도 같은 턴을 다시 등록하지 않는다", async () => {
    // `endInterview`도 `retryAllUnreflected`를 부르는데 종료 버튼은 `isBlockUpdating`으로 잠기지
    // 않습니다. 재처리가 아직 자기 차례를 잡기 전이면 끊을 호출이 없어, 예전에는 같은 턴이 큐에 두 번
    // 들어갔습니다. 진행 중인 호출을 끊고 다시 반영하는 경로(구현검토 P1-2, R6)와는 다릅니다.
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE } })),
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
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));
    const beforeRetry = fetchImpl.mock.calls.filter(([input]) => String(input) === BLOCK_UPDATE_URL).length;
    expect(beforeRetry).toBe(1);

    // 같은 틱에 부릅니다. 재처리는 큐에 들어가기만 하고 아직 실행되지 않은 상태입니다.
    act(() => {
      result.current.retryUnreflectedBlockUpdate();
      result.current.endInterview();
    });

    await waitFor(() => expect(result.current.isEnded).toBe(true));
    await waitFor(() => expect(result.current.unreflectedTurnId).toBeNull());
    const afterRetry = fetchImpl.mock.calls.filter(([input]) => String(input) === BLOCK_UPDATE_URL).length;
    expect(afterRetry).toBe(2);
  });

  it("앞선 재처리가 끝난 뒤에는 같은 턴을 다시 재처리할 수 있다", async () => {
    // 중복 방지가 재시도 자체를 막으면 안 됩니다. 두 번째 재처리로 실제로 반영되어야 합니다.
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }),
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "또 실패" } }),
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
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));

    act(() => {
      result.current.retryUnreflectedBlockUpdate();
    });
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));
    await waitFor(() => expect(result.current.isBlockUpdating).toBe(false));

    act(() => {
      result.current.retryUnreflectedBlockUpdate();
    });
    await waitFor(() => expect(result.current.unreflectedTurnId).toBeNull());
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

  it("Strict Mode로 두 번 마운트해도 첫 답변의 블록 갱신을 보낸다", async () => {
    // Strict Mode는 개발에서 effect를 setup → cleanup → setup으로 실행합니다. 언마운트 표시를
    // setup에서 되돌리지 않으면 첫 cleanup이 남긴 값 때문에 마운트된 훅이 스스로를 언마운트됐다고
    // 판단합니다. 그러면 답변을 제출해도 블록 갱신 요청을 보내지 않고 그 턴을 미반영으로 남긴 뒤
    // 다음 질문도 시작하지 않아, 화면이 첫 답변 뒤 로딩에서 멈춥니다.
    const questions: ReturnType<typeof controllableResponse>[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) {
        const source = controllableResponse();
        questions.push(source);
        return source.response;
      }
      return jsonResponse(200, blockUpdateBody({ evaluation: { problem: SUFFICIENT } }));
    });
    const { result } = renderHook(
      () => useExperienceInterview({ questionUrl: QUESTION_URL, blockUpdateUrl: BLOCK_UPDATE_URL, snapshot, fetchImpl, ...immediate }),
      { wrapper: StrictMode }
    );
    await waitFor(() => expect(questions.length).toBeGreaterThan(0));
    // 앞선 마운트의 스트림은 cleanup이 끊었으므로 마지막 요청만 살아 있습니다.
    completeQuestion(questions[questions.length - 1], "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("화면이 비어 있었습니다.");
    });

    await waitFor(() =>
      expect(fetchImpl.mock.calls.filter(([input]) => String(input) === BLOCK_UPDATE_URL)).toHaveLength(1)
    );
    // 다음 질문 요청까지 이어져야 로딩이 풀립니다.
    await waitFor(() =>
      expect(result.current.currentTarget).toEqual({ targetBlock: "alternatives", targetElement: "a" })
    );
    expect(result.current.unreflectedTurnId).toBeNull();
  });
});

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";

/**
 * 이슈 #115의 저장 얹기입니다. 저장 전용 요청을 만들지 않고 블록 갱신 요청에 저장 대상을 실어 보냅니다.
 * 훅이 들고 있어야 하는 것은 둘입니다. 마지막으로 저장에 성공한 블록 버전과, 아직 저장되지 않은 턴입니다.
 */
describe("useExperienceInterview 저장 얹기", () => {
  /** 질문 하나를 받아 답하고 블록 갱신까지 끝냅니다. 저장 관련 본문만 보는 테스트의 준비 과정입니다. */
  async function answerOnce(
    result: { current: ReturnType<typeof useExperienceInterview> },
    source: ReturnType<typeof controllableResponse>,
    answer: string
  ) {
    completeQuestion(source, "문제 상황을 알려주세요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    act(() => {
      result.current.submitAnswer(answer);
    });
  }

  function renderWithSave(
    fetchImpl: ReturnType<typeof makeFetchImpl>,
    interviewId: string | null = INTERVIEW_ID,
    completeInterview: (id: string) => Promise<void> = async () => undefined
  ) {
    return renderHook(() =>
      useExperienceInterview({
        questionUrl: QUESTION_URL,
        blockUpdateUrl: BLOCK_UPDATE_URL,
        snapshot,
        interviewId,
        completeInterview,
        fetchImpl,
        ...immediate,
      })
    );
  }

  /**
   * 목록의 기호와 세션 화면의 버튼 문구가 이 상태를 읽습니다. 끝내는 조작은 답변 제출과 함께 오지
   * 않아서 턴 저장에 얹을 수 없고, 별도 요청으로 알립니다.
   */
  it("인터뷰를 끝내면 끝난 것으로 표시한다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    const completeInterview = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderWithSave(fetchImpl, INTERVIEW_ID, completeInterview);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.endInterview();
    });

    await waitFor(() => expect(completeInterview).toHaveBeenCalledWith(INTERVIEW_ID));
  });

  it("같은 인터뷰를 두 번 끝내도 표시는 한 번만 보낸다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    const completeInterview = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderWithSave(fetchImpl, INTERVIEW_ID, completeInterview);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.endInterview();
      result.current.endInterview();
    });

    await waitFor(() => expect(completeInterview).toHaveBeenCalledTimes(1));
  });

  // 저장하지 않는 인터뷰에는 표시할 줄이 없습니다.
  it("인터뷰 줄이 없으면 끝내도 아무것도 보내지 않는다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    const completeInterview = vi.fn<(id: string) => Promise<void>>().mockResolvedValue(undefined);
    const { result } = renderWithSave(fetchImpl, null, completeInterview);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.endInterview();
    });

    expect(completeInterview).not.toHaveBeenCalled();
  });

  it("인터뷰 줄이 있으면 저장 대상을 블록 갱신 요청에 싣는다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, save: "saved" }))],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "화면이 비어 있었습니다.");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

    const body = callBody(fetchImpl.mock.calls[1]) as { save: Record<string, unknown> };
    expect(body.save).toMatchObject({
      interviewId: INTERVIEW_ID,
      // 아직 한 번도 저장하지 않았으므로 저장된 버전은 0입니다.
      expectedBlockVersion: 0,
      pendingTurnIds: [],
      askedCountAtQuestion: 1,
    });
    // 이번 답변의 반응은 아직 반영하지 않은 값이어야 합니다. 반영은 서버가 합니다.
    expect(body.save.progress).toMatchObject({
      problem: { elements: { a: { askedCount: 1, firstUnknownAskedCount: null } } },
    });
    await waitFor(() => expect(result.current.saveStatus).toBe("saved"));
    expect(result.current.unsavedTurnCount).toBe(0);
  });

  it("인터뷰 줄이 없으면 저장 대상을 싣지 않고 저장 상태도 바꾸지 않는다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE } }))],
    });
    const { result } = renderWithSave(fetchImpl, null);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "화면이 비어 있었습니다.");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

    expect(callBody(fetchImpl.mock.calls[1])).not.toHaveProperty("save");
    expect(result.current.saveStatus).toBeNull();
  });

  /**
   * 저장된 버전을 화면의 `blockState.version`으로 대신하면, 저장이 한 번 밀린 뒤 둘이 어긋나
   * 이후의 모든 저장이 조건에 걸립니다. 저장에 성공한 버전만 올려야 합니다.
   */
  it("저장에 성공하면 다음 요청의 기대 버전이 저장된 버전으로 오른다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const q3 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2, q3],
      blockUpdateResponses: [
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, version: 1, save: "saved" })),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, version: 2, save: "saved" })),
      ],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "첫 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    await answerOnce(result, q2, "둘째 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));

    const second = callBody(fetchImpl.mock.calls[3]) as { save: Record<string, unknown> };
    expect(second.save).toMatchObject({ expectedBlockVersion: 1, pendingTurnIds: [] });
    expect(result.current.unsavedTurnCount).toBe(0);
  });

  /**
   * 저장이 밀린 턴은 다음 저장이 함께 이어 붙여야 합니다. 이것을 하지 않으면 저장된 대화의 중간이
   * 비고, 이어가기로 돌아온 사용자가 자기 답변 하나를 잃습니다.
   */
  it("저장이 실패한 턴을 다음 요청의 밀린 턴으로 싣고 기대 버전은 그대로 둔다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const q3 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2, q3],
      blockUpdateResponses: [
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, version: 1, save: "failed" })),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, version: 2, save: "saved" })),
      ],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "첫 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.saveStatus).toBe("failed"));
    expect(result.current.unsavedTurnCount).toBe(1);

    await answerOnce(result, q2, "둘째 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5));

    const second = callBody(fetchImpl.mock.calls[3]) as { save: Record<string, unknown> };
    expect(second.save).toMatchObject({ expectedBlockVersion: 0, pendingTurnIds: ["t1"] });
    // 밀린 턴까지 함께 저장됐으므로 표시를 지웁니다.
    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(0));
    expect(result.current.saveStatus).toBe("saved");
  });

  // 블록 갱신 자체가 실패하면 저장도 이뤄지지 않았습니다. 그 턴도 밀린 턴이어야 합니다.
  it("블록 갱신이 실패한 턴도 밀린 턴으로 남긴다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } })],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "첫 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));

    expect(result.current.unsavedTurnCount).toBe(1);
    expect(result.current.saveStatus).toBe("failed");
  });

  /**
   * "다시 저장" 버튼입니다. 반영은 끝났는데 저장만 밀린 턴을 모델을 부르지 않고 다시 저장합니다.
   * 같은 답변으로 블록 갱신을 다시 부르면 같은 주장이 블록에 두 번 들어갑니다.
   */
  it("저장만 밀린 턴을 모델 없이 다시 저장한다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, save: "failed" })),
        jsonResponse(200, { save: "saved" }),
      ],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await answerOnce(result, q1, "첫 답변");
    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(1));

    act(() => {
      result.current.retrySave();
    });

    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(0));
    const retry = callBody(fetchImpl.mock.calls[3]) as { mode: string; save: Record<string, unknown> };
    expect(retry.mode).toBe("save_only");
    expect(retry.save).toMatchObject({ pendingTurnIds: ["t1"], expectedBlockVersion: 0 });
    expect(result.current.saveStatus).toBe("saved");
  });

  /**
   * 반영까지 밀린 턴은 블록 갱신을 다시 걸 때 그 요청이 저장까지 함께 합니다. 저장 전용 요청이 같은
   * 턴을 또 보내면 같은 질문과 답변이 저장된 대화에 두 번 들어갑니다.
   */
  it("반영이 밀린 턴은 저장 전용 요청으로 보내지 않는다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(502, { error: { kind: "block_update_rejected", message: "검증 실패" } }),
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, save: "saved" })),
      ],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    await answerOnce(result, q1, "첫 답변");
    await waitFor(() => expect(result.current.unreflectedTurnId).toBe("t1"));

    act(() => {
      result.current.retrySave();
    });

    // 블록 갱신 재시도 하나만 나가고 저장 전용 요청은 나가지 않습니다.
    await waitFor(() => expect(result.current.unreflectedTurnId).toBeNull());
    const bodies = fetchImpl.mock.calls.map((call) => callBody(call) as { mode?: string });
    expect(bodies.filter((body) => body.mode === "save_only")).toHaveLength(0);
    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(0));
  });

  // 다른 탭이 먼저 저장한 경우입니다. 화면이 최신 내용을 다시 불러올지 물어야 하므로 갈라 둡니다.
  it("버전 충돌을 그대로 올린다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [
        jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, save: "version_conflict" })),
      ],
    });
    const { result } = renderWithSave(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    await answerOnce(result, q1, "첫 답변");

    await waitFor(() => expect(result.current.saveStatus).toBe("version_conflict"));
    expect(result.current.unsavedTurnCount).toBe(1);
  });
});

/**
 * 저장된 인터뷰로 이어가기입니다(이슈 #115). 화면이 빈 상태가 아닌 상태로 시작할 수 있어야 하고,
 * 그 상태에서 "다음에 물을 것"을 다시 골라야 합니다.
 */
describe("useExperienceInterview 이어가기", () => {
  const HISTORY = [
    { role: "question" as const, text: "문제 상황을 알려주세요" },
    { role: "answer" as const, text: "화면이 비어 있었습니다." },
  ];

  function restoredState(overrides: Partial<ExperienceBlockState["evaluation"]>, version = 1): ExperienceBlockState {
    const base = emptyExperienceBlockState();
    return { ...base, version, evaluation: { ...base.evaluation, ...overrides } };
  }

  function renderRestored(
    fetchImpl: ReturnType<typeof makeFetchImpl>,
    restore: {
      history: typeof HISTORY;
      blockState: ExperienceBlockState;
      progress: ReturnType<typeof emptyInterviewProgress>;
    }
  ) {
    return renderHook(() =>
      useExperienceInterview({
        questionUrl: QUESTION_URL,
        blockUpdateUrl: BLOCK_UPDATE_URL,
        snapshot,
        interviewId: "11111111-1111-4111-8111-111111111111",
        restore,
        fetchImpl,
        ...immediate,
      })
    );
  }

  it("저장된 대화를 그대로 들고 시작하고 저장된 상태에서 고른 대상으로 묻는다", async () => {
    const q = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q], blockUpdateResponses: [] });
    const { result } = renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({ problem: SUFFICIENT }),
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
    });

    expect(result.current.messages.map((message) => message.text)).toEqual([
      "문제 상황을 알려주세요",
      "화면이 비어 있었습니다.",
    ]);
    expect(result.current.turnsUsed).toBe(1);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    // problem이 이미 충분하므로 이어가기의 첫 질문은 alternatives로 갑니다.
    expect(callBody(fetchImpl.mock.calls[0])).toMatchObject({
      history: HISTORY,
      targetBlock: "alternatives",
      targetElement: "a",
    });
  });

  /**
   * 진행 상태를 이어받지 않으면 사용자가 이미 "기억나지 않는다"고 답한 요소를 예산만큼 다시 묻습니다.
   * 저장된 진행 상태가 그 예산을 그대로 들고 있어야 합니다.
   */
  it("재질문 예산을 다 쓴 요소는 이어가기에서 다시 묻지 않는다", async () => {
    const q = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q], blockUpdateResponses: [] });
    const spent = recordResponse(
      recordAsked(recordAsked(emptyInterviewProgress(), "problem", "a"), "problem", "a"),
      "problem",
      "a",
      "unknown",
      1
    );
    // 다른 블록은 모두 닫아 둡니다. 열린 블록이 problem 하나뿐이어야 요소 선택을 볼 수 있습니다.
    renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({
        problem: ASKABLE,
        alternatives: SUFFICIENT,
        action: SUFFICIENT,
        result: SUFFICIENT,
      }),
      progress: spent,
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    // a는 예산을 다 썼으므로 같은 블록의 b로 갑니다.
    expect(callBody(fetchImpl.mock.calls[0])).toMatchObject({ targetBlock: "problem", targetElement: "b" });
  });

  /**
   * 이어가기는 직전 질문이 어느 블록을 겨냥했는지를 모릅니다. 저장하는 값에 그 정보가 없고, 진행
   * 상태의 `askedCount`로 짐작하는 것은 대리 지표라 쓰지 않습니다. 그래서 아직 한 번도 다루지 않은
   * 블록이 있으면 그쪽을 먼저 묻습니다. 이어가기가 대화를 끊고 새 블록으로 넘어가는 것이 아니라,
   * 남은 블록을 먼저 채우는 것이 이 훅의 원래 선택 규칙입니다.
   */
  it("이어가기는 아직 다루지 않은 블록을 먼저 묻는다", async () => {
    const q = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q], blockUpdateResponses: [] });
    renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({ problem: ASKABLE }),
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(callBody(fetchImpl.mock.calls[0])).toMatchObject({ targetBlock: "alternatives", targetElement: "a" });
  });

  /**
   * 턴 번호가 1부터 다시 시작하면 이어가기의 첫 턴이 저장된 첫 턴과 같은 식별자를 받습니다. 밀린 턴을
   * 저장할 때 이력에서 턴을 식별자로 고르므로, 겹치면 엉뚱한 턴이 딸려 갑니다.
   */
  it("턴 번호를 저장된 턴 수 다음부터 센다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, save: "saved" }))],
    });
    const { result } = renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({ problem: ASKABLE }),
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "무엇이 문제였나요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("느렸습니다.");
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect(callBody(fetchImpl.mock.calls[1])).toMatchObject({ answerTurnId: "t2" });
    expect(result.current.turnsUsed).toBe(2);
  });

  // 저장된 블록 버전을 기대 버전으로 써야 합니다. 0으로 시작하면 이어가기의 첫 저장이 곧바로 충돌합니다.
  it("이어가기의 첫 저장은 저장된 블록 버전을 기대 버전으로 싣는다", async () => {
    const q1 = controllableResponse();
    const q2 = controllableResponse();
    const fetchImpl = makeFetchImpl({
      questionSources: [q1, q2],
      blockUpdateResponses: [jsonResponse(200, blockUpdateBody({ evaluation: { problem: ASKABLE }, version: 4, save: "saved" }))],
    });
    const { result } = renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({ problem: ASKABLE }, 3),
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
    });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    completeQuestion(q1, "무엇이 문제였나요");
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

    act(() => {
      result.current.submitAnswer("느렸습니다.");
    });

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    expect((callBody(fetchImpl.mock.calls[1]) as { save: Record<string, unknown> }).save).toMatchObject({
      expectedBlockVersion: 3,
    });
  });

  /**
   * 끝낸 인터뷰를 다시 열었을 때 훅이 질문을 새로 요청하면, 사용자가 끝낸 대화가 다시 자라나고
   * 목록의 끝남 표시와 화면이 어긋납니다.
   */
  it("끝난 인터뷰를 다시 열면 질문을 요청하지 않고 읽기 전용으로 연다", async () => {
    const fetchImpl = makeFetchImpl({ questionSources: [], blockUpdateResponses: [] });
    const { result } = renderHook(() =>
      useExperienceInterview({
        questionUrl: QUESTION_URL,
        blockUpdateUrl: BLOCK_UPDATE_URL,
        snapshot,
        interviewId: INTERVIEW_ID,
        completeInterview: async () => undefined,
        restore: {
          history: HISTORY,
          blockState: restoredState({ problem: ASKABLE }),
          progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
          status: "completed",
        },
        fetchImpl,
        ...immediate,
      })
    );

    await waitFor(() => expect(result.current.isEnded).toBe(true));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.current.canSubmitAnswer).toBe(false);
  });

  // 끝낸 인터뷰의 요약 화면으로 돌아가는 데 씁니다.
  it("끝내면 서버에 알린 뒤 끝났다고 알린다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    const order: string[] = [];
    const { result } = renderHook(() =>
      useExperienceInterview({
        questionUrl: QUESTION_URL,
        blockUpdateUrl: BLOCK_UPDATE_URL,
        snapshot,
        interviewId: INTERVIEW_ID,
        completeInterview: async () => {
          order.push("표시");
        },
        onCompleted: () => order.push("알림"),
        fetchImpl,
        ...immediate,
      })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.endInterview();
    });

    await waitFor(() => expect(order).toEqual(["표시", "알림"]));
  });

  // 저장하지 않는 인터뷰에는 돌아갈 요약이 없습니다.
  it("인터뷰 줄이 없으면 끝내도 알리지 않는다", async () => {
    const q1 = controllableResponse();
    const fetchImpl = makeFetchImpl({ questionSources: [q1], blockUpdateResponses: [] });
    const onCompleted = vi.fn();
    const { result } = renderHook(() =>
      useExperienceInterview({
        questionUrl: QUESTION_URL,
        blockUpdateUrl: BLOCK_UPDATE_URL,
        snapshot,
        interviewId: null,
        onCompleted,
        fetchImpl,
        ...immediate,
      })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.endInterview();
    });

    expect(onCompleted).not.toHaveBeenCalled();
  });

  // 더 물을 것이 없는 상태를 이어가면서 질문을 요청하면 모델이 이미 충분한 블록을 한 번 더 묻습니다.
  it("저장된 상태만으로 더 물을 것이 없으면 질문을 요청하지 않고 완료 대기로 시작한다", async () => {
    const fetchImpl = makeFetchImpl({ questionSources: [], blockUpdateResponses: [] });
    const { result } = renderRestored(fetchImpl, {
      history: HISTORY,
      blockState: restoredState({
        problem: SUFFICIENT,
        alternatives: SUFFICIENT,
        action: SUFFICIENT,
        result: SUFFICIENT,
      }),
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
    });

    await waitFor(() => expect(result.current.isReadyToFinish).toBe(true));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

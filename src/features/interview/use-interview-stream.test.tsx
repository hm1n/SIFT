// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERVIEW_HISTORY_MAX_ITEMS } from "./history";
import { evidenceSnapshotFixture } from "./question-fixture";
import { encodeSseEvent } from "./sse";
import { useInterviewStream } from "./use-interview-stream";

afterEach(cleanup);

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

describe("useInterviewStream", () => {
  it("한 프레임 안에 도착한 청크를 모아 한 번만 반영한다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);
    const frames: (() => void)[] = [];
    const scheduleFrame = vi.fn((callback: () => void) => frames.push(callback));

    const { result } = renderHook(() =>
      useInterviewStream({
        url: "/api/interview/stream",
        fetchImpl,
        sleep: async () => {},
        scheduleFrame: (callback) => scheduleFrame(callback),
        cancelFrame: () => {},
      })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    await act(async () => {
      source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "가" }));
      source.push(encodeSseEvent({ type: "chunk", seq: 2, text: "나" }));
      source.push(encodeSseEvent({ type: "chunk", seq: 3, text: "다" }));
      await Promise.resolve();
    });
    await waitFor(() => expect(scheduleFrame).toHaveBeenCalledTimes(1));
    expect(result.current.messages).toHaveLength(0);

    await act(async () => {
      frames.forEach((frame) => frame());
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0].text).toBe("가나다");
    expect(result.current.receivedSeq).toBe(3);
  });

  it("done이 오면 프레임을 기다리지 않고 남은 청크까지 반영하고 메시지를 닫는다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    const { result } = renderHook(() =>
      useInterviewStream({
        url: "/api/interview/stream",
        fetchImpl,
        sleep: async () => {},
        // 프레임을 영영 실행하지 않아도 done이 남은 청크를 반영해야 합니다.
        scheduleFrame: () => 0,
        cancelFrame: () => {},
      })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "마지막 청크" }));
    source.push(encodeSseEvent({ type: "done", seq: 1 }));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ text: "마지막 청크", isStreaming: false });
    expect(result.current.status).toBe("done");
  });

  it("오류가 나도 버퍼에 남은 청크를 화면에 반영한다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    const { result } = renderHook(() =>
      useInterviewStream({
        url: "/api/interview/stream",
        fetchImpl,
        sleep: async () => {},
        retryDelaysMs: [],
        scheduleFrame: () => 0,
        cancelFrame: () => {},
      })
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "받은 내용" }));
    source.close();

    await waitFor(() => expect(result.current.error?.kind).toBe("stream_interrupted"));
    expect(result.current.messages[0].text).toBe("받은 내용");
  });

  describe("대화 누적", () => {
    const snapshot = evidenceSnapshotFixture();
    const immediate = {
      sleep: async () => {},
      retryDelaysMs: [] as number[],
      scheduleFrame: (callback: () => void) => {
        callback();
        return 0;
      },
      cancelFrame: () => {},
    };

    /** 질문 하나를 완결까지 흘려 보냅니다. */
    function completeQuestion(source: ReturnType<typeof controllableResponse>, text: string) {
      source.push(encodeSseEvent({ type: "chunk", seq: 1, text }));
      source.push(encodeSseEvent({ type: "done", seq: 1 }));
    }

    it("첫 질문이 끝나기 전에는 답변을 받지 않는다", async () => {
      const first = controllableResponse();
      const fetchImpl = vi.fn().mockResolvedValueOnce(first.response);
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", snapshot, fetchImpl, ...immediate })
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

      first.push(encodeSseEvent({ type: "chunk", seq: 1, text: "아직 도착 중" }));
      await waitFor(() => expect(result.current.messages).toHaveLength(1));

      expect(result.current.canSubmitAnswer).toBe(false);
      let accepted = true;
      act(() => {
        accepted = result.current.submitAnswer("답변");
      });
      expect(accepted).toBe(false);
      expect(result.current.messages).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("답변을 제출하면 대화에 즉시 넣고 확정된 대화 전체를 이력으로 실어 보낸다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response);
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", snapshot, fetchImpl, ...immediate })
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      // 첫 질문은 이슈 #76 이전과 같은 본문입니다.
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ snapshot });

      completeQuestion(first, "첫 질문");
      await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

      act(() => {
        expect(result.current.submitAnswer("  첫 답변  ")).toBe(true);
      });

      // 요청 결과가 오기 전인데 답변이 이미 대화에 있습니다.
      expect(result.current.messages).toEqual([
        expect.objectContaining({ role: "question", text: "첫 질문", isStreaming: false }),
        expect.objectContaining({ role: "answer", text: "첫 답변", isStreaming: false }),
      ]);
      expect(result.current.canSubmitAnswer).toBe(false);

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
      expect(fetchImpl.mock.calls[1][1].headers["Last-Event-ID"]).toBeUndefined();
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
        snapshot,
        history: [
          { role: "question", text: "첫 질문" },
          { role: "answer", text: "첫 답변" },
        ],
      });

      completeQuestion(second, "둘째 질문");
      await waitFor(() => expect(result.current.messages).toHaveLength(3));
      expect(result.current.messages[2]).toMatchObject({ role: "question", text: "둘째 질문", isStreaming: false });
      // 새 스트림의 seq는 1부터 다시 셉니다. 앞 질문의 seq를 이어 쓰지 않습니다.
      expect(result.current.receivedSeq).toBe(1);
      expect(result.current.canSubmitAnswer).toBe(true);
    });

    it("빈 답변과 생성 중 제출은 받지 않는다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response);
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", snapshot, fetchImpl, ...immediate })
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      completeQuestion(first, "첫 질문");
      await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));

      act(() => {
        expect(result.current.submitAnswer("   \n ")).toBe(false);
      });
      expect(result.current.messages).toHaveLength(1);

      act(() => {
        expect(result.current.submitAnswer("첫 답변")).toBe(true);
        // 같은 틱에 두 번 눌러도 답변은 하나만 들어갑니다.
        expect(result.current.submitAnswer("첫 답변 다시")).toBe(false);
      });
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expect(result.current.messages.filter((message) => message.role === "answer")).toHaveLength(1);
    });

    it("다음 질문 생성이 실패해도 답변은 남고 다시 시도는 그 질문만 다시 만든다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const third = controllableResponse();
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(first.response)
        .mockResolvedValueOnce(second.response)
        .mockResolvedValueOnce(third.response);
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", snapshot, fetchImpl, ...immediate })
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      completeQuestion(first, "첫 질문");
      await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
      act(() => {
        result.current.submitAnswer("첫 답변");
      });
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      // 둘째 질문이 일부만 오고 끊깁니다.
      second.push(encodeSseEvent({ type: "chunk", seq: 1, text: "둘째 질문 앞부분" }));
      await waitFor(() => expect(result.current.messages).toHaveLength(3));
      second.close();
      await waitFor(() => expect(result.current.error?.kind).toBe("stream_interrupted"));

      // 실패해도 사용자의 답변은 그대로 있습니다. 오류 표시 중에는 다시 제출할 수 없습니다.
      expect(result.current.messages[1]).toMatchObject({ role: "answer", text: "첫 답변" });
      expect(result.current.canSubmitAnswer).toBe(false);

      act(() => {
        result.current.retry();
      });

      // 지우는 것은 실패한 질문 하나입니다. 첫 질문과 답변은 남고 같은 이력으로 다시 요청합니다.
      expect(result.current.messages.map((message) => message.text)).toEqual(["첫 질문", "첫 답변"]);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
      expect(JSON.parse(fetchImpl.mock.calls[2][1].body)).toEqual({
        snapshot,
        history: [
          { role: "question", text: "첫 질문" },
          { role: "answer", text: "첫 답변" },
        ],
      });

      completeQuestion(third, "둘째 질문 다시");
      await waitFor(() => expect(result.current.messages).toHaveLength(3));
      expect(result.current.messages[2]).toMatchObject({ role: "question", text: "둘째 질문 다시" });
      expect(result.current.error).toBeNull();
    });

    it("이력이 상한을 넘으면 보내기 전에 잘라내고 뺀 항목을 상태에 남긴다", async () => {
      const sources: ReturnType<typeof controllableResponse>[] = [];
      const fetchImpl = vi.fn().mockImplementation(async () => {
        const source = controllableResponse();
        sources.push(source);
        return source.response;
      });
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", snapshot, fetchImpl, ...immediate })
      );

      // 상한까지 채운 뒤 한 쌍을 더 넣습니다.
      const turns = INTERVIEW_HISTORY_MAX_ITEMS / 2 + 1;
      for (let turn = 1; turn <= turns; turn += 1) {
        await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(turn));
        completeQuestion(sources[turn - 1], `질문 ${turn}`);
        await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
        act(() => {
          result.current.submitAnswer(`답변 ${turn}`);
        });
      }
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(turns + 1));

      const lastBody = JSON.parse(fetchImpl.mock.calls[turns][1].body);
      expect(lastBody.history).toHaveLength(INTERVIEW_HISTORY_MAX_ITEMS);
      // 첫 쌍은 남고 그 다음 쌍이 빠집니다.
      expect(lastBody.history.slice(0, 3)).toEqual([
        { role: "question", text: "질문 1" },
        { role: "answer", text: "답변 1" },
        { role: "question", text: "질문 3" },
      ]);
      expect(result.current.removedHistory).toEqual([
        { role: "question", text: "질문 2" },
        { role: "answer", text: "답변 2" },
      ]);
      // 화면의 대화는 자르지 않습니다. 잘리는 것은 요청 이력뿐입니다.
      expect(result.current.messages).toHaveLength(turns * 2);
    });

    it("근거 스냅샷이 없는 테스트용 스트림에서는 답변을 받지 않는다", async () => {
      const source = controllableResponse();
      const fetchImpl = vi.fn().mockResolvedValueOnce(source.response);
      const { result } = renderHook(() =>
        useInterviewStream({ url: "/api/interview/stream", fetchImpl, ...immediate })
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      completeQuestion(source, "고정 질문");
      await waitFor(() => expect(result.current.status).toBe("done"));

      expect(result.current.canSubmitAnswer).toBe(false);
      act(() => {
        expect(result.current.submitAnswer("답변")).toBe(false);
      });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});

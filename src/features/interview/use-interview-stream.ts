"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { InterviewStreamError } from "./errors";
import {
  INTERVIEW_HISTORY_ITEM_MAX_BYTES,
  interviewHistoryItemBytes,
  trimInterviewHistory,
  type InterviewHistoryMessage,
} from "./history";
import { runInterviewStream, type InterviewStreamStatus } from "./interview-stream-client";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";

export type InterviewStreamPhase = "idle" | InterviewStreamStatus;

export type InterviewMessageRole = InterviewHistoryMessage["role"];

export interface InterviewStreamMessage {
  id: string;
  /** `question`은 모델이 만든 질문, `answer`는 사용자가 제출한 답변입니다. */
  role: InterviewMessageRole;
  text: string;
  /** 아직 도착 중인 메시지인지 여부입니다. 완료된 메시지는 다시 렌더하지 않습니다. */
  isStreaming: boolean;
}

export interface UseInterviewStreamOptions {
  url: string;
  /**
   * 질문을 생성할 근거 스냅샷입니다.
   *
   * 있으면 `POST`로 스냅샷을 실어 실제 생성 경로를 씁니다. 없으면 지금까지처럼 `GET`으로 테스트용
   * 스트림을 받습니다. 두 경로의 재개 방침이 다릅니다. 테스트용 스트림은 내용이 결정적이라
   * `Last-Event-ID`로 이어받을 수 있지만 실제 생성 스트림은 이어받을 수 없습니다.
   *
   * 답변 제출은 이 값이 있을 때만 할 수 있습니다. 테스트용 스트림은 대화를 받지 않습니다.
   */
  snapshot?: ExperienceEvidenceSnapshot;
  autoStart?: boolean;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  /** 테스트에서 프레임 스케줄러를 대체하기 위한 통로입니다. */
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface InterviewStreamState {
  messages: readonly InterviewStreamMessage[];
  status: InterviewStreamPhase;
  error: InterviewStreamError | null;
  /** 지금까지 도착한 청크 수입니다. 도착 순서 검증과 재연결 이어받기에 씁니다. */
  receivedSeq: number;
  /**
   * 마지막 요청을 보내기 전에 이력 상한 때문에 뺀 항목입니다. 가장 오래된 질문·답변 쌍부터 빠지며
   * 화면은 이 값을 읽어 무엇이 빠졌는지 알립니다. 안내 자체는 이 훅의 범위가 아닙니다.
   */
  removedHistory: readonly InterviewHistoryMessage[];
  /**
   * 지금 답변을 제출할 수 있는지입니다. 근거 스냅샷이 있고, 마지막 질문이 다 도착했고, 표시 중인
   * 오류가 없을 때만 참입니다. 생성 중에는 거짓이라 다시 제출할 수 없습니다.
   */
  canSubmitAnswer: boolean;
  /**
   * 마지막 질문이 이력 항목 상한을 넘어 대화를 이어갈 수 없는 상태인지입니다.
   *
   * 생성 경로에 출력 길이 상한이 없어 모델이 `INTERVIEW_HISTORY_ITEM_MAX_BYTES`를 넘는 질문을 낼 수
   * 있습니다. 그 질문을 확정하고 답변을 받으면 서버가 이력을 `history_too_large`로 거절하는데, 그 시점에는
   * 답변이 이미 대화에 들어가 있고 같은 이력을 다시 보내도 같은 거절이 옵니다. 그래서 넘치는 질문을
   * 생성 실패로 취급합니다. 제출은 잠기고 `retry`가 그 질문을 지우고 같은 이력으로 새로 만듭니다.
   * 서버 쪽 출력 상한은 `wiki/2026-09-08-꼬리질문-요청계약-후속-backlog.md` 3번에 있습니다.
   */
  isLastQuestionTooLong: boolean;
  start: () => void;
  retry: () => void;
  /**
   * 답변을 대화에 넣고 다음 질문 생성을 시작합니다. 답변은 요청 결과와 무관하게 즉시 확정 항목으로
   * 들어가므로 생성이 실패해도 사라지지 않습니다. `canSubmitAnswer`가 거짓이거나 본문이 비어 있거나
   * 서버의 항목 상한을 넘으면 아무 일도 하지 않고 거짓을 돌려줍니다. 상한 판정은 화면이 아니라
   * 여기서도 합니다. 화면이 버튼만 잠그면 Enter 제출 같은 다른 경로가 그대로 통과합니다.
   */
  submitAnswer: (text: string) => boolean;
}

const defaultScheduleFrame = (callback: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => callback())
    : (setTimeout(callback, 0) as unknown as number);

const defaultCancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};

/** 완료된 메시지만 요청 이력이 됩니다. 도착 중인 질문은 아직 대화가 아닙니다. */
function toHistory(messages: readonly InterviewStreamMessage[]): InterviewHistoryMessage[] {
  return messages
    .filter((message) => !message.isStreaming)
    .map((message) => ({ role: message.role, text: message.text }));
}

/**
 * SSE 수신 결과를 화면 상태로 바꿉니다.
 *
 * 도착한 청크를 바로 반영하지 않고 애니메이션 프레임마다 모아서 한 번만 반영합니다. 측정 결과
 * 스트리밍 메시지의 재파싱 비용이 길이에 비례해서 커지는데(733자 0.53밀리초, 4,919자 2.94밀리초)
 * SSE 청크는 한 프레임 안에 여러 개가 도착할 수 있습니다. 프레임당 한 번으로 모으면 같은 프레임
 * 안에서 같은 파싱을 반복하지 않습니다. 버퍼는 도착 순서를 그대로 유지하므로 표시 순서는 달라지지
 * 않습니다.
 *
 * 대화는 질문과 답변이 번갈아 쌓입니다. 모델의 질문은 청크를 이어 붙이다가 `done`에서 확정되고,
 * 사용자의 답변은 제출 즉시 확정 항목으로 들어갑니다. 다음 질문 요청은 확정된 메시지 전체를
 * 이력으로 싸서 보내며, 보내기 전에 `trimInterviewHistory`를 통과시킵니다. 서버는 상한을 넘긴
 * 이력을 거절만 하고 자르지 않습니다.
 *
 * 메시지 갱신은 모두 `updateMessages`를 거칩니다. 답변 제출 직후 같은 틱에서 요청 이력을 만들어야
 * 하는데 React 상태는 다음 렌더까지 갱신되지 않으므로 ref에 같은 값을 함께 둡니다.
 */
export function useInterviewStream({
  url,
  snapshot,
  autoStart = true,
  fetchImpl,
  retryDelaysMs,
  sleep,
  scheduleFrame = defaultScheduleFrame,
  cancelFrame = defaultCancelFrame,
}: UseInterviewStreamOptions): InterviewStreamState {
  const [messages, setMessages] = useState<readonly InterviewStreamMessage[]>([]);
  const [status, setStatus] = useState<InterviewStreamPhase>("idle");
  const [error, setError] = useState<InterviewStreamError | null>(null);
  const [receivedSeq, setReceivedSeq] = useState(0);
  const [removedHistory, setRemovedHistory] = useState<readonly InterviewHistoryMessage[]>([]);
  const [isLastQuestionTooLong, setIsLastQuestionTooLong] = useState(false);

  const messagesRef = useRef<readonly InterviewStreamMessage[]>([]);
  // 상태와 같은 값을 ref에도 둡니다. `retry`가 이벤트 안에서 다음 렌더를 기다리지 않고 읽습니다.
  const isLastQuestionTooLongRef = useRef(false);
  const messageCountRef = useRef(0);
  const bufferRef = useRef<string[]>([]);
  // 프레임이 잡혀 있는지는 handle 값과 따로 둡니다. 스케줄러가 콜백을 동기로 실행하면 handle을
  // 돌려받기 전에 flush가 끝나므로 handle만으로는 예약 여부를 판별할 수 없습니다.
  const frameScheduledRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSeqRef = useRef(0);
  const optionsRef = useRef({
    url,
    snapshot,
    fetchImpl,
    retryDelaysMs,
    sleep,
    scheduleFrame,
    cancelFrame,
  });
  // 실행 중인 스트림이 최신 옵션을 보게 하되 옵션이 바뀔 때마다 스트림을 다시 시작하지는
  // 않습니다. ref 갱신은 렌더 도중이 아니라 렌더가 끝난 뒤에 합니다.
  useEffect(() => {
    optionsRef.current = { url, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame };
  });

  const updateMessages = useCallback(
    (updater: (previous: readonly InterviewStreamMessage[]) => readonly InterviewStreamMessage[]) => {
      const next = updater(messagesRef.current);
      if (next === messagesRef.current) return;
      messagesRef.current = next;
      setMessages(next);
    },
    []
  );

  const cancelScheduledFrame = useCallback(() => {
    if (frameScheduledRef.current && frameRef.current !== null) {
      optionsRef.current.cancelFrame(frameRef.current);
    }
    frameScheduledRef.current = false;
    frameRef.current = null;
  }, []);

  const flush = useCallback(() => {
    frameScheduledRef.current = false;
    frameRef.current = null;
    const appended = bufferRef.current.join("");
    bufferRef.current = [];
    if (appended === "") return;
    updateMessages((previous) => {
      const last = previous[previous.length - 1];
      if (last?.isStreaming) {
        return [...previous.slice(0, -1), { ...last, text: last.text + appended }];
      }
      messageCountRef.current += 1;
      return [
        ...previous,
        { id: `message-${messageCountRef.current}`, role: "question", text: appended, isStreaming: true },
      ];
    });
    setReceivedSeq(lastSeqRef.current);
  }, [updateMessages]);

  const flushNow = useCallback(() => {
    cancelScheduledFrame();
    flush();
  }, [cancelScheduledFrame, flush]);

  const completeStreamingMessage = useCallback(() => {
    updateMessages((previous) => {
      const last = previous[previous.length - 1];
      if (!last?.isStreaming) return previous;
      // 서버가 이력 항목을 재는 자와 같은 자로 잽니다. 넘치면 화면에는 남기되 대화로 확정하지 않습니다.
      const tooLong =
        interviewHistoryItemBytes({ role: last.role, text: last.text }) > INTERVIEW_HISTORY_ITEM_MAX_BYTES;
      isLastQuestionTooLongRef.current = tooLong;
      setIsLastQuestionTooLong(tooLong);
      return [...previous.slice(0, -1), { ...last, isStreaming: false }];
    });
  }, [updateMessages]);

  const start = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const current = optionsRef.current;
    let body: string | undefined;
    if (current.snapshot !== undefined) {
      // 실제 생성 경로는 요청마다 새 스트림입니다. 앞 질문의 seq를 이어 쓰면 새 질문의 도착 순서
      // 검증이 어긋납니다.
      lastSeqRef.current = 0;
      bufferRef.current = [];
      cancelScheduledFrame();
      setReceivedSeq(0);

      const history = toHistory(messagesRef.current);
      if (history.length === 0) {
        // 첫 질문입니다. 이슈 #76 이전과 같은 본문을 보냅니다.
        setRemovedHistory([]);
        body = JSON.stringify({ snapshot: current.snapshot });
      } else {
        const trimmed = trimInterviewHistory(history);
        setRemovedHistory(trimmed.removed);
        body = JSON.stringify({ snapshot: current.snapshot, history: trimmed.history });
      }
    }

    void runInterviewStream(
      {
        url: current.url,
        ...(body === undefined ? {} : { body, resumeMode: "restart" as const }),
        fetchImpl: current.fetchImpl,
        signal: controller.signal,
        retryDelaysMs: current.retryDelaysMs,
        sleep: current.sleep,
        startSeq: lastSeqRef.current,
      },
      {
        onStatus: (next) => {
          if (!controller.signal.aborted) setStatus(next);
        },
        onChunk: ({ seq, text }) => {
          lastSeqRef.current = seq;
          bufferRef.current.push(text);
          if (!frameScheduledRef.current) {
            frameScheduledRef.current = true;
            frameRef.current = current.scheduleFrame(() => flush());
          }
        },
        onDone: () => {
          flushNow();
          completeStreamingMessage();
        },
        onError: (streamError) => {
          // 이미 도착한 내용은 지우지 않습니다. 버퍼에 남은 청크도 화면에 반영한 뒤 알립니다.
          flushNow();
          setError(streamError);
        },
      }
    );
  }, [cancelScheduledFrame, completeStreamingMessage, flush, flushNow]);

  // 이전 오류 표시는 사용자가 다시 시도할 때 지웁니다. 자동 재연결 중에는 오류를 표시하지 않으므로
  // 지울 것도 없습니다.
  const retry = useCallback(() => {
    setError(null);
    // 실제 생성 경로는 이어받을 수 없으므로 다시 시도가 처음부터 다시 생성합니다. 이미 표시된
    // 앞부분을 남겨 두면 새 생성 결과가 그 뒤에 붙어 한 메시지 안에서 서로 다른 질문이 이어집니다.
    // 지우는 것은 실패한 그 질문 하나뿐입니다. 앞선 질문과 사용자가 쓴 답변은 그대로 두고 같은
    // 이력으로 그 질문만 다시 만듭니다. 도착 중에 끊긴 질문과 상한을 넘어 확정하지 못한 질문이
    // 여기에 해당합니다.
    if (optionsRef.current.snapshot !== undefined) {
      const tooLong = isLastQuestionTooLongRef.current;
      updateMessages((previous) => {
        const last = previous[previous.length - 1];
        if (!last) return previous;
        return last.isStreaming || (tooLong && last.role === "question") ? previous.slice(0, -1) : previous;
      });
      isLastQuestionTooLongRef.current = false;
      setIsLastQuestionTooLong(false);
    }
    start();
  }, [start, updateMessages]);

  const canSubmitAnswer =
    snapshot !== undefined &&
    status === "done" &&
    error === null &&
    !isLastQuestionTooLong &&
    messages.length > 0 &&
    messages[messages.length - 1].role === "question" &&
    !messages[messages.length - 1].isStreaming;

  // 제출 핸들러는 렌더 뒤의 이벤트에서 불리므로 effect로 옮긴 값이 최신입니다.
  const canSubmitRef = useRef(false);
  useEffect(() => {
    canSubmitRef.current = canSubmitAnswer;
  }, [canSubmitAnswer]);

  const submitAnswer = useCallback(
    (text: string): boolean => {
      if (!canSubmitRef.current) return false;
      // 비어 있는지만 공백을 지워 판정하고 저장과 전송은 원문 그대로 합니다. 앞 공백을 지우면 들여쓰기로
      // 시작한 Markdown 코드 블록이 평문이 되어 사용자가 쓴 것과 다른 답변이 화면과 이력에 남습니다.
      if (text.trim() === "") return false;
      const answer: InterviewHistoryMessage = { role: "answer", text };
      if (interviewHistoryItemBytes(answer) > INTERVIEW_HISTORY_ITEM_MAX_BYTES) return false;
      // 제출과 함께 잠급니다. 스트림의 첫 상태 콜백이 오기 전에 두 번 눌러도 답변이 두 개 들어가지
      // 않습니다.
      canSubmitRef.current = false;
      updateMessages((previous) => {
        messageCountRef.current += 1;
        return [...previous, { id: `message-${messageCountRef.current}`, ...answer, isStreaming: false }];
      });
      setStatus("connecting");
      start();
      return true;
    },
    [start, updateMessages]
  );

  useEffect(() => {
    if (autoStart) start();
    return () => {
      abortRef.current?.abort();
      cancelScheduledFrame();
    };
  }, [autoStart, cancelScheduledFrame, start]);

  return {
    messages,
    status,
    error,
    receivedSeq,
    removedHistory,
    canSubmitAnswer,
    isLastQuestionTooLong,
    start,
    retry,
    submitAnswer,
  };
}

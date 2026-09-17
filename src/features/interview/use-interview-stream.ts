"use client";

import { answerLengthBucket, trackEvent } from "@/features/analytics/events";
import { useCallback, useEffect, useRef, useState } from "react";
import { READY_TO_FINISH_PROMPT } from "@/copy/interview";
import type { InterviewStreamError } from "./errors";
import {
  INTERVIEW_HISTORY_ITEM_MAX_BYTES,
  interviewHistoryItemBytes,
  trimInterviewHistory,
  type InterviewHistoryMessage,
  type InterviewLastOutcome,
} from "./history";
import { runInterviewStream, type InterviewStreamStatus } from "./interview-stream-client";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { BlockElement, BlockKind } from "@/features/experience-block/types";

/** 질문이 겨냥하는 블록·요소입니다(이슈 #90). `null`은 대상 없는 일반 질문입니다. */
export type InterviewQuestionTarget = { readonly targetBlock: BlockKind; readonly targetElement: BlockElement } | null;

/**
 * `onBeforeQuestion`의 결과입니다(이슈 #90, 구현검토 2026-09-11 P1-5·P1-4 재검증).
 *
 * - `"ask"`: 대상으로 다음 질문을 요청합니다. `lastOutcome`은 눈에 띄는 결과가 있을 때만
 *   호출부가 채웁니다.
 * - `"ready_to_finish"`: 더 물을 유효한 후보가 없습니다(설계 6-2절 6번). 새 질문을 생성하는 대신
 *   완료 대기 안내를 "질문" 자리에 넣어 질문·답변이 번갈아 나오는 이력 계약을 지킵니다. 이 자리가
 *   없으면 종료 전 보충 답변을 받을 때 마지막 두 메시지가 답변·답변이 되어, 그다음 진짜 질문을
 *   요청할 때 서버가 이력 모양을 거절합니다(구현검토 2026-09-11 P1-4, 재검증에서 발견한 회귀).
 * - `"stop"`: 언마운트·상한 도달처럼 안내 없이 그대로 멈춰야 합니다.
 */
export type InterviewQuestionOutcome =
  | {
      readonly kind: "ask";
      readonly target: NonNullable<InterviewQuestionTarget>;
      readonly lastOutcome: InterviewLastOutcome | null;
      /**
       * 이 요청이 속한 턴 번호입니다. 계측만 씁니다(이슈 #126, PR #139 리뷰 1라운드).
       *
       * 호출부가 확정한 값을 요청과 함께 받습니다. 이 훅이 옵션으로 받은 `turnsUsed`를 요청 시점에
       * 읽으면 한 턴 뒤처진 값이 담깁니다. 호출부는 `onBeforeQuestion` 안에서 턴 수를 올린 직후 이
       * 훅의 `start()`를 부르는데, 그 사이에 렌더가 끝나지 않아 옵션을 옮겨 담는 effect가 아직
       * 돌지 않았기 때문입니다. 2026-09-17 실측에서 두 번째 질문까지 턴 0으로 기록되었습니다.
       */
      readonly turn: number;
    }
  | { readonly kind: "ready_to_finish" }
  | { readonly kind: "stop" };

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
  /** 질문 스트림 엔드포인트입니다. 호출부가 모두 같은 값을 쓰므로 기본값을 여기 둡니다. */
  url?: string;
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
  /**
   * 첫 질문이 겨냥할 블록·요소입니다(이슈 #90). 이력이 없는 첫 `start()` 호출에만 씁니다. 첫
   * 질문의 대상은 항상 problem.a로 정해져 있어(설계 6절) 비동기 계산이 필요 없으므로 값을 그대로
   * 받습니다.
   */
  initialTarget?: InterviewQuestionTarget;
  /**
   * 이어가기로 시작할 때 화면에 이미 들어 있어야 하는 대화입니다(이슈 #115). 저장된 질문과 답변을
   * 순서대로 받습니다. 모두 확정된 메시지이므로 도착 중인 것으로 두지 않습니다.
   *
   * 첫 렌더에만 읽습니다. 대화는 그 뒤로 이 훅이 주인이고, 나중에 바뀐 값을 다시 반영하면 사용자가
   * 방금 쓴 답변이 저장 시점의 값으로 되돌아갑니다.
   */
  initialMessages?: readonly InterviewHistoryMessage[];
  /**
   * 끝난 인터뷰를 다시 열 때 참입니다(이슈 #115). 대화는 그대로 보이되 읽기 전용입니다.
   *
   * 이 값이 없으면 끝낸 인터뷰를 다시 열었을 때 훅이 질문을 새로 요청합니다. 사용자가 끝낸 대화가
   * 다시 자라나고, 목록의 "끝남" 표시와 화면이 어긋납니다.
   */
  initiallyEnded?: boolean;
  /**
   * 답변 제출 뒤, 질문을 요청하기 전에 끼워 넣을 비동기 작업입니다(이슈 #90 Approach 4, "답변
   * 제출부터 질문 요청까지를 하나의 취소 가능한 작업으로 묶는다"). 블록 갱신 호출과 다음 질문 대상
   * 선택이 여기 들어갑니다.
   *
   * `"ask"`이면 그 대상(과, 있으면 직전 처리 결과)으로 질문을 요청합니다. `"ready_to_finish"`면 새 질문을 생성하는 대신 완료 대기 안내를 질문 자리에 넣고(설계 6-2절 6번, 6-3절 보충 답변) 상태를 `"done"`으로 둡니다. `"stop"`이면 안내 없이 그대로 멈추고 상태만 `"done"`으로 둡니다. 이 콜백은 실패를 던지지 않는 것을 전제합니다. 블록 갱신이 실패해도 질문은 그대로 요청해야 하므로(설계 9절), 실패 처리는 호출자가 안에서 끝내고 그래도 유효한 결과를 돌려줘야 합니다.
   *
   * 없으면 이전 계약처럼 답변 제출과 동시에 대상 없는 질문을 요청합니다.
   */
  onBeforeQuestion?: (context: {
    readonly history: readonly InterviewHistoryMessage[];
  }) => Promise<InterviewQuestionOutcome>;
  /**
   * 지금까지 확정된 턴 수입니다. 계측이 이벤트에 담을 값이고 화면 동작에는 쓰지 않습니다(이슈 #126).
   *
   * 세는 규칙을 이 훅이 다시 적지 않고 받습니다. 완료 대기 안내에 대한 보충 답변은 턴으로 세지
   * 않는데(설계 6-1절) 그 판정은 `useExperienceInterview`에 있습니다. 여기서 메시지를 다시 세면 두
   * 곳의 기준이 달라져 화면은 정상인데 계측만 오류 없이 틀린 값을 전송합니다.
   *
   * 질문 요청에는 이 값을 쓰지 않습니다. 요청이 속한 턴은 `onBeforeQuestion`이 요청과 함께
   * 돌려줍니다(`InterviewQuestionOutcome`의 `turn`). 이 옵션은 첫 질문의 턴과 답변 제출 시점의
   * 턴에만 씁니다. 두 시점은 렌더가 끝난 뒤라 값이 최신입니다.
   */
  turnsUsed?: number;
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
   * 근거 스냅샷을 실어 실제 생성 경로로 도는지입니다. 화면은 이 값 하나로 답변 입력을 열지와
   * 끊긴 스트림을 이어받을 수 있는지를 가릅니다.
   *
   * 스냅샷을 받은 것이 이 훅이므로 판정도 여기서 냅니다. 같은 사실을 화면이 따로 받으면 스트림과
   * 어긋난 값을 넘길 수 있습니다.
   */
  hasSnapshot: boolean;
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
  /**
   * 사용자가 인터뷰를 종료했는지입니다. 종료는 되돌릴 수 없고 이 훅은 더 이상 요청을 보내지
   * 않습니다.
   *
   * 판정을 화면이 아니라 여기 두는 이유는 화면이 버튼을 잠그는 것만으로는 부족하기 때문입니다.
   * `retry`는 오류 안내 안의 버튼에 걸려 있고 `submitAnswer`는 Enter 제출로도 불립니다. 어느
   * 경로든 종료 뒤에 요청을 보내면 사용자가 끝낸 대화가 다시 자랍니다.
   */
  isEnded: boolean;
  start: () => void;
  retry: () => void;
  /**
   * 인터뷰를 종료합니다. 진행 중인 요청을 끊고 이후의 `start`·`retry`·`submitAnswer`를 모두
   * 거절합니다. 대화는 지우지 않고 읽기 전용으로 남깁니다.
   *
   * 저장 계층이 없으므로 종료한 대화를 다시 이어갈 수 없습니다. 같은 화면에서 다시 시작하는 조작도
   * 두지 않았습니다. 재시작은 첫 질문 재생성이 되고, 그러면 종료 상태를 푸는 경로가 생겨 위의 세
   * 조작을 다시 열어야 합니다. 다시 하려면 후보 목록에서 경험을 다시 확정합니다.
   */
  endInterview: () => void;
  /**
   * 답변을 대화에 넣고 다음 질문 생성을 시작합니다. 답변은 요청 결과와 무관하게 즉시 확정 항목으로
   * 들어가므로 생성이 실패해도 사라지지 않습니다. `canSubmitAnswer`가 거짓이거나 본문이 비어 있거나
   * 서버의 항목 상한을 넘으면 아무 일도 하지 않고 거짓을 돌려줍니다. 상한 판정은 화면이 아니라
   * 여기서도 합니다. 화면이 버튼만 잠그면 Enter 제출 같은 다른 경로가 그대로 통과합니다.
   */
  submitAnswer: (text: string) => boolean;
}

/** 기본값의 참조가 렌더마다 바뀌지 않게 상수로 둡니다. */
const EMPTY_HISTORY: readonly InterviewHistoryMessage[] = [];

const defaultScheduleFrame = (callback: () => void): number =>
  typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => callback())
    : (setTimeout(callback, 0) as unknown as number);

const defaultCancelFrame = (handle: number): void => {
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
};

/** 이어가기로 받은 대화를 화면 메시지로 옮깁니다. 번호는 이어 붙을 메시지가 그대로 이어 씁니다. */
function toStreamMessages(history: readonly InterviewHistoryMessage[]): InterviewStreamMessage[] {
  return history.map((message, index) => ({
    id: `message-${index + 1}`,
    role: message.role,
    text: message.text,
    isStreaming: false,
  }));
}

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
  url = "/api/interview/stream",
  snapshot,
  autoStart = true,
  fetchImpl,
  retryDelaysMs,
  sleep,
  scheduleFrame = defaultScheduleFrame,
  cancelFrame = defaultCancelFrame,
  initialTarget = null,
  initialMessages = EMPTY_HISTORY,
  initiallyEnded = false,
  onBeforeQuestion,
  turnsUsed = 0,
}: UseInterviewStreamOptions): InterviewStreamState {
  const [messages, setMessages] = useState<readonly InterviewStreamMessage[]>(() => toStreamMessages(initialMessages));
  const [status, setStatus] = useState<InterviewStreamPhase>("idle");
  const [error, setError] = useState<InterviewStreamError | null>(null);
  const [receivedSeq, setReceivedSeq] = useState(0);
  const [removedHistory, setRemovedHistory] = useState<readonly InterviewHistoryMessage[]>([]);
  const [isLastQuestionTooLong, setIsLastQuestionTooLong] = useState(false);
  const [isEnded, setIsEnded] = useState(initiallyEnded);

  const messagesRef = useRef<readonly InterviewStreamMessage[]>(messages);
  // 상태와 같은 값을 ref에도 둡니다. `retry`가 이벤트 안에서 다음 렌더를 기다리지 않고 읽습니다.
  const isLastQuestionTooLongRef = useRef(false);
  // 종료도 같은 이유로 ref에 둡니다. 종료와 같은 틱에 들어온 제출을 다음 렌더 전에 거절해야 합니다.
  const isEndedRef = useRef(initiallyEnded);
  // 이어가기로 받은 대화가 있으면 그 다음 번호부터 붙입니다. 0에서 시작하면 새 메시지가 복원된
  // 메시지와 같은 `id`를 받아 React가 둘을 같은 항목으로 봅니다.
  const messageCountRef = useRef(messages.length);
  const bufferRef = useRef<string[]>([]);
  // 프레임이 잡혀 있는지는 handle 값과 따로 둡니다. 스케줄러가 콜백을 동기로 실행하면 handle을
  // 돌려받기 전에 flush가 끝나므로 handle만으로는 예약 여부를 판별할 수 없습니다.
  const frameScheduledRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSeqRef = useRef(0);
  /**
   * 언마운트됐는지입니다. `onBeforeQuestion`은 이 훅이 사라진 뒤에도 끝날 수 있는데(그 안의
   * 블록 갱신은 자신의 언마운트 가드로 멈추지만, 이 콜백 자체는 그 훅이 던지지 않는 한 계속
   * 기다려집니다), 이미 내려간 화면에서 다음 질문 `start()`를 부르면 안 됩니다(구현검토
   * 2026-09-11 P1-3, R5). `isEndedRef`로는 이 경우를 잡지 못합니다. 언마운트는 종료가 아니고
   * `submissionSeqRef` 비교도 새 제출이 없으면 그대로 통과하기 때문입니다.
   */
  const unmountedRef = useRef(false);
  // 다음 `start()` 호출이 실을 대상입니다. `submitAnswer`가 `onBeforeQuestion`에서 정해 두고
  // `start()`가 한 번 읽고 비웁니다. 첫 호출(이력 없음)에는 `initialTarget`을 그대로 씁니다.
  const pendingTargetRef = useRef<InterviewQuestionTarget>(initialTarget);
  /**
   * 다음 `start()` 호출이 함께 실을 직전 처리 결과입니다(이슈 #90, 구현검토 2026-09-11 P1-5).
   * `pendingTargetRef`와 같은 자리에서 같은 방식으로 씁니다. `retry()`도 이 값을 그대로 읽으므로
   * 재시도가 다른 맥락을 겨냥하는 일은 없습니다.
   */
  const pendingLastOutcomeRef = useRef<InterviewLastOutcome | null>(null);
  // `onBeforeQuestion` 진행 중에 새 제출이나 종료가 오면 그 결과를 버려야 합니다(이슈 #90 Approach
  // 4, "이전 작업의 늦은 응답은 반영하지 않는다"). 제출마다 값을 올려 이 응답이 최신 제출의
  // 것인지 확인합니다.
  const submissionSeqRef = useRef(0);
  /**
   * 계측이 쓰는 시각입니다(이슈 #126). 요청을 보낸 시점과, 그 요청의 첫 조각이 도착한 시점입니다.
   *
   * 상태가 아니라 ref입니다. 그리는 데 쓰지 않는 값이라 상태로 두면 조각이 올 때마다 다시 그리게
   * 되고, 스트리밍 중 리렌더 범위를 최소로 둔다는 이 서비스의 제약과 정면으로 부딪힙니다.
   *
   * `requestStartedAt`은 첫 조각을 센 뒤 비웁니다. 값이 있다는 것이 곧 "이번 요청의 첫 조각을 아직
   * 세지 않았다"라서, 조각마다 세는 것을 막는 표식을 따로 두지 않아도 됩니다.
   *
   * `questionShownAt`은 반대로 요청 경계를 넘어 남습니다. 답변을 제출할 때 "질문을 읽기 시작한 뒤
   * 얼마나 지났는지"를 재는 기준점이고, 그 시점은 직전 질문의 첫 조각이기 때문입니다.
   */
  const requestStartedAtRef = useRef<number | null>(null);
  const questionShownAtRef = useRef<number | null>(null);
  /**
   * 다음 질문 요청이 속한 턴 번호입니다. `pendingTargetRef`와 같은 자리에서 같은 방식으로 씁니다.
   * 요청과 함께 나르지 않고 옵션을 요청 시점에 읽으면 한 턴 뒤처집니다(PR #139 리뷰 1라운드).
   */
  const pendingTurnRef = useRef(turnsUsed);
  /**
   * 화면에 있는 질문이 완료 대기 안내인지입니다. 그 안내는 모델이 만든 질문이 아니라 이 훅이 넣는
   * 고정 문구이고, 거기에 답한 것은 턴으로 세지 않습니다(설계 6-1절).
   *
   * 표시를 안내를 넣는 그 한 곳에서 세우고 새 질문 요청에서 내립니다. 제출 시점에 마지막 메시지의
   * 본문을 다시 비교하면 같은 판정이 두 곳에 생깁니다.
   */
  const isSupplementaryRef = useRef(false);
  const optionsRef = useRef({
    url,
    snapshot,
    fetchImpl,
    retryDelaysMs,
    sleep,
    scheduleFrame,
    cancelFrame,
    onBeforeQuestion,
    turnsUsed,
  });
  // 실행 중인 스트림이 최신 옵션을 보게 하되 옵션이 바뀔 때마다 스트림을 다시 시작하지는
  // 않습니다. ref 갱신은 렌더 도중이 아니라 렌더가 끝난 뒤에 합니다.
  useEffect(() => {
    optionsRef.current = { url, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame, onBeforeQuestion, turnsUsed };
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
    // 종료한 인터뷰는 요청을 보내지 않습니다. 모든 요청이 이 함수를 지나므로 여기 한 번 막으면
    // `retry`와 `submitAnswer`가 각자 다시 막지 않아도 요청이 나가지 않습니다.
    if (isEndedRef.current) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const current = optionsRef.current;
    /*
     * 이번 요청이 겨냥한 대상입니다. 아래 본문 조립과 계측이 같은 값을 봐야 해서 여기서 한 번만
     * 읽습니다. 계측이 따로 읽으면 그 사이에 값이 바뀔 때 질문과 다른 블록이 실립니다.
     */
    const target = pendingTargetRef.current;
    // 이 요청이 속한 턴입니다. 대상과 같은 시점에 한 번만 읽어 둘이 어긋나지 않게 합니다.
    const turn = pendingTurnRef.current;
    // 새 질문을 요청하므로 완료 대기 안내는 더 이상 화면의 질문이 아닙니다.
    isSupplementaryRef.current = false;
    // 계측이 첫 조각까지의 시간을 재는 기준점입니다(이슈 #126). 재시도는 그 시도부터 다시 잽니다.
    requestStartedAtRef.current = Date.now();
    let body: string | undefined;
    if (current.snapshot !== undefined) {
      // 실제 생성 경로는 요청마다 새 스트림입니다. 앞 질문의 seq를 이어 쓰면 새 질문의 도착 순서
      // 검증이 어긋납니다.
      lastSeqRef.current = 0;
      bufferRef.current = [];
      cancelScheduledFrame();
      setReceivedSeq(0);

      // 대상은 `submitAnswer`의 `onBeforeQuestion`이 정해 두거나(꼬리 질문) `initialTarget`에서
      // 왔습니다(첫 질문). `retry`도 같은 값을 그대로 읽으므로 재시도가 다른 블록을 겨냥하는 일은
      // 없습니다.
      const targetFields = target === null ? {} : { targetBlock: target.targetBlock, targetElement: target.targetElement };
      // 이력이 없는 첫 질문에는 직전 처리 결과가 있을 수 없습니다(구현검토 2026-09-11 P1-5).
      const lastOutcome = pendingLastOutcomeRef.current;
      const lastOutcomeFields = lastOutcome === null ? {} : { lastOutcome };

      const history = toHistory(messagesRef.current);
      if (history.length === 0) {
        // 첫 질문입니다. 이슈 #76 이전과 같은 본문을 보냅니다(대상이 없을 때).
        setRemovedHistory([]);
        body = JSON.stringify({ snapshot: current.snapshot, ...targetFields });
      } else {
        const trimmed = trimInterviewHistory(history);
        setRemovedHistory(trimmed.removed);
        body = JSON.stringify({ snapshot: current.snapshot, history: trimmed.history, ...targetFields, ...lastOutcomeFields });
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
          /*
           * 질문의 첫 조각입니다(이슈 #126). 질문이 다 도착한 시점이 아니라 여기서 셉니다. 사용자가
           * 읽기 시작할 수 있는 시점이 여기이고, 답변까지 걸린 시간도 이 시점부터 재야 질문을 읽고
           * 망설인 시간이 빠지지 않습니다.
           *
           * 인자 계산까지 try 안에 둡니다. `trackEvent`가 자기 예외를 삼키지만 시각 계산은 그
           * 바깥이고, 여기서 던지면 도착한 조각이 화면에 붙지 못해 질문이 끊깁니다.
           */
          const startedAt = requestStartedAtRef.current;
          if (startedAt !== null) {
            requestStartedAtRef.current = null;
            try {
              const now = Date.now();
              questionShownAtRef.current = now;
              if (target !== null) {
                trackEvent({
                  name: "question_shown",
                  turn,
                  block: target.targetBlock,
                  element: target.targetElement,
                  ttft_ms: now - startedAt,
                });
              }
            } catch {
              // 계측이 죽는 것이 질문이 끊기는 것보다 낫습니다.
            }
          }
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
          // 자동 재연결이 끝내 실패한 것만 여기 옵니다. 재연결 중에는 오류를 세우지 않으므로
          // 이 건수는 사용자가 실제로 오류 안내를 본 횟수와 같습니다.
          try {
            trackEvent({ name: "interview_stream_failed", turn, error_kind: streamError.kind });
          } catch {
            // 계측이 죽는 것이 오류 안내를 잃는 것보다 낫습니다.
          }
        },
      }
    );
  }, [cancelScheduledFrame, completeStreamingMessage, flush, flushNow]);

  // 이전 오류 표시는 사용자가 다시 시도할 때 지웁니다. 자동 재연결 중에는 오류를 표시하지 않으므로
  // 지울 것도 없습니다.
  const retry = useCallback(() => {
    // `start`가 이미 막지만 여기서도 막습니다. 아래에서 실패한 질문을 지우는 것이 요청 전에
    // 일어나므로, 이 갈래를 열어 두면 종료한 대화의 마지막 질문만 사라지고 새 질문은 오지 않습니다.
    if (isEndedRef.current) return;
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

  /**
   * 종료 처리입니다.
   *
   * 도착 중이던 청크까지 화면에 반영하고 그 메시지를 닫습니다. 지우지 않는 이유는 사용자가 이미
   * 읽고 있던 내용이기 때문입니다. 닫지 않으면 도착 중 표시가 영영 남습니다.
   *
   * 상한 초과 판정은 지웁니다. 그 판정이 뜻하는 것은 "이 질문으로는 대화를 이어갈 수 없다"이고
   * 화면에서 다시 시도를 권하는데, 종료한 대화에는 다시 시도가 없어 사용자가 할 수 있는 일이
   * 없습니다.
   */
  const endInterview = useCallback(() => {
    // 언마운트 뒤 호출되면(예: 부모 훅의 상한 종료 effect가 정리 전 마지막으로 부르는 경우) 상태
    // 갱신을 하지 않습니다. 새 요청을 일으키지는 않는 경로라 P3지만, 수정 비용이 작아 함께
    // 반영합니다(구현검토 2026-09-11 P1-3 재검증).
    if (unmountedRef.current || isEndedRef.current) return;
    isEndedRef.current = true;
    setIsEnded(true);
    abortRef.current?.abort();
    abortRef.current = null;
    flushNow();
    updateMessages((previous) => {
      const last = previous[previous.length - 1];
      if (!last?.isStreaming) return previous;
      return [...previous.slice(0, -1), { ...last, isStreaming: false }];
    });
    isLastQuestionTooLongRef.current = false;
    setIsLastQuestionTooLong(false);
  }, [flushNow, updateMessages]);

  // 마지막 메시지가 "질문"이어야 한다는 조건은 그대로 둡니다. 완료 대기 상태에서도 이 불변식이
  // 깨지지 않도록 `onBeforeQuestion`이 "ready_to_finish"를 돌려주면 완료 대기 안내를 질문 자리에
  // 넣습니다(아래 `.then()` 참고). 답변을 답변 뒤에 그대로 이어 붙이면 질문·답변 교대 이력 계약이
  // 깨져, 그다음 실제 질문 요청에서 서버가 이력 모양을 거절합니다(구현검토 2026-09-11 P1-4 1차
  // 수정의 회귀, 재검증에서 발견).
  const canSubmitAnswer =
    !isEnded &&
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
      // 종료는 상태가 아니라 ref로 봅니다. `canSubmitRef`는 렌더 뒤 effect에서 갱신되므로 종료와
      // 같은 틱에 들어온 제출은 아직 참인 값을 읽습니다.
      if (isEndedRef.current) return false;
      if (!canSubmitRef.current) return false;
      // 비어 있는지만 공백을 지워 판정하고 저장과 전송은 원문 그대로 합니다. 앞 공백을 지우면 들여쓰기로
      // 시작한 Markdown 코드 블록이 평문이 되어 사용자가 쓴 것과 다른 답변이 화면과 이력에 남습니다.
      if (text.trim() === "") return false;
      const answer: InterviewHistoryMessage = { role: "answer", text };
      if (interviewHistoryItemBytes(answer) > INTERVIEW_HISTORY_ITEM_MAX_BYTES) return false;
      // 제출과 함께 잠급니다. 스트림의 첫 상태 콜백이 오기 전에 두 번 눌러도 답변이 두 개 들어가지
      // 않습니다.
      canSubmitRef.current = false;
      /*
       * 답변을 제출했습니다(이슈 #126). 텍스트는 보내지 않고 길이 버킷만 보냅니다.
       *
       * 생각한 시간은 질문의 첫 조각이 도착한 시점부터 잽니다. 그 시점을 모르는 경우(완료 대기
       * 안내처럼 스트림 없이 질문 자리를 채운 경우)에는 싣지 않습니다. 0으로 채우면 즉답과
       * 구분되지 않습니다.
       *
       * 인자 계산까지 try 안에 둡니다. 여기서 던지면 답변이 대화에 들어가지 못하고 사라집니다.
       */
      try {
        const shownAt = questionShownAtRef.current;
        // 완료 대기 안내에 대한 보충 답변은 턴을 올리지 않습니다(설계 6-1절). 올리면 뒤따르는
        // 진짜 질문과 같은 턴 번호가 두 번 나갑니다.
        const turnsUsedNow = optionsRef.current.turnsUsed;
        trackEvent({
          name: "answer_submitted",
          turn: isSupplementaryRef.current ? turnsUsedNow : turnsUsedNow + 1,
          answer_length_bucket: answerLengthBucket(text.length),
          ...(shownAt === null ? {} : { think_time_ms: Date.now() - shownAt }),
        });
      } catch {
        // 계측이 죽는 것이 답변을 잃는 것보다 낫습니다.
      }
      updateMessages((previous) => {
        messageCountRef.current += 1;
        return [...previous, { id: `message-${messageCountRef.current}`, ...answer, isStreaming: false }];
      });
      setStatus("connecting");
      const onBeforeQuestion = optionsRef.current.onBeforeQuestion;
      if (onBeforeQuestion === undefined) {
        start();
        return true;
      }
      // 답변 제출부터 질문 요청까지를 하나의 취소 가능한 작업으로 묶습니다(이슈 #90 Approach 4).
      // 이 사이 새 제출이나 종료가 오면 이 결과는 버립니다.
      const submissionId = ++submissionSeqRef.current;
      const historyForBeforeQuestion = toHistory(messagesRef.current);
      void onBeforeQuestion({ history: historyForBeforeQuestion }).then((outcome) => {
        if (unmountedRef.current || isEndedRef.current || submissionSeqRef.current !== submissionId) return;
        if (outcome.kind === "stop") {
          setStatus("done");
          return;
        }
        if (outcome.kind === "ready_to_finish") {
          /*
           * 이 안내는 스트림으로 오지 않으므로 "질문을 읽기 시작한 시각"이 없습니다. 앞 질문의
           * 시각을 그대로 두면 보충 답변의 `think_time_ms`에 앞 질문을 읽고 답한 시간까지
           * 들어갑니다(PR #139 리뷰 1라운드).
           */
          questionShownAtRef.current = null;
          isSupplementaryRef.current = true;
          // 유효한 질문 후보가 없습니다(설계 6-2절 6번). 완료 대기 안내를 "질문" 자리에 넣어 종료 전 보충 답변을 받을 때도(설계 6-3절) 질문·답변 교대 계약이 깨지지 않게 합니다.
          updateMessages((previous) => {
            messageCountRef.current += 1;
            return [...previous, { id: `message-${messageCountRef.current}`, role: "question", text: READY_TO_FINISH_PROMPT, isStreaming: false }];
          });
          setStatus("done");
          return;
        }
        pendingTargetRef.current = outcome.target;
        pendingTurnRef.current = outcome.turn;
        pendingLastOutcomeRef.current = outcome.lastOutcome;
        start();
      });
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

  // 진짜 언마운트만 잡습니다. 빈 의존성 배열이라 위 effect처럼 `start`가 바뀔 때마다 다시 돌지
  // 않습니다. 같이 두면 재실행마다 "언마운트됨"으로 잘못 표시합니다.
  useEffect(() => {
    // Strict Mode의 두 번째 setup에서 되돌립니다. 없으면 첫 cleanup이 남긴 `true` 때문에
    // `onBeforeQuestion`의 결과를 항상 버려 다음 질문 요청이 시작되지 않습니다.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  return {
    messages,
    status,
    error,
    receivedSeq,
    removedHistory,
    hasSnapshot: snapshot !== undefined,
    canSubmitAnswer,
    isLastQuestionTooLong,
    isEnded,
    start,
    retry,
    submitAnswer,
    endInterview,
  };
}

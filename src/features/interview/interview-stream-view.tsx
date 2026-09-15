"use client";

import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import { pluralCount } from "@/features/experience-candidates/candidate-period";
import { clearsOnRetry } from "./errors";
import type { InterviewStreamErrorKind, InterviewStreamRequestErrorKind } from "./errors";
import type { SavedTurnStatus } from "@/features/saved-interviews/save-status";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES, interviewHistoryItemBytes } from "./history";
import { InterviewMessage } from "./interview-message";
import { useAutoScroll } from "./use-auto-scroll";
import type { InterviewStreamPhase, InterviewStreamState } from "./use-interview-stream";
import styles from "./interview-stream-view.module.css";

const STATUS_TEXT: Record<InterviewStreamPhase, string> = {
  idle: "Question streaming has not started yet.",
  connecting: "Connecting to the question stream.",
  streaming: "The question is arriving.",
  reconnecting: "The connection dropped. Reconnecting, and keeping what has already arrived.",
  done: "The question has fully arrived.",
  error: "The question could not be received.",
};

/**
 * 종료는 스트림 상태가 아니지만 사용자가 낭독으로 알아야 하는 상태는 같은 문단 하나입니다.
 *
 * `InterviewStreamPhase`에 값을 더하지 않았습니다. 그 union은 스트림 수신부의 상태이고 종료는
 * 사용자의 조작입니다. 섞으면 스트림이 끝나지 않은 채 종료한 경우에 어느 쪽을 담을지 정할 수 없습니다.
 * 종료 뒤에는 스트림 상태가 무엇이든 이 문장이 그 자리를 덮습니다.
 */
const ENDED_STATUS_TEXT = "The interview has ended. The conversation is read-only.";

/**
 * 스트림이 시작되기 전 서버가 거절한 경우입니다. 다시 시도해서 풀리는 것과 아닌 것을 구분해
 * 알립니다.
 */
const REQUEST_ERROR_GUIDANCE: Partial<Record<InterviewStreamRequestErrorKind, string>> = {
  unauthorized: "A GitHub sign-in session is required. Sign in again and retry.",
  invalid_request: "The request was malformed. If retrying gives the same result, reload the page.",
  invalid_json: "The request was malformed. If retrying gives the same result, reload the page.",
  body_too_large: "The evidence for this question is over the size limit for a single request. Retrying gives the same result.",
  /**
   * `body_too_large`와 문구를 갈라 씁니다. `clearsOnRetry`가 둘 다 거짓이지만 사용자가 할 수 있는
   * 일이 다릅니다. 본문 상한은 근거가 정하므로 손댈 자리가 없고, 이 실패는 대화를 줄이면 풀립니다.
   *
   * **대화를 줄이는 조작은 두지 않았습니다.** 그래서 "대화를 줄여 주세요"로 끝내지 않고 실제로 있는
   * 조작인 종료와 새 인터뷰를 가리킵니다. 없는 조작을 권하면 사용자는 같은 요청을 반복합니다.
   *
   * 절단은 클라이언트가 하므로 정상 경로에서는 이 분류가 오지 않습니다. 남은 도달 경로는 항목
   * 하나가 항목 상한을 넘는 경우인데, 답변은 입력이 막고 질문은 `isLastQuestionTooLong`이 먼저
   * 잡습니다. 그래도 문구를 둡니다. 서버가 이 분류를 실제로 내보내고, 항목이 없으면 기다리면
   * 풀린다는 뜻의 일반 문구가 나갑니다.
   */
  history_too_large:
    "The conversation has grown too long to build the next question. Retrying gives the same result. End this interview and start a new one by picking an experience from the candidate list.",
};

/**
 * 생성 쪽 실패의 원인 문장입니다. 재시도가 무엇을 하는지는 `retryHint`가 붙입니다. 원인과 재시도
 * 안내를 갈라 둔 이유는 재시도의 결과가 스트림의 재개 가능 여부에 따라 달라지기 때문입니다.
 */
const GENERATION_ERROR_CAUSE: Partial<Record<InterviewStreamErrorKind, string>> = {
  llm_rate_limit: "The question generation service hit its call limit.",
  llm_timeout: "Question generation did not finish in time.",
  llm_network: "Could not reach the question generation service.",
  llm_auth: "Authentication with the question generation service failed. This is a server configuration problem.",
  llm_configuration: "The question generation service is misconfigured.",
  /**
   * 크기를 지목하지 않습니다. 2026-09-01 실측에서 Gemini는 잘못된 파라미터도 400으로 돌려주므로 이
   * 분류에 크기와 무관한 실패가 들어옵니다. 근거 크기가 문제인 경우는 provider에 닿기 전에 세 가드가
   * 각자 자기 문구로 먼저 거절합니다. 스냅샷 단계의 `evidence_input_too_large`, 본문 크기의
   * `body_too_large`, route의 프롬프트 바이트 가드입니다. 따라서 이 분류가 실제로 뜻하는 것은 크기가
   * 아니라 provider의 요청 거부입니다.
   */
  llm_request: "The question generation service did not accept the request.",
  /**
   * Gemini의 500 `INTERNAL`과 503 `UNAVAILABLE`(모델 과부하)이 이 분류로 옵니다. flash 계열에서 가장
   * 흔한 일시 실패인데 항목이 없어 "질문을 만드는 중에 오류가 발생했습니다"라는 기본 문구가
   * 나갔습니다. `clearsOnRetry`가 참이므로 `retryHint`가 잠시 뒤 재시도를 덧붙입니다.
   */
  llm_failure: "The question generation service did not respond.",
  server_error: "A server configuration problem stopped the request from being handled.",
};

/**
 * 다시 시도가 무엇을 하는지 알립니다.
 *
 * 이어받을 수 없는 스트림에서는 다시 시도가 이어받는 것이 아니라 처음부터 새로 만드는 것이고, 이미
 * 표시된 내용이 사라집니다. 그 경로에 "이미 받은 내용은 그대로 두었습니다"를 쓰면 안 됩니다.
 * 사용자가 그 문구를 읽고 버튼을 누르면 읽던 질문이 사라집니다.
 */
function retryHint(kind: InterviewStreamErrorKind, resumable: boolean): string {
  if (!clearsOnRetry(kind)) return "Retrying gives the same result.";
  return resumable
    ? "What already arrived has been kept. Try again in a moment."
    : "Try again in a moment. Retrying builds the question from scratch on the same evidence, and everything received so far is lost.";
}

/**
 * 오류마다 사용자가 무엇을 할 수 있는지 달라지므로 안내를 따로 둡니다. `aria-label`로 버튼 이름만
 * 바꾸지 않고 `aria-describedby`로 이 내용을 노출합니다.
 *
 * `resumable`은 끊긴 지점부터 이어받을 수 있는 스트림인지입니다. 실제 생성 스트림은 이어받을 수
 * 없어 다시 시도가 처음부터 새로 만드는 것이 되므로 같은 분류라도 안내가 달라집니다.
 */
function errorGuidance(kind: InterviewStreamErrorKind, resumable: boolean): string {
  if (kind === "stream_connect_failed") {
    return "The connection could not be opened. Nothing has arrived yet. Check your network and try again.";
  }
  if (kind === "stream_interrupted") {
    return resumable
      ? "Two automatic reconnects both failed. What already arrived has been kept, and retrying resumes from where it stopped."
      : "The connection dropped while the question was arriving. This stream cannot resume from where it stopped, so retrying builds the question from scratch on the same evidence. Everything received so far is lost.";
  }
  if (kind === "generation_empty") {
    // 청크가 0개라 사라질 내용이 없습니다. 여기에 재시도 문구를 붙이면 잃을 내용이 있다고
    // 오해하게 만듭니다.
    return "Not one chunk of the question arrived. Nothing has arrived yet. Retrying builds the question again on the same evidence.";
  }
  const requestGuidance = REQUEST_ERROR_GUIDANCE[kind as InterviewStreamRequestErrorKind];
  if (requestGuidance) return requestGuidance;
  const cause = GENERATION_ERROR_CAUSE[kind] ?? "Something went wrong while building the question.";
  return `${cause} ${retryHint(kind, resumable)}`;
}

/** 자동 증가 textarea의 상한입니다. 디자인 원본과 같은 값이고, 넘으면 입력 안에서 스크롤합니다. */
const ANSWER_INPUT_MAX_HEIGHT_PX = 140;

/**
 * 질문이 오기 전 자리를 지키는 표시입니다. 디자인 원본 `ThinkingRow`의 블록 순환을 그대로 그립니다.
 *
 * **순환을 CSS로 돌립니다.** 디자인 원본은 `setInterval`로 400ms마다 상태를 바꾸는데, 그러면 질문이
 * 도착하는 동안 내내 React 렌더가 한 번씩 더 돕니다. 스트리밍 중 리렌더 범위를 줄이는 것이 이
 * 화면의 핵심 제약이라(AGENTS.md) 같은 모양을 렌더 없이 만듭니다. `prefers-reduced-motion`도 CSS에서
 * 함께 처리됩니다.
 *
 * 블록은 장식이라 `aria-hidden`으로 빼고 같은 뜻의 문장을 시각적으로 숨겨 함께 둡니다. 낭독은 상태
 * 문단이 담당하지만 그 문단은 스트림 상태만 말하므로, 대화 흐름 안에서 지금 무엇을 기다리는지는
 * 여기에 남아 있어야 합니다.
 */
function ThinkingRow({ label }: { label: string }) {
  return (
    <p className={styles.thinking}>
      <span className={styles.thinkingLabel}>{ROLE_LABEL_QUESTION}</span>
      <span className={styles.thinkingCells} aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className={styles.visuallyHidden}>{label}</span>
    </p>
  );
}

/** 생성 중 표시의 라벨입니다. `interview-message.tsx`의 질문 라벨과 같은 글자를 씁니다. */
const ROLE_LABEL_QUESTION = "Agent";

/**
 * 저장 상태 안내에 필요한 값입니다(이슈 #115). 저장하지 않는 경로(테스트용 스트림)에는 없습니다.
 *
 * 안내는 대화를 막지 않습니다. 저장이 밀려도 질문과 답변은 그대로 이어지고, 사용자는 안내를 무시한
 * 채 계속할 수 있습니다. 저장은 나중에 이어가기 위한 장치이지 지금 대화의 전제가 아닙니다.
 */
export interface InterviewSaveNotice {
  readonly status: SavedTurnStatus | null;
  readonly unsavedTurnCount: number;
  readonly onRetry: () => void;
  /** 다른 탭이 먼저 저장한 경우에 최신 내용을 다시 불러옵니다. 없으면 그 버튼을 그리지 않습니다. */
  readonly onLoadLatest?: () => void;
}

export interface InterviewStreamViewProps {
  /**
   * 스트림 상태입니다. 훅은 `InterviewScreen`이 들고 있습니다.
   *
   * 종료 조작이 PAAR 패널로 옮겨 가면서 가운데 열과 오른쪽 열이 같은 종료 상태를 봐야 합니다.
   * 두 열은 형제이므로 공통 부모가 훅을 들고 양쪽에 나눠 줍니다.
   */
  stream: InterviewStreamState;
  /**
   * 지금 채우는 중인 블록 이름입니다. 답변 입력 아래에 적어 사용자가 무엇을 묻고 있는지 알게
   * 합니다(이슈 #91 Approach 6). 더 물을 질문이 없으면 호출부가 넘기지 않습니다.
   *
   * 블록 자체가 아니라 이름만 받습니다. 이 컴포넌트는 블록 계약을 몰라도 되고, 테스트용 스트림
   * 경로에는 블록이 아예 없습니다.
   */
  currentBlockLabel?: string;
  save?: InterviewSaveNotice;
}

/**
 * 질문 스트리밍의 표시 기반입니다. 상태는 받기만 하고 만들지 않습니다.
 */
export function InterviewStreamView({ stream, currentBlockLabel, save }: InterviewStreamViewProps) {
  const {
    messages,
    status,
    error,
    receivedSeq,
    removedHistory,
    hasSnapshot,
    canSubmitAnswer,
    isLastQuestionTooLong,
    isEnded,
    retry,
    submitAnswer,
  } = stream;
  // 청크 도착만이 아니라 답변 제출도 내용을 바꿉니다. 답변은 청크가 아니라 `receivedSeq`가 움직이지
  // 않으므로 메시지 수를 함께 묶습니다.
  const { containerRef, hasUnreadContent, scrollToBottom, handleScroll } =
    useAutoScroll<HTMLDivElement>(`${messages.length}:${receivedSeq}`);
  const [draft, setDraft] = useState("");
  const answerInputRef = useRef<HTMLTextAreaElement>(null);

  const baseId = useId();
  const statusId = `${baseId}-status`;
  const unreadId = `${baseId}-unread`;
  const errorId = `${baseId}-error`;
  const answerHintId = `${baseId}-answer-hint`;

  // 첫 내용이 오기 전의 Loading은 여기 한 곳에서만 그립니다. 첫 질문이면 대화가 비어 있고, 꼬리
  // 질문이면 마지막 항목이 사용자의 답변입니다. 두 경우 모두 아직 자라나는 질문이 없습니다.
  // 종료하면 준비 중 안내도 걷습니다. 종료가 요청을 끊으므로 준비하던 질문은 오지 않습니다.
  const isPreparing =
    !isEnded &&
    (status === "connecting" || status === "idle") &&
    !messages.some((message) => message.isStreaming);
  const isFollowUp = messages.length > 0;

  // 서버 상한과 같은 자로 잽니다. 글자 수로 막으면 줄바꿈이 많은 코드 블록 답변이 같은 글자 수로도
  // 서버에서 거절됩니다. 넘긴 뒤 413으로 알리는 대신 넘기지 못하게 막아 답변이 남아 있게 합니다.
  const draftBytes = interviewHistoryItemBytes({ role: "answer", text: draft });
  const isDraftTooLong = draftBytes > INTERVIEW_HISTORY_ITEM_MAX_BYTES;
  const isDraftEmpty = draft.trim() === "";
  const canSubmit = canSubmitAnswer && !isDraftEmpty && !isDraftTooLong;

  /**
   * 다시 시도가 실제로 무언가를 바꾸는 실패인지입니다.
   *
   * 안내가 "다시 시도해도 같은 결과가 나옵니다"라고 말하면서 버튼을 남겨 두면 사용자는 그 버튼을
   * 누르고 같은 요청을 반복합니다. `history_too_large`가 가장 뚜렷한 경우입니다. 그 응답에서는
   * 마지막 항목이 사용자의 답변이라 `retry`가 지울 것이 없고, 같은 이력을 그대로 다시 보내
   * 413이 되돌아옵니다.
   *
   * 판정은 분류 하나가 아니라 `clearsOnRetry`로 합니다. 같은 오류 박스가 그리는
   * `unauthorized`·`invalid_json`·`invalid_request`·`body_too_large`·`llm_request`·`llm_auth`·
   * `llm_configuration`·`server_error`가 모두 같은 성격이므로 분류마다 조건을 두면 다음 분류가
   * 추가될 때 또 빠집니다.
   *
   * 상한을 넘은 질문은 예외입니다. 오류 객체가 없고, 다시 시도가 그 질문을 지우고 같은 이력으로
   * 새로 만들므로 실제로 상태를 바꿉니다.
   */
  const canRetry = isLastQuestionTooLong || (error !== null && clearsOnRetry(error.kind));

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitAnswer(draft)) return;
    setDraft("");
    // 제출은 사용자의 행동이므로 위로 올려 둔 상태여도 자기 답변과 다음 질문이 보이는 자리로 내립니다.
    scrollToBottom();
  };

  /*
   * 답변 칸이 내용만큼 자라게 합니다. 상한을 넘으면 칸 안에서 스크롤합니다.
   *
   * `useLayoutEffect`를 쓰는 이유는 높이를 재고 바꾸는 일이기 때문입니다. `useEffect`로 하면 이전
   * 높이가 한 프레임 그려진 뒤 바뀌어 입력 중에 칸이 튑니다. 잴 때 `auto`로 되돌리지 않으면
   * `scrollHeight`가 지금 높이에 갇혀 줄을 지워도 줄어들지 않습니다.
   */
  useLayoutEffect(() => {
    const el = answerInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ANSWER_INPUT_MAX_HEIGHT_PX)}px`;
  }, [draft]);

  /*
   * 줄바꿈이 답변의 일부라 Enter만으로 보내지 않습니다. 코드 블록을 쓰는 답변에서 첫 줄에 보내집니다.
   * 디자인 원본과 같이 보조 키를 함께 눌렀을 때만 보냅니다. macOS와 그 밖을 모두 받습니다.
   */
  const handleAnswerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
    event.preventDefault();
    if (!canSubmit) return;
    event.currentTarget.form?.requestSubmit();
  };

  /**
   * 저장이 밀렸다는 안내입니다. 마지막 저장이 실패했고 아직 저장되지 않은 턴이 남아 있을 때만 보입니다.
   * 저장에 성공하면 밀린 턴이 없어지므로 안내도 함께 사라집니다.
   */
  const showUnsavedNotice = save !== undefined && save.unsavedTurnCount > 0 && save.status !== null && save.status !== "saved";
  /** 다른 탭이 먼저 저장한 경우입니다. 여기서 자동으로 다시 불러오지 않습니다. 쓰던 답변이 사라집니다. */
  const showStaleNotice = save?.status === "version_conflict";

  return (
    <section className={styles.stream} aria-label="AI question stream">
      {showUnsavedNotice || showStaleNotice ? (
        <div className={styles.saveNotices}>
          {showUnsavedNotice ? (
            <div className={styles.saveNotice}>
              <span className={styles.saveNoticeMark} aria-hidden="true">●</span>
              <p className={styles.saveNoticeText}>Your last answer wasn&apos;t saved.</p>
              <button type="button" className={styles.saveNoticeAction} onClick={save.onRetry}>Retry save</button>
            </div>
          ) : null}
          {showStaleNotice && save?.onLoadLatest ? (
            <div className={styles.saveNotice}>
              <span className={styles.saveNoticeMark} aria-hidden="true">●</span>
              <p className={styles.saveNoticeText}>This interview was changed in another tab.</p>
              <button type="button" className={styles.saveNoticeAction} onClick={save.onLoadLatest}>Load latest</button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className={styles.log}
        role="log"
        // 스트리밍 중에는 메시지 하나의 텍스트가 프레임마다 자라납니다. 이 자리를 live region으로
        // 두면 스크린리더가 커지는 질문 전체를 프레임마다 다시 읽습니다. `role="log"`는 완성된
        // 메시지가 하나씩 추가되는 패턴을 전제하므로 여기에는 맞지 않습니다. 낭독은 아래 상태
        // 문단과 새 메시지 안내가 담당합니다.
        aria-live="off"
        aria-busy={
          !isEnded && (status === "connecting" || status === "streaming" || status === "reconnecting")
        }
        aria-describedby={statusId}
        tabIndex={0}
        onScroll={handleScroll}
      >
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            <InterviewMessage
              role={message.role}
              text={message.text}
              isStreaming={message.isStreaming}
            />
            {/*
              절단 안내를 빠진 자리에 그립니다. 자르는 쪽은 요청 이력이고 화면의 대화는 그대로
              남으므로, 대화 밖에 안내를 두면 사용자가 어느 대목이 빠졌는지 알 수 없습니다.

              자리는 첫 쌍 바로 뒤입니다. `trimInterviewHistory`가 첫 질문과 첫 답변을 남기고 그
              다음부터 빼므로 빠진 구간의 시작이 언제나 여기입니다.

              오류 안내와 같은 자리에 두지 않았습니다. 오류는 사용자가 조작해서 풀어야 하는 상태이고
              절단은 이미 일어난 일을 알리는 것입니다. 같은 자리에 두면 다시 시도 버튼이 절단에도
              달린 것처럼 보입니다.
            */}
            {index === 1 && removedHistory.length > 0 ? (
              <p className={styles.trimNotice}>
                {`The conversation grew long, so the history sent with the next question drops ${pluralCount(removedHistory.length / 2, "question-and-answer pair")} starting here. That part stays on screen, but the AI no longer sees it. The first question and answer and the most recent turns are still sent.`}
              </p>
            ) : null}
          </Fragment>
        ))}
        {isPreparing ? (
          <ThinkingRow
            label={isFollowUp ? "Preparing the next question." : "Preparing the question."}
          />
        ) : null}
      </div>

      {/* 상태 전이를 낭독하는 자리입니다. 처음부터 붙어 있어야 스크린리더가 변경을 잡습니다. */}
      <p id={statusId} className={styles.status} aria-live="polite">
        {isEnded ? ENDED_STATUS_TEXT : STATUS_TEXT[status]}
      </p>

      {/*
        안내 문단을 조건부로 만들지 않고 항상 두고 내용만 비웁니다. live region은 붙어 있는 동안의
        변경만 알리므로, 내용을 담은 채 새로 나타나면 낭독되지 않는 스크린리더가 있습니다.
      */}
      {hasUnreadContent ? (
        <button
          type="button"
          className={styles.unreadButton}
          onClick={scrollToBottom}
          aria-describedby={unreadId}
        >
          View new messages
        </button>
      ) : null}
      <p id={unreadId} className={styles.unreadNotice} aria-live="polite">
        {hasUnreadContent
          ? "New content arrived while auto-scroll was paused. Return to the bottom to resume auto-scroll."
          : ""}
      </p>

      {/*
        상한을 넘은 질문은 전송 오류가 아니지만 사용자가 할 수 있는 일이 같으므로 같은 자리에 같은 모양으로
        그립니다. Error를 두 곳에서 그리지 않습니다.
      */}
      {!isEnded && (error || isLastQuestionTooLong) ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            {error ? error.message : "This question is too long to continue the conversation."}
          </p>
          <p id={errorId} className={styles.errorGuidance}>
            {error
              ? errorGuidance(error.kind, !hasSnapshot)
              : `This question is over the ${INTERVIEW_HISTORY_ITEM_MAX_BYTES.toLocaleString()}-byte limit for a single message, so it cannot be answered. Retrying keeps the conversation so far and rebuilds only this question.`}
          </p>
          {canRetry ? (
            <button
              type="button"
              className={styles.retryButton}
              onClick={retry}
              aria-describedby={errorId}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        답변 입력은 근거 스냅샷이 있을 때만 둡니다. 테스트용 스트림은 대화를 받지 않으므로 그 경로에서
        입력을 열면 답변이 아무 데도 가지 않습니다. 생성 중과 오류 표시 중에는 잠깁니다. 오류는 다시
        시도로 풀어야 하고, 그 다시 시도는 실패한 질문 하나만 다시 만듭니다.
      */}
      {!hasSnapshot ? null : isEnded ? (
        /*
          종료 상태를 답변 입력이 있던 자리에 그립니다. 새 자리를 만들지 않는 이유는 이 자리가
          "지금 사용자가 할 수 있는 일"을 그리는 자리이기 때문입니다. 종료 사실 자체는 위 상태
          문단이 낭독하므로 여기서는 되풀이하지 않고 다음에 무엇이 일어나는지만 적습니다.

          작성 중이던 답변은 이 교체로 버려집니다. 종료 확인 문구가 알린 그대로입니다. `draft`를
          따로 비우지 않는 이유는 종료가 한 방향이라 입력이 다시 열리지 않기 때문입니다. 되돌릴 수
          있게 되면 그때 비우는 자리를 만듭니다.
        */
        <p className={styles.endedNotice}>
          The answer box is closed. Going back to the candidate list clears this conversation for good.
        </p>
      ) : (
        /*
          디자인 원본의 composer입니다. 테두리 하나 안에 입력 칸과 푸터 줄을 넣고, 초점이 안으로
          들어오면 테두리가 진해집니다. 라벨은 시각적으로만 숨깁니다. 디자인에는 라벨 자리가 없지만
          placeholder는 접근 가능한 이름이 되지 못합니다.

          푸터 왼쪽은 디자인에서 PAAR 블록 진행 상태가 들어가는 자리입니다. 그 계약이 아직 없어
          (#89~#91) 지금은 답변 안내가 그 자리를 씁니다. 안내는 `aria-describedby`가 가리킵니다.
        */
        <form className={styles.answerForm} onSubmit={handleSubmit}>
          <label className={styles.visuallyHidden} htmlFor={`${baseId}-answer`}>
            Answer
          </label>
          <div className={styles.composer} data-invalid={isDraftTooLong || undefined}>
            <textarea
              id={`${baseId}-answer`}
              ref={answerInputRef}
              className={styles.answerInput}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleAnswerKeyDown}
              disabled={!canSubmitAnswer}
              rows={1}
              placeholder="Answer the question. Code blocks are welcome."
              aria-describedby={answerHintId}
              aria-invalid={isDraftTooLong || undefined}
            />
            <div className={styles.composerFooter}>
              {/*
                디자인의 이 자리에는 PAAR 블록 진행 상태가 들어갑니다(#91에서 채웠습니다). 답변이
                상한을 넘은 동안에는 감춥니다. 그때 이 옆에 서는 것은 안내가 아니라 왜 보낼 수 없는지를
                알리는 오류 문장이고, 둘을 나란히 두면 오류가 잘립니다.
              */}
              {isDraftTooLong || currentBlockLabel === undefined ? null : (
                <span className={styles.blockProgress}>PAAR · {currentBlockLabel}</span>
              )}
              {/*
                답변 안내입니다. `aria-describedby`가 가리키는 대상이라 **DOM에서 지우지는 않습니다.**
                가리킬 것이 없는 `aria-describedby`는 설명이 통째로 사라지는 결함이고, 이슈 #47 PR #52
                1차 리뷰의 P1이 정확히 그것이었습니다.

                평소에는 시각적으로만 숨기고, 답변이 상한을 넘은 동안에는 보입니다. 그때는 안내가 아니라
                왜 보낼 수 없는지를 알리는 오류이고, 보이지 않으면 사용자는 버튼이 잠긴 이유를 알 수
                없습니다.
              */}
              <p
                id={answerHintId}
                className={isDraftTooLong ? styles.answerError : styles.visuallyHidden}
              >
                {isDraftTooLong
                  ? `Your answer is over the size limit for a single message. It is ${draftBytes.toLocaleString()} bytes and the limit is ${INTERVIEW_HISTORY_ITEM_MAX_BYTES.toLocaleString()} bytes. Line breaks and code blocks count toward the size.`
                  : canSubmitAnswer
                    ? "Sending your answer builds the next question from the conversation so far."
                    : "You can write an answer once the question has fully arrived."}
              </p>
              <div className={styles.composerActions}>
                {/* 단축키 표시입니다. 키 조합 자체는 두 보조 키를 모두 받습니다. */}
                <span className={styles.shortcutHint} aria-hidden="true">
                  ⌘/Ctrl+↵
                </span>
                <button type="submit" className={styles.submitButton} disabled={!canSubmit}>
                  Send
                </button>
              </div>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}

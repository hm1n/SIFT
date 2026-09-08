"use client";

import { Fragment, useId, useState } from "react";
import { clearsOnRetry } from "./errors";
import type { InterviewStreamErrorKind, InterviewStreamRequestErrorKind } from "./errors";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES, interviewHistoryItemBytes } from "./history";
import { InterviewMessage } from "./interview-message";
import { useAutoScroll } from "./use-auto-scroll";
import { useInterviewStream, type InterviewStreamPhase, type UseInterviewStreamOptions } from "./use-interview-stream";
import styles from "./interview-stream-view.module.css";

export const DEFAULT_INTERVIEW_STREAM_URL = "/api/interview/stream";

const STATUS_TEXT: Record<InterviewStreamPhase, string> = {
  idle: "질문 스트리밍을 아직 시작하지 않았습니다.",
  connecting: "질문 스트리밍에 연결하고 있습니다.",
  streaming: "질문이 도착하는 중입니다.",
  reconnecting: "연결이 끊겨 다시 연결하고 있습니다. 이미 받은 내용은 그대로 둡니다.",
  done: "질문이 모두 도착했습니다.",
  error: "질문을 받지 못했습니다.",
};

/**
 * 종료는 스트림 상태가 아니지만 사용자가 낭독으로 알아야 하는 상태는 같은 문단 하나입니다.
 *
 * `InterviewStreamPhase`에 값을 더하지 않았습니다. 그 union은 스트림 수신부의 상태이고 종료는
 * 사용자의 조작입니다. 섞으면 스트림이 끝나지 않은 채 종료한 경우에 어느 쪽을 담을지 정할 수 없습니다.
 * 종료 뒤에는 스트림 상태가 무엇이든 이 문장이 그 자리를 덮습니다.
 */
const ENDED_STATUS_TEXT = "인터뷰를 종료했습니다. 대화는 읽기 전용입니다.";

/**
 * 스트림이 시작되기 전 서버가 거절한 경우입니다. 다시 시도해서 풀리는 것과 아닌 것을 구분해
 * 알립니다.
 */
const REQUEST_ERROR_GUIDANCE: Partial<Record<InterviewStreamRequestErrorKind, string>> = {
  unauthorized: "GitHub 인증 세션이 필요합니다. 다시 로그인한 뒤 시도해 주세요.",
  invalid_request: "요청 형식이 올바르지 않습니다. 다시 시도해도 같은 결과가 나오면 화면을 새로 고쳐 주세요.",
  invalid_json: "요청 형식이 올바르지 않습니다. 다시 시도해도 같은 결과가 나오면 화면을 새로 고쳐 주세요.",
  body_too_large: "질문 근거가 한 번에 보낼 수 있는 크기를 넘었습니다. 다시 시도해도 같은 결과가 나옵니다.",
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
    "대화가 길어져 다음 질문을 만들 수 없습니다. 다시 시도해도 같은 결과가 나옵니다. 인터뷰를 종료하고 후보 목록에서 경험을 다시 골라 새 인터뷰를 시작해 주세요.",
};

/**
 * 생성 쪽 실패의 원인 문장입니다. 재시도가 무엇을 하는지는 `retryHint`가 붙입니다. 원인과 재시도
 * 안내를 갈라 둔 이유는 재시도의 결과가 스트림의 재개 가능 여부에 따라 달라지기 때문입니다.
 */
const GENERATION_ERROR_CAUSE: Partial<Record<InterviewStreamErrorKind, string>> = {
  llm_rate_limit: "질문 생성 호출 한도에 걸렸습니다.",
  llm_timeout: "질문 생성이 시간 안에 끝나지 않았습니다.",
  llm_network: "질문 생성 서비스에 연결하지 못했습니다.",
  llm_auth: "질문 생성 서비스 인증에 실패했습니다. 서버 설정 문제입니다.",
  llm_configuration: "질문 생성 서비스 설정에 문제가 있습니다.",
  /**
   * 크기를 지목하지 않습니다. 2026-09-01 실측에서 Gemini는 잘못된 파라미터도 400으로 돌려주므로 이
   * 분류에 크기와 무관한 실패가 들어옵니다. 근거 크기가 문제인 경우는 provider에 닿기 전에 세 가드가
   * 각자 자기 문구로 먼저 거절합니다. 스냅샷 단계의 `evidence_input_too_large`, 본문 크기의
   * `body_too_large`, route의 프롬프트 바이트 가드입니다. 따라서 이 분류가 실제로 뜻하는 것은 크기가
   * 아니라 provider의 요청 거부입니다.
   */
  llm_request: "질문 생성 서비스가 요청을 받아들이지 않았습니다.",
  /**
   * Gemini의 500 `INTERNAL`과 503 `UNAVAILABLE`(모델 과부하)이 이 분류로 옵니다. flash 계열에서 가장
   * 흔한 일시 실패인데 항목이 없어 "질문을 만드는 중에 오류가 발생했습니다"라는 기본 문구가
   * 나갔습니다. `clearsOnRetry`가 참이므로 `retryHint`가 잠시 뒤 재시도를 덧붙입니다.
   */
  llm_failure: "질문 생성 서비스가 응답하지 못했습니다.",
  server_error: "서버 설정에 문제가 있어 요청을 처리하지 못했습니다.",
};

/**
 * 다시 시도가 무엇을 하는지 알립니다.
 *
 * 이어받을 수 없는 스트림에서는 다시 시도가 이어받는 것이 아니라 처음부터 새로 만드는 것이고, 이미
 * 표시된 내용이 사라집니다. 그 경로에 "이미 받은 내용은 그대로 두었습니다"를 쓰면 안 됩니다.
 * 사용자가 그 문구를 읽고 버튼을 누르면 읽던 질문이 사라집니다.
 */
function retryHint(kind: InterviewStreamErrorKind, resumable: boolean): string {
  if (!clearsOnRetry(kind)) return "다시 시도해도 같은 결과가 나옵니다.";
  return resumable
    ? "이미 받은 내용은 그대로 두었습니다. 잠시 뒤에 다시 시도해 주세요."
    : "잠시 뒤에 다시 시도해 주세요. 다시 시도하면 같은 근거로 질문을 처음부터 새로 만들고, 지금까지 받은 내용은 사라집니다.";
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
    return "연결을 시작하지 못했습니다. 아직 받은 내용은 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.";
  }
  if (kind === "stream_interrupted") {
    return resumable
      ? "자동으로 두 번 다시 연결했지만 실패했습니다. 이미 받은 내용은 그대로 두었고, 다시 시도하면 받은 지점부터 이어받습니다."
      : "질문을 받는 도중 연결이 끊겼습니다. 이 스트림은 끊긴 지점부터 이어받을 수 없어, 다시 시도하면 같은 근거로 질문을 처음부터 새로 만듭니다. 지금까지 받은 내용은 사라집니다.";
  }
  if (kind === "generation_empty") {
    // 청크가 0개라 사라질 내용이 없습니다. 여기에 재시도 문구를 붙이면 잃을 내용이 있다고
    // 오해하게 만듭니다.
    return "질문 내용이 한 조각도 오지 않았습니다. 아직 받은 내용은 없습니다. 다시 시도하면 같은 근거로 질문을 새로 만듭니다.";
  }
  const requestGuidance = REQUEST_ERROR_GUIDANCE[kind as InterviewStreamRequestErrorKind];
  if (requestGuidance) return requestGuidance;
  const cause = GENERATION_ERROR_CAUSE[kind] ?? "질문을 만드는 중에 오류가 발생했습니다.";
  return `${cause} ${retryHint(kind, resumable)}`;
}

export interface InterviewStreamViewProps extends Partial<UseInterviewStreamOptions> {
  url?: string;
}

/**
 * 질문 스트리밍의 표시 기반입니다.
 *
 * `snapshot`을 주면 실제 생성 경로를 씁니다. 근거 스냅샷을 `POST` 본문으로 보내고, 끊겼을 때
 * 이어받지 않습니다. 주지 않으면 테스트용 스트림을 `GET`으로 받고 이어받기도 그대로 동작합니다.
 */
export function InterviewStreamView({
  url = DEFAULT_INTERVIEW_STREAM_URL,
  ...streamOptions
}: InterviewStreamViewProps = {}) {
  const {
    messages,
    status,
    error,
    receivedSeq,
    removedHistory,
    canSubmitAnswer,
    isLastQuestionTooLong,
    isEnded,
    retry,
    submitAnswer,
    endInterview,
  } = useInterviewStream({ url, ...streamOptions });
  // 청크 도착만이 아니라 답변 제출도 내용을 바꿉니다. 답변은 청크가 아니라 `receivedSeq`가 움직이지
  // 않으므로 메시지 수를 함께 묶습니다.
  const { containerRef, hasUnreadContent, scrollToBottom, handleScroll } =
    useAutoScroll<HTMLDivElement>(`${messages.length}:${receivedSeq}`);
  const [draft, setDraft] = useState("");
  // 종료 확인은 화면 상태입니다. 훅에는 확정된 종료만 알립니다. 확인 단계를 훅에 두면 종료하지 않은
  // 상태가 두 가지가 되고, 조작 잠금이 어느 쪽을 봐야 하는지 갈립니다.
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);

  const baseId = useId();
  const statusId = `${baseId}-status`;
  const unreadId = `${baseId}-unread`;
  const errorId = `${baseId}-error`;
  const answerHintId = `${baseId}-answer-hint`;
  const endConfirmId = `${baseId}-end-confirm`;

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

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!submitAnswer(draft)) return;
    setDraft("");
    // 제출은 사용자의 행동이므로 위로 올려 둔 상태여도 자기 답변과 다음 질문이 보이는 자리로 내립니다.
    scrollToBottom();
  };

  // 작성 중이던 답변은 확인 문구가 알린 대로 버립니다. 어디에도 보내지 않으므로 남겨 둘 자리가 없습니다.
  const handleEnd = () => {
    endInterview();
    setIsConfirmingEnd(false);
    setDraft("");
  };

  return (
    <section className={styles.stream} aria-label="AI 질문 스트리밍">
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
                {`대화가 길어져 여기서부터 질문과 답변 ${removedHistory.length / 2}쌍이 다음 질문의 이력에서 빠졌습니다. 화면에는 그대로 남아 있지만 AI는 더 이상 이 부분을 보지 못합니다. 첫 질문과 첫 답변, 그리고 최근 대화는 계속 실립니다.`}
              </p>
            ) : null}
          </Fragment>
        ))}
        {isPreparing ? (
          <p className={styles.preparing}>
            {isFollowUp ? "다음 질문을 준비하고 있습니다." : "질문을 준비하고 있습니다."}
          </p>
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
          새 메시지 보기
        </button>
      ) : null}
      <p id={unreadId} className={styles.unreadNotice} aria-live="polite">
        {hasUnreadContent
          ? "자동 스크롤을 멈춘 동안 새 내용이 도착했습니다. 하단으로 돌아오면 자동 스크롤을 다시 시작합니다."
          : ""}
      </p>

      {/*
        상한을 넘은 질문은 전송 오류가 아니지만 사용자가 할 수 있는 일이 같으므로 같은 자리에 같은 모양으로
        그립니다. Error를 두 곳에서 그리지 않습니다.
      */}
      {!isEnded && (error || isLastQuestionTooLong) ? (
        <div className={styles.error} role="alert">
          <p className={styles.errorMessage}>
            {error ? error.message : "질문이 너무 길어 대화를 이어갈 수 없습니다."}
          </p>
          <p id={errorId} className={styles.errorGuidance}>
            {error
              ? errorGuidance(error.kind, streamOptions.snapshot === undefined)
              : `이 질문은 한 번에 보낼 수 있는 크기 ${INTERVIEW_HISTORY_ITEM_MAX_BYTES.toLocaleString()}바이트를 넘어 답변을 받을 수 없습니다. 다시 시도하면 지금까지의 대화를 그대로 두고 이 질문만 새로 만듭니다.`}
          </p>
          <button
            type="button"
            className={styles.retryButton}
            onClick={retry}
            aria-describedby={errorId}
          >
            다시 시도
          </button>
        </div>
      ) : null}

      {/*
        답변 입력은 근거 스냅샷이 있을 때만 둡니다. 테스트용 스트림은 대화를 받지 않으므로 그 경로에서
        입력을 열면 답변이 아무 데도 가지 않습니다. 생성 중과 오류 표시 중에는 잠깁니다. 오류는 다시
        시도로 풀어야 하고, 그 다시 시도는 실패한 질문 하나만 다시 만듭니다.
      */}
      {streamOptions.snapshot === undefined ? null : isEnded ? (
        /*
          종료 상태를 답변 입력이 있던 자리에 그립니다. 새 자리를 만들지 않는 이유는 이 자리가
          "지금 사용자가 할 수 있는 일"을 그리는 자리이기 때문입니다. 종료 사실 자체는 위 상태
          문단이 낭독하므로 여기서는 되풀이하지 않고 다음에 무엇이 일어나는지만 적습니다.
        */
        <p className={styles.endedNotice}>
          답변 입력을 닫았습니다. 후보 목록으로 돌아가면 이 대화는 사라지고 다시 이어갈 수 없습니다.
        </p>
      ) : (
        <>
        <form className={styles.answerForm} onSubmit={handleSubmit}>
          <label className={styles.answerLabel} htmlFor={`${baseId}-answer`}>
            답변
          </label>
          <textarea
            id={`${baseId}-answer`}
            className={styles.answerInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!canSubmitAnswer}
            rows={4}
            placeholder="질문에 대한 답변을 적어 주세요. 코드 블록도 쓸 수 있습니다."
            aria-describedby={answerHintId}
            aria-invalid={isDraftTooLong || undefined}
          />
          <p id={answerHintId} className={styles.answerHint}>
            {isDraftTooLong
              ? `답변이 한 번에 보낼 수 있는 크기를 넘었습니다. ${draftBytes.toLocaleString()}바이트이고 상한은 ${INTERVIEW_HISTORY_ITEM_MAX_BYTES.toLocaleString()}바이트입니다. 줄바꿈과 코드 블록도 크기에 들어갑니다.`
              : canSubmitAnswer
                ? "답변을 보내면 지금까지의 대화를 바탕으로 다음 질문을 만듭니다."
                : "질문이 다 도착하면 답변을 쓸 수 있습니다."}
          </p>
          <button type="submit" className={styles.submitButton} disabled={!canSubmit}>
            답변 보내기
          </button>
        </form>

        {/*
          종료는 되돌릴 수 없으므로 한 번 확인을 받습니다. 확인 문구는 사라지는 것을 모두 적습니다.
          작성 중인 답변, 그리고 후보 목록으로 돌아갈 때의 대화입니다.

          생성 중에도 누를 수 있게 둡니다. 질문을 기다리다 그만두는 것을 막을 이유가 없고, 종료가
          진행 중인 요청을 끊습니다.
        */}
        {isConfirmingEnd ? (
          <div className={styles.endConfirm} role="group" aria-labelledby={endConfirmId}>
            <p id={endConfirmId} className={styles.endConfirmText}>
              인터뷰를 종료하면 답변 입력이 닫히고 대화는 읽기 전용으로 남습니다. 작성 중인 답변은
              사라집니다. 후보 목록으로 돌아가면 대화도 사라지고 다시 이어갈 수 없습니다.
            </p>
            <div className={styles.endActions}>
              {/* 확인 문구를 읽지 않고 누르는 일을 줄이려고 초점을 확인 버튼으로 옮깁니다. */}
              <button
                type="button"
                className={styles.endConfirmButton}
                onClick={handleEnd}
                autoFocus
              >
                인터뷰 종료
              </button>
              <button
                type="button"
                className={styles.endCancelButton}
                onClick={() => setIsConfirmingEnd(false)}
              >
                계속하기
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className={styles.endButton}
            onClick={() => setIsConfirmingEnd(true)}
          >
            인터뷰 종료하기
          </button>
        )}
        </>
      )}
    </section>
  );
}

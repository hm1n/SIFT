import { useId, useState } from "react";
import { BlockSentences } from "@/features/experience-block/block-sentences";
import type { BlockUpdateFetchErrorKind } from "@/features/experience-block/client";
import { filledBlockCount } from "@/features/experience-block/block-edits";
import { BLOCK_LABELS } from "@/features/experience-block/block-labels";
import { blockConflicts, markDisplay } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockKind } from "@/features/experience-block/types";
import type { UseExperienceInterviewState } from "@/features/experience-block/use-experience-interview";
import styles from "./paar-panel.module.css";

/** PAAR 블록은 PROBLEM·ANALYZE·ACTION·RESULT 넷입니다. */
export const PAAR_BLOCK_COUNT = BLOCK_KINDS.length;

/**
 * 답변이 블록에 반영되지 않은 이유입니다. 분류를 문장으로 옮기는 자리이고, 목적은 사용자가 다시
 * 시도하면 풀릴 일인지 아닌지를 가리는 것입니다.
 *
 * 문구를 넣은 계기는 2026-09-15의 사고입니다. `.env`의 키 이름이 어긋나 블록 갱신이 매번 인증 실패로
 * 끝났는데 화면에는 "반영되지 않았습니다"만 떠서, 설정 문제라는 것이 드러나기까지 인터뷰 두 개의
 * 대화가 통째로 사라졌습니다. 저장이 이 요청에 얹혀 가므로 반영 실패는 곧 저장 실패입니다.
 *
 * 분류를 다 적지 않습니다. 없는 분류에는 아래의 일반 문구가 나갑니다. 틀린 원인을 단정하는 것보다
 * 원인을 말하지 않는 편이 낫습니다. 문장은 `interview-stream-view.tsx`의 생성 실패 문구와 같은
 * 방식으로 씁니다.
 */
export const BLOCK_UPDATE_ERROR_CAUSE: Partial<Record<BlockUpdateFetchErrorKind, string>> = {
  network: "서버에 연결하지 못했습니다.",
  llm_network: "블록 갱신 서비스에 연결하지 못했습니다.",
  llm_timeout: "갱신이 제한 시간 안에 끝나지 않았습니다.",
  llm_rate_limit: "블록 갱신 서비스가 호출 한도에 걸렸습니다.",
  llm_failure: "블록 갱신 서비스가 응답하지 않았습니다.",
  llm_request: "블록 갱신 서비스가 요청을 받아들이지 않았습니다.",
  // 설정 문제는 다시 시도해도 같은 결과입니다. 사용자가 아니라 서버가 고쳐야 한다고 분명히 적습니다.
  llm_auth: "블록 갱신 서비스 인증에 실패했습니다. 서버 설정 문제입니다.",
  llm_configuration: "블록 갱신 서비스 설정이 잘못되었습니다. 서버 설정 문제입니다.",
  unauthorized: "로그인 세션이 더 이상 유효하지 않습니다. 다시 로그인해 주세요.",
  // 모델 출력이 흔들린 경우입니다. 같은 답변으로 다시 시도하면 통과할 수 있습니다.
  block_update_rejected: "모델 출력이 검증을 통과하지 못했습니다.",
  schema_validation: "모델 출력이 검증을 통과하지 못했습니다.",
  json_parse: "모델 출력을 읽지 못했습니다.",
  unknown_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unrelated_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unknown_file_path: "모델이 이 경험의 근거에 없는 파일을 인용했습니다.",
  history_too_large: "이 대화가 길어 한 번의 갱신 요청에 담을 수 없습니다.",
  claims_too_large: "이 경험의 블록이 커서 한 번의 갱신 요청에 담을 수 없습니다.",
  body_too_large: "요청이 커져 보낼 수 없습니다.",
  server_error: "서버 설정 문제로 요청을 처리하지 못했습니다.",
};

/** 카드가 그리는 네 가지 상태입니다. 이슈 #91 Approach 2의 표와 같습니다. */
type CardState = "pending" | "collecting" | "filled" | "unfilled";

const CARD_STATE_LABELS: Readonly<Record<CardState, string>> = {
  pending: "시작 전",
  collecting: "수집 중",
  filled: "채움",
  unfilled: "비어 있음",
};

const CARD_EMPTY_TEXT: Readonly<Record<CardState, string>> = {
  pending: "대화를 진행하면 AI가 이 블록을 채웁니다.",
  collecting: "AI가 마지막 답변을 이 블록에 반영하고 있습니다.",
  filled: "",
  unfilled: "이 블록은 채우지 못한 채 인터뷰가 끝났습니다.",
};

/**
 * 카드 상태를 정합니다.
 *
 * `evaluation[block] === null`을 "시작 전"의 근거로 쓰지 않습니다. 리듀서가 targetBlock과 영향받은
 * 블록의 평가 누락을 거절하지 않아, 질문을 이미 주고받은 블록도 평가가 비어 있을 수 있습니다
 * (`llm-wiki/wiki/2026-09-11-PAAR-경험블록-후속-backlog.md` 1번). 문장이 있는지와 인터뷰가
 * 끝났는지만 보면 그 결함에 기대지 않습니다.
 *
 * "수집 중"은 훅이 알려 주는 갱신 대상(`updatingBlock`)으로만 정합니다. 예전에는 `isBlockUpdating`과
 * `currentTarget`을 함께 봤는데, 미반영 재처리는 예전 턴의 대상을 갱신하므로 `currentTarget`과
 * 어긋나 관계없는 카드가 "수집 중"으로 보였습니다(PR #121 리뷰 1라운드).
 */
export function cardState(input: {
  readonly hasSentences: boolean;
  readonly isUpdatingThisBlock: boolean;
  readonly isEnded: boolean;
}): CardState {
  if (input.isUpdatingThisBlock) return "collecting";
  if (input.hasSentences) return "filled";
  return input.isEnded ? "unfilled" : "pending";
}

interface BlockCardProps {
  block: BlockKind;
  stream: UseExperienceInterviewState;
}

function BlockCard({ block, stream }: BlockCardProps) {
  const { blockState, updatingBlock, isEnded, unreflectedBlocks } = stream;
  const marks = markDisplay(blockState, block);
  const state = cardState({
    hasSentences: marks.length > 0,
    isUpdatingThisBlock: updatingBlock === block,
    isEnded,
  });

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h4 className={styles.cardTitle}>{BLOCK_LABELS[block]}</h4>
        <span className={styles.cardState} data-state={state}>
          {CARD_STATE_LABELS[state]}
        </span>
      </div>

      <BlockSentences
        marks={marks}
        conflicts={blockConflicts(blockState, block)}
        emptyText={CARD_EMPTY_TEXT[state]}
      />

      {/* 어느 블록이 미반영인지만 알립니다. 다시 처리하는 버튼은 패널 위에 하나만 둡니다. */}
      {unreflectedBlocks.includes(block) ? (
        <p className={styles.cardError}>이 블록을 겨냥한 답변이 아직 반영되지 않았습니다.</p>
      ) : null}
    </div>
  );
}

export interface PaarPanelProps {
  /** 인터뷰 상태 전체입니다. 훅은 `InterviewScreen`이 들고 있습니다. */
  stream: UseExperienceInterviewState;
  /**
   * 이 인터뷰가 저장되는 중인지입니다(이슈 #115). 종료 확인 문구가 갈립니다. 저장되는 인터뷰는
   * 끝내도 사라지지 않고 Interviews에 남으므로 "다시 이어갈 수 없다"고 말하면 안 됩니다.
   */
  isSaved?: boolean;
}

/**
 * 인터뷰 워크스페이스의 오른쪽 열입니다. 블록 카드 네 개와 진행 표시, 종료 조작을 그립니다.
 *
 * **이 패널은 블록을 고치지 않습니다.** 편집은 저장된 인터뷰의 요약 화면(`SavedInterviewScreen`)에만
 * 있습니다. 예전에는 종료하는 순간 이 패널이 카드 넷을 편집 가능한 모습으로 다시 그렸는데, 종료가
 * 곧바로 요약 화면으로 넘어가는 조작이라 그 모습이 한 프레임 번쩍이고 사라졌습니다. 자리를 옮긴
 * 다른 이유는 진행 중 편집이 성립하지 않는다는 것입니다. 모델은 편집본을 보지 못하므로 화면에 보이는
 * 값과 판정에 쓰는 값이 갈라지고, 이어가기 뒤 그 블록을 건드리는 순간 `applyBlockUpdate`가 고친
 * 문장을 통째로 갈아 끼웁니다.
 *
 * **카드에 `aria-live`를 두지 않습니다.** 네 카드가 답변마다 함께 바뀌므로, 낭독 대상으로 삼으면 한
 * 번 답할 때마다 네 블록이 통째로 읽히고 대화 영역의 상태 문단과 새 메시지 안내를 덮습니다. 낭독
 * 대상은 그 둘로 둡니다(이슈 #91 Constraint, 이슈 #60 실측으로 정한 경계).
 *
 * 종료 버튼을 채워진 블록 수로 잠그지 않습니다. 디자인 원본은 네 블록이 다 차야 누를 수 있게
 * 하지만, 이슈 #78이 사용자가 언제든 인터뷰를 끝낼 수 있도록 정했습니다. 경위는
 * `llm-wiki/wiki/2026-09-14-PAAR-블록-패널과-종료-후-편집.md`에 있습니다.
 */
export function PaarPanel({ stream, isSaved = false }: PaarPanelProps) {
  const {
    blockState,
    isEnded,
    isReadyToFinish,
    isBlockUpdating,
    unreflectedTurnId,
    unreflectedReason,
    retryUnreflectedBlockUpdate,
    endInterview,
  } = stream;

  // 종료 확인은 이 조작의 화면 상태입니다. 훅에는 확정된 종료만 알립니다. 확인 단계를 훅에 두면
  // 종료하지 않은 상태가 두 가지가 되고, 조작 잠금이 어느 쪽을 봐야 하는지 갈립니다.
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const endConfirmId = useId();
  const filled = filledBlockCount(blockState);

  return (
    <section className={styles.panel} aria-labelledby="paar-panel-heading">
      <div className={styles.header}>
        <h3 id="paar-panel-heading" className={styles.heading}>
          PAAR
        </h3>
        <span className={styles.count}>
          / {String(filled).padStart(2, "0")} OF {String(PAAR_BLOCK_COUNT).padStart(2, "0")}
        </span>
      </div>

      <div className={styles.body}>
        {/*
          갱신이 실패했거나 아직 처리 중인 답변이 있으면 알리고 그 자리에서 다시 처리하게 합니다.
          이전 표시 문장은 그대로 둡니다. 실패를 정보 부족으로 바꾸지 않습니다(설계 9절).

          버튼은 갱신이 도는 동안 잠급니다. 재처리는 미반영 턴 전체를 한 번에 다시 보내므로, 연타하면
          같은 턴이 큐에 여러 번 들어가 이미 반영을 끝낸 뒤에도 같은 요청이 또 나갑니다
          (`llm-wiki/wiki/2026-09-11-PAAR-경험블록-후속-backlog.md` 3번).
        */}
        {unreflectedTurnId === null ? null : (
          <div className={styles.unreflected}>
            <p className={styles.unreflectedText}>
              마지막 답변이 아직 반영되지 않았고, 그래서 저장도 되지 않았습니다.
            </p>
            {/*
              이유를 함께 적습니다. 반영 실패는 저장 실패이기도 해서, 원인을 모르면 사용자가 같은
              답변을 반복하다 대화를 통째로 잃습니다.
            */}
            <p className={styles.unreflectedCause}>
              {(unreflectedReason === null ? undefined : BLOCK_UPDATE_ERROR_CAUSE[unreflectedReason]) ??
                "블록 갱신이 끝나지 않았습니다."}
            </p>
            <button
              type="button"
              className={styles.unreflectedRetry}
              disabled={isBlockUpdating}
              onClick={retryUnreflectedBlockUpdate}
            >
              {isBlockUpdating ? "다시 시도 중…" : "다시 시도"}
            </button>
          </div>
        )}

        {BLOCK_KINDS.map((block) => (
          <BlockCard key={block} block={block} stream={stream} />
        ))}
      </div>

      {/*
        더 물을 질문이 없으면 완료 안내를 보입니다. 이 값만으로 종료하지 않습니다. 종료 권한은
        사용자에게만 있습니다(이슈 #87 Constraint).
      */}
      {isReadyToFinish && !isEnded ? (
        <p className={styles.readyNotice}>
          더 물을 질문이 없습니다. 원하는 때에 인터뷰를 완료할 수 있습니다.
        </p>
      ) : null}

      {/*
        종료는 되돌릴 수 없으므로 한 번 확인을 받습니다. 확인 문구는 사라지는 것을 모두 적습니다.
        작성 중인 답변, 그리고 후보 목록으로 돌아갈 때의 대화입니다.

        생성 중에도 누를 수 있게 둡니다. 질문을 기다리다 그만두는 것을 막을 이유가 없고, 종료가
        진행 중인 요청을 끊습니다. 끝난 뒤에는 자리째 걷습니다. 다시 시작하는 조작이 없기 때문입니다.
      */}
      {isEnded ? null : (
        <div className={styles.footer}>
          {isConfirmingEnd ? (
            <div className={styles.endConfirm} role="group" aria-labelledby={endConfirmId}>
              <p id={endConfirmId} className={styles.endConfirmText}>
                {/*
                  저장되는 인터뷰는 끝내도 사라지지 않고 Interviews에 남습니다(이슈 #115). 끝내면
                  그 인터뷰의 요약으로 돌아가고, 블록 편집은 거기서 엽니다. 저장되지 않는 인터뷰에는
                  돌아갈 요약이 없으므로 고칠 기회도 없습니다. 있지도 않은 편집을 약속하지 않습니다.
                */}
                {isSaved
                  ? "인터뷰를 끝내면 답변 입력이 닫히고 대화는 읽기 전용이 됩니다. 쓰던 답변은 사라집니다. 인터뷰는 왼쪽 Interviews에 남아 있고, 거기서 다시 열어 PAAR 블록을 고칠 수 있습니다."
                  : "인터뷰를 끝내면 답변 입력이 닫히고 대화는 읽기 전용이 됩니다. 쓰던 답변은 사라집니다. 이 인터뷰는 저장되지 않으므로 PAAR 블록은 지금 상태로 남고 나중에 고칠 수 없습니다. 후보 목록으로 돌아가면 대화도 함께 사라지고 다시 이어갈 수 없습니다."}
              </p>
              <div className={styles.endActions}>
                {/* 확인 문구를 읽지 않고 누르는 일을 줄이려고 초점을 확인 버튼으로 옮깁니다. */}
                <button type="button" className={styles.endButton} onClick={endInterview} autoFocus>
                  인터뷰 완료
                </button>
                <button
                  type="button"
                  className={styles.endCancelButton}
                  onClick={() => setIsConfirmingEnd(false)}
                >
                  인터뷰 계속하기
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.endButton}
              onClick={() => setIsConfirmingEnd(true)}
            >
              인터뷰 완료
            </button>
          )}
        </div>
      )}
    </section>
  );
}

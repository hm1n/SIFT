import { useId, useState } from "react";
import {
  blockEditByteLength,
  blockMarks,
  effectiveConflicts,
  effectiveDisplay,
  filledBlockCount,
  formatBlockEdit,
  parseBlockEdit,
  validateBlockEdit,
  type BlockEdits,
} from "@/features/experience-block/block-edits";
import { BLOCK_LABELS } from "@/features/experience-block/block-labels";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockKind, type DisplaySentence } from "@/features/experience-block/types";
import type { UseExperienceInterviewState } from "@/features/experience-block/use-experience-interview";
import styles from "./paar-panel.module.css";

/** PAAR 블록은 PROBLEM·ANALYZE·ACTION·RESULT 넷입니다. */
export const PAAR_BLOCK_COUNT = BLOCK_KINDS.length;

/** 사용자 주장과 저장소 관찰이 어긋난 상태입니다. 문장 안이 아니라 밖에 그립니다(설계 8절). */
const CONFLICT_MARK = "Conflicts with the evidence · needs checking";

/** 카드가 그리는 네 가지 상태입니다. 이슈 #91 Approach 2의 표와 같습니다. */
type CardState = "pending" | "collecting" | "filled" | "unfilled";

const CARD_STATE_LABELS: Readonly<Record<CardState, string>> = {
  pending: "Not started",
  collecting: "Collecting",
  filled: "Filled",
  unfilled: "Not filled",
};

const CARD_EMPTY_TEXT: Readonly<Record<CardState, string>> = {
  pending: "The interview hasn't reached this block yet.",
  collecting: "Working your latest answer into this block.",
  filled: "",
  unfilled: "The interview ended without anything to put here.",
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

/** 같은 커밋·파일 인용이 여러 주장에 붙어 있으면 화면에는 한 번만 그립니다. */
function uniqueSources(sources: readonly { commitSha: string; filePath: string | null }[]) {
  const seen = new Map<string, { commitSha: string; filePath: string | null }>();
  for (const source of sources) seen.set(`${source.commitSha}:${source.filePath ?? ""}`, source);
  return [...seen.values()];
}

interface BlockCardProps {
  block: BlockKind;
  stream: UseExperienceInterviewState;
  edits: BlockEdits;
  onEditBlock: (block: BlockKind, sentences: readonly DisplaySentence[]) => void;
}

function BlockCard({ block, stream, edits, onEditBlock }: BlockCardProps) {
  const { blockState, updatingBlock, isEnded, unreflectedBlocks } = stream;
  const sentences = effectiveDisplay(blockState, edits, block);
  const marks = blockMarks(blockState, edits, block);
  const conflicts = effectiveConflicts(blockState, edits, block);
  const state = cardState({
    hasSentences: sentences.length > 0,
    isUpdatingThisBlock: updatingBlock === block,
    isEnded,
  });

  // 편집은 한 번에 한 카드만 엽니다. 여러 카드를 동시에 열 이유가 없고, 열린 편집이 하나뿐이면
  // 저장하지 않은 입력이 어디 있는지도 분명해집니다.
  const [draft, setDraft] = useState<string | null>(null);
  const editId = useId();
  const parsed = draft === null ? null : parseBlockEdit(draft);
  const rejection = parsed === null ? null : validateBlockEdit(parsed);
  const remainingBytes = parsed === null ? 0 : BLOCK_MAX_BYTES - blockEditByteLength(parsed);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <h4 className={styles.cardTitle}>{BLOCK_LABELS[block]}</h4>
        <span className={styles.cardState} data-state={state}>
          {CARD_STATE_LABELS[state]}
        </span>
      </div>

      {sentences.length === 0 ? (
        <p className={styles.cardEmpty}>{CARD_EMPTY_TEXT[state]}</p>
      ) : (
        <ul className={styles.sentences}>
          {marks.map((mark, index) => (
            // 문장은 사용자가 고치면 순서가 그대로이므로 위치를 키로 씁니다. 표시 문장에는 식별자가
            // 없고, 본문을 키로 쓰면 같은 문장이 두 번 나올 때 깨집니다.
            <li key={index} className={styles.sentence}>
              <p className={styles.sentenceText}>{mark.text}</p>
              {mark.repositorySources.length > 0 ? (
                <ul className={styles.sources}>
                  {uniqueSources(mark.repositorySources).map((source) => (
                    <li key={`${source.commitSha}:${source.filePath ?? ""}`} className={styles.source}>
                      <span className={styles.sourceSha}>{source.commitSha.slice(0, 7)}</span>
                      {source.filePath === null ? null : (
                        <span className={styles.sourcePath}>{source.filePath}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/*
        충돌은 블록 문장 밖에 그립니다(설계 8절). 어긋난 것은 문장이 아니라 사용자 주장과 저장소
        관찰이고, 충돌 때문에 블록 전체를 비우지도 않습니다.
      */}
      {conflicts.length > 0 ? (
        <div className={styles.conflict}>
          <p className={styles.conflictMark}>{CONFLICT_MARK}</p>
          <ul className={styles.conflictList}>
            {conflicts.map((conflict) => (
              <li key={conflict.claimId}>{conflict.observation}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 어느 블록이 미반영인지만 알립니다. 다시 처리하는 버튼은 패널 위에 하나만 둡니다. */}
      {unreflectedBlocks.includes(block) ? (
        <p className={styles.cardError}>An answer aimed at this block hasn&apos;t been reflected yet.</p>
      ) : null}

      {/*
        편집은 인터뷰가 끝난 뒤에만 엽니다. 진행 중에 열면 화면에 보이는 값과 모델이 판정에 쓰는 값이
        갈라집니다. 모델은 편집본을 보지 못하므로 같은 것을 계속 묻거나, 반대로 사용자가 지운 내용을
        근거로 충분하다고 판정합니다.
      */}
      {isEnded ? (
        draft === null ? (
          <button
            type="button"
            className={styles.editButton}
            onClick={() => setDraft(formatBlockEdit(sentences))}
          >
            Edit
          </button>
        ) : (
          <div className={styles.editor}>
            <label className={styles.editorLabel} htmlFor={editId}>
              {BLOCK_LABELS[block]} — one sentence per line
            </label>
            <textarea
              id={editId}
              className={styles.editorInput}
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby={`${editId}-note`}
              aria-invalid={rejection !== null || undefined}
            />
            {/*
              편집하면 저장소 인용을 잃는다는 사실을 고치기 전에 알립니다. 되돌릴 수 없고 오타 하나를
              고쳐도 같으므로, 바뀐 뒤에 배지로 알리는 것은 늦습니다.
            */}
            <p id={`${editId}-note`} className={styles.editorNote}>
              Editing drops the repository citations on these sentences. Edited text is shown as your
              own statement. {remainingBytes.toLocaleString()} bytes left.
            </p>
            {rejection === "too_many_statements" ? (
              <p className={styles.editorError}>
                Keep it to {BLOCK_MAX_STATEMENTS} lines or fewer. Each line is one sentence.
              </p>
            ) : null}
            {rejection === "block_too_large" ? (
              <p className={styles.editorError}>
                This block is over the {BLOCK_MAX_BYTES.toLocaleString()} byte limit the server uses.
              </p>
            ) : null}
            <div className={styles.editorActions}>
              <button
                type="button"
                className={styles.editorSave}
                disabled={rejection !== null}
                onClick={() => {
                  if (parsed === null || rejection !== null) return;
                  onEditBlock(block, parsed);
                  setDraft(null);
                }}
              >
                Save
              </button>
              <button type="button" className={styles.editorCancel} onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )
      ) : null}
    </div>
  );
}

export interface PaarPanelProps {
  /** 인터뷰 상태 전체입니다. 훅은 `InterviewScreen`이 들고 있습니다. */
  stream: UseExperienceInterviewState;
  /** 종료 후 사용자가 고친 블록 문장입니다. 개수 표시도 같은 값을 봐야 해서 화면이 들고 있습니다. */
  edits: BlockEdits;
  onEditBlock: (block: BlockKind, sentences: readonly DisplaySentence[]) => void;
  /**
   * 이 인터뷰가 저장되는 중인지입니다(이슈 #115). 종료 확인 문구가 갈립니다. 저장되는 인터뷰는
   * 끝내도 사라지지 않고 Interviews에 남으므로 "다시 이어갈 수 없다"고 말하면 안 됩니다.
   */
  isSaved?: boolean;
}

/**
 * 인터뷰 워크스페이스의 오른쪽 열입니다. 블록 카드 네 개와 진행 표시, 종료 조작을 그립니다.
 *
 * **카드에 `aria-live`를 두지 않습니다.** 네 카드가 답변마다 함께 바뀌므로, 낭독 대상으로 삼으면 한
 * 번 답할 때마다 네 블록이 통째로 읽히고 대화 영역의 상태 문단과 새 메시지 안내를 덮습니다. 낭독
 * 대상은 그 둘로 둡니다(이슈 #91 Constraint, 이슈 #60 실측으로 정한 경계).
 *
 * 종료 버튼을 채워진 블록 수로 잠그지 않습니다. 디자인 원본은 네 블록이 다 차야 누를 수 있게
 * 하지만, 이슈 #78이 사용자가 언제든 인터뷰를 끝낼 수 있도록 정했습니다. 경위는
 * `llm-wiki/wiki/2026-09-14-PAAR-블록-패널과-종료-후-편집.md`에 있습니다.
 */
export function PaarPanel({ stream, edits, onEditBlock, isSaved = false }: PaarPanelProps) {
  const {
    blockState,
    isEnded,
    isReadyToFinish,
    isBlockUpdating,
    unreflectedTurnId,
    retryUnreflectedBlockUpdate,
    endInterview,
  } = stream;

  // 종료 확인은 이 조작의 화면 상태입니다. 훅에는 확정된 종료만 알립니다. 확인 단계를 훅에 두면
  // 종료하지 않은 상태가 두 가지가 되고, 조작 잠금이 어느 쪽을 봐야 하는지 갈립니다.
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const endConfirmId = useId();
  const filled = filledBlockCount(blockState, edits);

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
            <p className={styles.unreflectedText}>Your latest answer hasn&apos;t been reflected yet.</p>
            <button
              type="button"
              className={styles.unreflectedRetry}
              disabled={isBlockUpdating}
              onClick={retryUnreflectedBlockUpdate}
            >
              {isBlockUpdating ? "Retrying…" : "Try again"}
            </button>
          </div>
        )}

        {BLOCK_KINDS.map((block) => (
          <BlockCard
            key={block}
            block={block}
            stream={stream}
            edits={edits}
            onEditBlock={onEditBlock}
          />
        ))}
      </div>

      {/*
        더 물을 질문이 없으면 완료 안내를 보입니다. 이 값만으로 종료하지 않습니다. 종료 권한은
        사용자에게만 있습니다(이슈 #87 Constraint).
      */}
      {isReadyToFinish && !isEnded ? (
        <p className={styles.readyNotice}>
          There&apos;s nothing left to ask. You can end the interview whenever you&apos;re ready.
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
                  그 인터뷰의 요약으로 돌아가고, 블록 편집은 거기서 다시 열어 이어갑니다.
                */}
                {isSaved
                  ? "Ending the interview closes the answer box and leaves the conversation read-only. Any answer you are still writing is discarded. The interview stays in Interviews on the left, and you can open it again from there to edit the PAAR blocks."
                  : "Ending the interview closes the answer box and leaves the conversation read-only. Any answer you are still writing is discarded. You can edit the PAAR blocks afterwards. Going back to the candidate list clears the conversation too, and it cannot be resumed."}
              </p>
              <div className={styles.endActions}>
                {/* 확인 문구를 읽지 않고 누르는 일을 줄이려고 초점을 확인 버튼으로 옮깁니다. */}
                <button type="button" className={styles.endButton} onClick={endInterview} autoFocus>
                  End the interview
                </button>
                <button
                  type="button"
                  className={styles.endCancelButton}
                  onClick={() => setIsConfirmingEnd(false)}
                >
                  Continue the interview
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.endButton}
              onClick={() => setIsConfirmingEnd(true)}
            >
              End interview
            </button>
          )}
        </div>
      )}
    </section>
  );
}

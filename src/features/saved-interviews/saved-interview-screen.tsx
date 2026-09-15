"use client";

import { useId, useState } from "react";
import { DELETION_NOTICE_COPY, SAVED_INTERVIEW_SCREEN_COPY } from "@/copy/saved";
import {
  blockEditByteLength,
  blockMarks,
  effectiveConflicts,
  effectiveDisplay,
  formatBlockEdit,
  parseBlockEdit,
  validateBlockEdit,
  type BlockEdits,
} from "@/features/experience-block/block-edits";
import { BlockSentences } from "@/features/experience-block/block-sentences";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockKind, type ExperienceBlockState } from "@/features/experience-block/types";
import {
  EVIDENCE_VERIFIABILITY_NOTICE,
  REPOSITORY_VERIFIED_NOTICE,
} from "@/features/experience-candidates/evidence-verifiability";
import { isExperienceEvidenceSnapshot } from "@/features/interview/question-request";
import { SavedInterviewFetchError, saveSavedInterviewBlock } from "./client";
import { isRestorableBlockState, type StoredInterviewPayload } from "./payload";
import { pluralCount } from "@/features/experience-candidates/candidate-period";
import { daysUntilDeletion, DELETION_WARNING_DAYS } from "./retention";
import styles from "./saved-interview-screen.module.css";

/**
 * 저장된 인터뷰를 이어가기 전에 보는 화면입니다(이슈 #115). 디자인 파일 `App.tsx`의
 * `SessionReviewScreen`을 옮겼습니다.
 *
 * 근거는 커밋 목록으로만 보입니다. 코드와 diff를 보여 주는 `CodePanel`은 인터뷰 화면의 왼쪽 열이고,
 * 여기서 같은 것을 한 번 더 그리면 이어가기 전에 볼 것과 이어간 뒤에 볼 것이 겹칩니다.
 *
 * 대화로 곧바로 들어가지 않는 이유는 원본 주석에 있습니다. 며칠 전에 하던 대화 한가운데로 떨어지면
 * 무엇을 이야기하던 중이었는지 모른 채 답을 써야 합니다. 그래서 고른 경험이 무엇이었고 어디까지
 * 왔는지를 먼저 보입니다.
 *
 * **블록 편집이 있는 유일한 화면입니다.** 인터뷰 화면에서 옮겨 왔습니다. 그쪽은 끝내는 순간 카드
 * 넷을 편집 가능한 모습으로 다시 그렸는데, 종료가 곧바로 이 화면으로 넘어가는 조작이라 그 모습이 한
 * 프레임 번쩍이고 사라졌습니다. 자리를 옮긴 다른 이유는 진행 중 편집이 성립하지 않는다는 것입니다.
 */
export interface SavedInterviewScreenProps {
  interview: StoredInterviewPayload;
  onResume: () => void;
  /** 다른 곳에서 먼저 저장했을 때 최신 내용을 다시 읽습니다. 없으면 그 안내만 보입니다. */
  onLoadLatest?: () => void;
  /**
   * 이 인터뷰가 나온 분석의 후보 목록을 엽니다(이슈 #116). 없으면 그 버튼을 그리지 않습니다.
   *
   * 한 분석에서 경험을 여러 개 고를 수 있는데, 저장된 인터뷰에서 그 분석으로 돌아가는 길이 없으면
   * 사용자는 같은 저장소를 다시 분석해야 합니다. Stage B가 쓰는 모델은 하루 요청 수가 프로젝트 전체
   * 20회라 그 길이 사실상 막혀 있습니다.
   */
  onOpenAnalysis?: () => void;
  /** 테스트에서 저장 요청을 대체하는 통로입니다. */
  fetchImpl?: typeof fetch;
}

/** 저장된 분석에서 고른 후보입니다. 오래전에 쓴 값이라 지금 기대하는 모양이 아닐 수 있습니다. */
interface StoredCandidate {
  readonly evidence: string | null;
  readonly technicalTopics: readonly string[];
}

export function parseStoredCandidate(value: unknown): StoredCandidate | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { evidence?: unknown; technicalTopics?: unknown };
  const topics = Array.isArray(candidate.technicalTopics)
    ? candidate.technicalTopics.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
    : [];
  return {
    evidence: typeof candidate.evidence === "string" && candidate.evidence.length > 0 ? candidate.evidence : null,
    technicalTopics: topics,
  };
}

/**
 * 블록이 어디까지 왔는지입니다. 평가가 없으면 아직 다루지 않은 블록입니다.
 *
 * 편집은 이 기호를 바꾸지 않습니다. 기호가 말하는 것은 인터뷰가 그 블록을 어디까지 다뤘는지이고,
 * 그것은 사용자가 문장을 고친다고 달라지지 않습니다.
 */
function blockSymbol(blockState: ExperienceBlockState, block: BlockKind): "✓" | "●" | "○" {
  const evaluation = blockState.evaluation[block];
  if (evaluation === null) return "○";
  return evaluation.sufficient ? "✓" : "●";
}

const BLOCK_LABEL: Record<BlockKind, string> = {
  problem: "Problem",
  alternatives: "Analyze",
  action: "Action",
  result: "Result",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

/**
 * 이 화면이 스스로 드는 값입니다. 한 덩어리로 두고 읽어 온 인터뷰가 바뀌면 통째로 버립니다.
 *
 * 읽어 온 값이 바뀌는 경로는 최신 내용 다시 읽기뿐이고, 그때는 방금까지 고치던 것이 서버에 이미 반영된
 * 뒤이거나 다른 곳의 편집으로 대체된 뒤입니다. 어느 쪽이든 들고 있던 편집본과 열린 입력은 버려야
 * 맞습니다. 효과로 비우지 않고 요청 키로 가르는 것은 `use-saved-interview`와 같은 방식입니다.
 */
interface ScreenState {
  readonly key: string;
  /** 저장에 성공한 편집본입니다. 서버가 받아들인 뒤에만 채웁니다. */
  readonly edits: BlockEdits;
  /** 저장된 블록 버전입니다. 저장할 때마다 오르므로 읽어 온 값을 그대로 쓸 수 없습니다. */
  readonly version: number;
  readonly editor: { readonly block: BlockKind; readonly draft: string } | null;
  readonly save: "idle" | "saving" | "conflict" | "failed";
}

function freshState(key: string, version: number): ScreenState {
  return { key, edits: {}, version, editor: null, save: "idle" };
}

/**
 * 자동 삭제까지 남은 기간입니다(이슈 #116, 디자인 원본의 삭제 안내 배너).
 *
 * 목록의 `D-n` 배지와 달리 기한이 멀어도 보입니다. 이 화면은 인터뷰 하나를 들여다보는 자리라 "이
 * 인터뷰가 언제까지 남는가"가 그 인터뷰에 대한 사실의 하나이고, 목록처럼 여러 줄이 경쟁하지 않습니다.
 *
 * 인터뷰를 열면 기준 시각이 갱신되므로 이 화면에 들어온 직후에는 대개 90일이 남아 있습니다. 그래도
 * 적는 이유는 저장이 영구적이지 않다는 사실을 사용자가 알아야 하기 때문입니다.
 */
function DeletionNotice({ openedAt }: { openedAt: string }) {
  const daysLeft = daysUntilDeletion(openedAt);
  const expiringSoon = daysLeft <= DELETION_WARNING_DAYS;
  return (
    <div className={`${styles.deletionNotice} ${expiringSoon ? styles.deletionNoticeWarning : ""}`} role="status">
      <span className={styles.deletionSymbol} aria-hidden="true">⚠</span>
      <p className={styles.deletionText}>
        {expiringSoon
          ? DELETION_NOTICE_COPY.expiringSoon(pluralCount(daysLeft, "day"))
          : DELETION_NOTICE_COPY.remaining(pluralCount(daysLeft, "day"))}
      </p>
    </div>
  );
}

export function SavedInterviewScreen({
  interview,
  onResume,
  onLoadLatest,
  onOpenAnalysis,
  fetchImpl,
}: SavedInterviewScreenProps) {
  const candidate = parseStoredCandidate(interview.candidate);
  /*
   * 저장된 값이라 화면이 읽는 칸을 모두 확인한 뒤에 그립니다(PR #127 리뷰). 예전에는 후보 sha와
   * 대표 커밋이 있는지만 봤는데, 커밋의 `files`나 `pullRequests`가 없으면 `.length`에서 렌더가
   * 멈췄습니다. 안내 한 줄 대신 화면 전체가 깨지는 것이라 질문 경로와 같은 검사를 씁니다.
   */
  const snapshot = isExperienceEvidenceSnapshot(interview.evidence) ? interview.evidence : null;
  const blockState = isRestorableBlockState(interview.blockState) ? interview.blockState : null;
  const date = formatDate(interview.updatedAt);
  const progress = `PAAR ${interview.completedBlockCount}/${BLOCK_KINDS.length}`;

  const key = `${interview.id}:${interview.blockVersion}`;
  const [held, setHeld] = useState<ScreenState>(() => freshState(key, interview.blockVersion));
  const state = held.key === key ? held : freshState(key, interview.blockVersion);
  const editorId = useId();

  /*
   * 편집은 끝난 인터뷰에만 엽니다. 진행 중인 인터뷰를 고쳐 두면 이어간 뒤 모델이 그 블록을 건드리는
   * 순간 `applyBlockUpdate`가 표시 문장을 통째로 갈아 끼워 고친 문장이 사라집니다. 서버도 같은
   * 판정을 하므로 이 조건은 요청을 아끼는 쪽이고, 거절할 권한은 서버에 있습니다.
   */
  const canEdit = interview.status === "completed";
  const emptyText = canEdit
    ? SAVED_INTERVIEW_SCREEN_COPY.blockEmptyEnded
    : SAVED_INTERVIEW_SCREEN_COPY.blockEmptyPending;

  const draft = state.editor?.draft ?? null;
  const parsed = draft === null ? null : parseBlockEdit(draft);
  const rejection = parsed === null ? null : validateBlockEdit(parsed);
  const remainingBytes = parsed === null ? 0 : BLOCK_MAX_BYTES - blockEditByteLength(parsed);

  function openEditor(block: BlockKind) {
    if (blockState === null) return;
    setHeld({
      ...state,
      editor: { block, draft: formatBlockEdit(effectiveDisplay(blockState, state.edits, block)) },
      save: "idle",
    });
  }

  async function saveEditor() {
    const editor = state.editor;
    if (editor === null || parsed === null || rejection !== null) return;
    setHeld({ ...state, save: "saving" });
    try {
      const version = await saveSavedInterviewBlock(
        interview.id,
        {
          block: editor.block,
          sentences: parsed.map((sentence) => sentence.text),
          expectedBlockVersion: state.version,
        },
        fetchImpl
      );
      setHeld({
        key,
        edits: { ...state.edits, [editor.block]: parsed },
        version,
        editor: null,
        save: "idle",
      });
    } catch (error) {
      // 편집본을 화면에 반영하지 않고 입력을 열어 둡니다. 저장되지 않은 문장을 저장된 것처럼 그리면
      // 사용자가 고쳤다고 믿고 떠납니다.
      const conflict = error instanceof SavedInterviewFetchError && error.kind === "version_conflict";
      setHeld({ ...state, save: conflict ? "conflict" : "failed" });
    }
  }

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Experience</p>
        <h1 className={styles.title}>{interview.title}</h1>
        <div className={styles.meta}>
          <span>{interview.repoOwner} / {interview.repoName}</span>
          <span className={styles.dot}>·</span>
          <span>{date}</span>
        </div>
      </header>

      <DeletionNotice openedAt={interview.openedAt} />

      <div className={styles.body}>
        <div className={styles.column}>
          <section className={styles.section} aria-labelledby="saved-why-heading">
            <p id="saved-why-heading" className={styles.sectionEyebrow}>Why worth discussing</p>
            {candidate?.evidence ? (
              <>
                <p className={styles.text}>{candidate.evidence}</p>
                <p className={styles.notice}>{EVIDENCE_VERIFIABILITY_NOTICE}</p>
              </>
            ) : (
              <p className={styles.notice}>{SAVED_INTERVIEW_SCREEN_COPY.noCandidateAnalysis}</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="saved-topics-heading">
            <p id="saved-topics-heading" className={styles.sectionEyebrow}>Technical topics</p>
            {candidate && candidate.technicalTopics.length > 0 ? (
              <>
                <ul className={styles.topics}>
                  {candidate.technicalTopics.map((topic) => <li key={topic}>{topic}</li>)}
                </ul>
                <p className={styles.notice}>{EVIDENCE_VERIFIABILITY_NOTICE}</p>
              </>
            ) : (
              <p className={styles.notice}>{SAVED_INTERVIEW_SCREEN_COPY.noTopics}</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="saved-evidence-heading">
            <p id="saved-evidence-heading" className={styles.sectionEyebrow}>Repository evidence</p>
            <p className={styles.notice}>{REPOSITORY_VERIFIED_NOTICE}</p>
            {snapshot ? (
              <ul className={styles.commits}>
                {[snapshot.representativeCommit, ...snapshot.relatedCommits].map((commit) => (
                  <li key={commit.sha} className={styles.commit}>
                    <span className={styles.commitBadge}>
                      {commit.pullRequests.length > 0 ? `PR #${commit.pullRequests[0].number}` : commit.sha.slice(0, 7)}
                    </span>
                    <span className={styles.commitMain}>
                      <span className={styles.commitTitle}>
                        {commit.title ?? SAVED_INTERVIEW_SCREEN_COPY.commitNotIndexed}
                      </span>
                      <span className={styles.commitMeta}>
                        {commit.files.length === 1 ? "1 file" : `${commit.files.length} files`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.notice}>{SAVED_INTERVIEW_SCREEN_COPY.evidenceUnreadable}</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="saved-paar-heading">
            <div className={styles.sectionHeader}>
              <p id="saved-paar-heading" className={styles.sectionEyebrow}>{SAVED_INTERVIEW_SCREEN_COPY.paarHeading}</p>
              <span className={styles.progress}>{progress}</span>
            </div>
            {blockState === null ? (
              <p className={styles.notice}>{SAVED_INTERVIEW_SCREEN_COPY.blocksUnreadable}</p>
            ) : (
            <ul className={styles.blocks}>
              {BLOCK_KINDS.map((block) => {
                const isEditing = state.editor?.block === block;
                return (
                  <li key={block} className={styles.block}>
                    <div className={styles.blockHeader}>
                      <span className={styles.blockSymbol} aria-hidden="true">
                        {blockSymbol(blockState, block)}
                      </span>
                      <span className={styles.blockLabel}>{BLOCK_LABEL[block]}</span>
                      {/*
                        블록이 넷이라 "편집"만으로는 어느 블록을 고치는 버튼인지 이름으로 갈리지
                        않습니다. 보이는 글자는 짧게 두고 이름에만 블록을 붙입니다.
                      */}
                      {canEdit && !isEditing ? (
                        <button
                          type="button"
                          className={styles.editButton}
                          aria-label={SAVED_INTERVIEW_SCREEN_COPY.editLabel(BLOCK_LABEL[block])}
                          onClick={() => openEditor(block)}
                        >
                          {SAVED_INTERVIEW_SCREEN_COPY.edit}
                        </button>
                      ) : null}
                    </div>

                    <BlockSentences
                      marks={blockMarks(blockState, state.edits, block)}
                      conflicts={effectiveConflicts(blockState, state.edits, block)}
                      emptyText={emptyText}
                    />

                    {isEditing && draft !== null ? (
                      <div className={styles.editor}>
                        <label className={styles.editorLabel} htmlFor={editorId}>
                          {SAVED_INTERVIEW_SCREEN_COPY.editorLabel(BLOCK_LABEL[block])}
                        </label>
                        <textarea
                          id={editorId}
                          className={styles.editorInput}
                          value={draft}
                          rows={4}
                          onChange={(event) =>
                            setHeld({ ...state, editor: { block, draft: event.target.value } })
                          }
                          aria-describedby={`${editorId}-note`}
                          aria-invalid={rejection !== null || undefined}
                        />
                        {/*
                          편집하면 저장소 인용을 잃는다는 사실을 고치기 전에 알립니다. 되돌릴 수 없고
                          오타 하나를 고쳐도 같으므로, 바뀐 뒤에 배지로 알리는 것은 늦습니다.
                        */}
                        <p id={`${editorId}-note`} className={styles.editorNote}>
                          {SAVED_INTERVIEW_SCREEN_COPY.editorNote(remainingBytes.toLocaleString())}
                        </p>
                        {rejection === "too_many_statements" ? (
                          <p className={styles.editorError}>
                            {SAVED_INTERVIEW_SCREEN_COPY.tooManyStatements(BLOCK_MAX_STATEMENTS)}
                          </p>
                        ) : null}
                        {rejection === "block_too_large" ? (
                          <p className={styles.editorError}>
                            {SAVED_INTERVIEW_SCREEN_COPY.blockTooLarge(BLOCK_MAX_BYTES.toLocaleString())}
                          </p>
                        ) : null}
                        {state.save === "failed" ? (
                          <p className={styles.editorError}>
                            {SAVED_INTERVIEW_SCREEN_COPY.saveFailed}
                          </p>
                        ) : null}
                        {state.save === "conflict" ? (
                          <div className={styles.editorConflict}>
                            <p className={styles.editorConflictText}>
                              {SAVED_INTERVIEW_SCREEN_COPY.saveConflict}
                            </p>
                            {onLoadLatest ? (
                              <button type="button" className={styles.editorCancel} onClick={onLoadLatest}>
                                {SAVED_INTERVIEW_SCREEN_COPY.loadLatest}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        <div className={styles.editorActions}>
                          <button
                            type="button"
                            className={styles.editorSave}
                            disabled={rejection !== null || state.save === "saving"}
                            onClick={() => void saveEditor()}
                          >
                            {state.save === "saving" ? SAVED_INTERVIEW_SCREEN_COPY.saving : SAVED_INTERVIEW_SCREEN_COPY.save}
                          </button>
                          <button
                            type="button"
                            className={styles.editorCancel}
                            onClick={() => setHeld({ ...state, editor: null, save: "idle" })}
                          >
                            {SAVED_INTERVIEW_SCREEN_COPY.cancel}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            )}
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerMeta}>{progress} · {date}</span>
        {onOpenAnalysis ? (
          <button type="button" className={styles.openAnalysis} onClick={onOpenAnalysis}>
            {SAVED_INTERVIEW_SCREEN_COPY.openAnalysis}
          </button>
        ) : null}
        <button type="button" className={styles.resume} onClick={onResume}>
          {interview.status === "completed" ? SAVED_INTERVIEW_SCREEN_COPY.review : SAVED_INTERVIEW_SCREEN_COPY.resume}
          <span className={styles.arrow} aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}

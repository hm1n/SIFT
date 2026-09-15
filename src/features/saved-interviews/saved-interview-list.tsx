"use client";

import { useState } from "react";
import { BLOCK_KINDS } from "@/features/experience-block/types";
import type { InterviewListItemPayload } from "./payload";
import { pluralCount } from "@/features/experience-candidates/candidate-period";
import { daysUntilDeletion, DELETION_WARNING_DAYS } from "./retention";
import styles from "./saved-interview-list.module.css";

/**
 * 사이드바의 저장된 인터뷰 목록입니다(이슈 #115). 디자인 파일 `App.tsx`의 `AppShell` 안 INTERVIEWS
 * 영역을 옮겼습니다.
 *
 * 목록은 Repository와 무관합니다. 어떤 Repository를 고르기 전에도 보이고 다른 Repository의 인터뷰도
 * 함께 나오므로, 행마다 저장소 이름을 함께 적습니다.
 *
 * Loading·Empty·Error를 모두 그립니다(`AGENTS.md`). 조회에 실패해도 화면의 다른 부분을 막지 않습니다.
 * 목록은 이어가기를 위한 통로이지 지금 하는 일의 전제가 아닙니다.
 */
export type SavedInterviewListState =
  | { readonly status: "loading" }
  | { readonly status: "error" }
  | { readonly status: "ready"; readonly interviews: readonly InterviewListItemPayload[] };

export interface SavedInterviewListProps {
  state: SavedInterviewListState;
  /** 지금 열려 있는 인터뷰입니다. 그 행을 눌린 상태로 그립니다. */
  activeInterviewId?: string | null;
  onSelect: (interviewId: string) => void;
  onDelete: (interviewId: string) => void;
  onRetry: () => void;
}

/**
 * 기한이 지난 인터뷰는 이미 지워진 것으로 보고 그리지 않습니다(이슈 #116, 디자인 원본의
 * `visibleSessions`).
 *
 * 정리 작업은 하루에 한 번 돌고 Vercel Hobby는 지정한 시각부터 한 시간 안의 아무 때나 부르므로, 기한이
 * 지난 줄이 잠시 남아 있습니다. 그것을 목록에 보이면 사용자가 눌러 열 수 있고, 여는 순간 `opened_at`이
 * 갱신돼 다시 90일을 사는 인터뷰가 됩니다. 지워진다고 알린 것이 지워지지 않는 쪽이 더 나쁩니다.
 */
function notExpired(interviews: readonly InterviewListItemPayload[]): readonly InterviewListItemPayload[] {
  return interviews.filter((interview) => daysUntilDeletion(interview.openedAt) > 0);
}

/** 디자인의 `Nov 28`입니다. 저장된 값은 ISO 문자열이라 여기서 사람이 읽는 형식으로 바꿉니다. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * 자동 삭제가 가까운 인터뷰에만 붙는 `D-n` 배지입니다(이슈 #116, 디자인 원본).
 *
 * 모든 행에 남은 날수를 적지 않습니다. 90일 가운데 80일이 남은 인터뷰에 남은 날수를 적으면 목록이
 * 지워질 것들의 목록처럼 보입니다. 사용자가 실제로 할 일이 생기는 것은 기한이 가까울 때입니다.
 */
function DeletionBadge({ openedAt }: { openedAt: string }) {
  const daysLeft = daysUntilDeletion(openedAt);
  if (daysLeft > DELETION_WARNING_DAYS) return null;
  return (
    <span className={styles.deletionBadge} title={`Automatically deleted in ${pluralCount(daysLeft, "day")}`}>
      D-{daysLeft}
    </span>
  );
}

export function SavedInterviewList({
  state,
  activeInterviewId = null,
  onSelect,
  onDelete,
  onRetry,
}: SavedInterviewListProps) {
  /**
   * 삭제를 확인하는 중인 행입니다. 대화상자를 띄우지 않고 그 행 자리에서 묻습니다(디자인 원본).
   * 목록이 좁아 대화상자로 물으면 어느 인터뷰를 지우는지가 화면에서 멀어집니다.
   */
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const interviews = state.status === "ready" ? notExpired(state.interviews) : [];

  return (
    <>
      <div className={styles.header}>
        <span className={styles.label}>Interviews</span>
        {state.status === "ready" ? <span className={styles.count}>{interviews.length}</span> : null}
      </div>

      {state.status === "loading" ? <p className={styles.notice}>Loading interviews...</p> : null}

      {state.status === "error" ? (
        <div className={styles.errorBox}>
          <p className={styles.notice}>Couldn&apos;t load interviews.</p>
          <button type="button" className={styles.retry} onClick={onRetry}>Try again</button>
        </div>
      ) : null}

      {state.status === "ready" && interviews.length === 0 ? (
        <p className={styles.notice}>No interviews yet. Select an experience candidate to begin.</p>
      ) : null}

      {state.status === "ready" && interviews.length > 0 ? (
        <ul className={styles.list}>
          {interviews.map((interview) => (
            <li key={interview.id}>
              {confirmingId === interview.id ? (
                <div className={styles.confirm}>
                  <p className={styles.confirmText}>Delete this interview? This cannot be undone.</p>
                  <div className={styles.confirmActions}>
                    <button type="button" className={styles.cancel} onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      className={styles.delete}
                      autoFocus
                      onClick={() => {
                        setConfirmingId(null);
                        onDelete(interview.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className={`${styles.row} ${activeInterviewId === interview.id ? styles.rowActive : ""}`}>
                  <button
                    type="button"
                    className={styles.open}
                    aria-current={activeInterviewId === interview.id ? "true" : undefined}
                    onClick={() => onSelect(interview.id)}
                  >
                    <span className={styles.status} aria-hidden="true">
                      {interview.status === "completed" ? "✓" : "●"}
                    </span>
                    <span className={styles.rowMain}>
                      <span className={styles.title}>{interview.title}</span>
                      <span className={styles.repository}>{interview.repoOwner} / {interview.repoName}</span>
                      <span className={styles.meta}>
                        {/* 분모는 블록 수에서 옵니다. 여기 적어 두면 블록이 바뀔 때 한쪽만 남습니다. */}
                        PAAR {interview.completedBlockCount}/{BLOCK_KINDS.length}
                        <span className={styles.dot}> · </span>
                        {formatDate(interview.updatedAt)}
                        <DeletionBadge openedAt={interview.openedAt} />
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.deleteIcon}
                    aria-label={`Delete interview: ${interview.title}`}
                    onClick={() => setConfirmingId(interview.id)}
                  >
                    ✕
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

"use client";

import { useState } from "react";
import { SAVED_INTERVIEW_LIST_COPY } from "@/copy/saved";
import { BLOCK_KINDS } from "@/features/experience-block/types";
import type { InterviewListItemPayload } from "./payload";
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

/** 디자인의 `Nov 28`입니다. 저장된 값은 ISO 문자열이라 여기서 사람이 읽는 형식으로 바꿉니다. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
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

  return (
    <>
      <div className={styles.header}>
        <span className={styles.label}>Interviews</span>
        {state.status === "ready" ? <span className={styles.count}>{state.interviews.length}</span> : null}
      </div>

      {state.status === "loading" ? <p className={styles.notice}>{SAVED_INTERVIEW_LIST_COPY.loading}</p> : null}

      {state.status === "error" ? (
        <div className={styles.errorBox}>
          <p className={styles.notice}>{SAVED_INTERVIEW_LIST_COPY.error}</p>
          <button type="button" className={styles.retry} onClick={onRetry}>{SAVED_INTERVIEW_LIST_COPY.retry}</button>
        </div>
      ) : null}

      {state.status === "ready" && state.interviews.length === 0 ? (
        <p className={styles.notice}>{SAVED_INTERVIEW_LIST_COPY.empty}</p>
      ) : null}

      {state.status === "ready" && state.interviews.length > 0 ? (
        <ul className={styles.list}>
          {state.interviews.map((interview) => (
            <li key={interview.id}>
              {confirmingId === interview.id ? (
                <div className={styles.confirm}>
                  <p className={styles.confirmText}>{SAVED_INTERVIEW_LIST_COPY.deleteConfirm}</p>
                  <div className={styles.confirmActions}>
                    <button type="button" className={styles.cancel} onClick={() => setConfirmingId(null)}>
                      {SAVED_INTERVIEW_LIST_COPY.cancel}
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
                      {SAVED_INTERVIEW_LIST_COPY.delete}
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
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={styles.deleteIcon}
                    aria-label={SAVED_INTERVIEW_LIST_COPY.deleteLabel(interview.title)}
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

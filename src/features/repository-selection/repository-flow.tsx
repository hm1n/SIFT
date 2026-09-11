"use client";

import { useId, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/shell/button";
import { RepositoryAnalysisView } from "@/features/repository-analysis/repository-analysis-view";
import type { RepositorySummary } from "@/lib/github/types";
import { RepositorySelectScreen } from "./repository-select-screen";
import styles from "./repository-flow.module.css";

interface Selection {
  summary: RepositorySummary;
  contributionItems: readonly string[];
}

/**
 * 로그인 뒤 화면 전환입니다. 선택이 없으면 Repository 선택 화면, 선택하면 그 Repository의 분석 화면을 그립니다.
 * `Change repository`류의 되돌아가기는 선택을 비워 목록을 다시 조회합니다. 분석 화면은 #96부터 `AppShell`로
 * 감싸고, 선택 화면이 조회한 `summary`의 visibility·language를 그대로 `AppShell`과 분석 화면 헤더에 전달합니다.
 *
 * `AppShell` 사이드바의 Change repository는 `RepositoryAnalysisView`가 그리는 화면 밖에 있어, 인터뷰가
 * 진행 중이어도 그대로 선택을 비워 `InterviewScreen`의 이탈 확인을 건너뛰고 대화를 잃습니다(PR #105 Codex
 * 리뷰 P1). `onInterviewActiveChange`로 인터뷰 활성 여부를 받아, 활성 중에는 사이드바든 분석 화면 안의
 * 되돌아가기든 같은 확인을 한 번 더 거치게 합니다.
 */
export function RepositoryFlow() {
  const [selection, setSelection] = useState<Selection | null>(null);
  const [interviewActive, setInterviewActive] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const leaveConfirmTitleId = useId();
  const leaveConfirmDescId = useId();

  if (selection === null) {
    return (
      <RepositorySelectScreen
        onAnalyze={(summary, contributionItems) => setSelection({ summary, contributionItems })}
      />
    );
  }

  const { summary, contributionItems } = selection;

  function leaveToSelection() {
    setConfirmingLeave(false);
    setInterviewActive(false);
    setSelection(null);
  }

  /** 인터뷰가 활성 상태면 바로 나가지 않고 확인을 먼저 받습니다. */
  function requestLeave() {
    if (interviewActive) {
      setConfirmingLeave(true);
    } else {
      leaveToSelection();
    }
  }

  return (
    <>
      <AppShell
        repository={{ owner: summary.owner, name: summary.name, visibility: summary.visibility, language: summary.language }}
        onChangeRepository={requestLeave}
      >
        <RepositoryAnalysisView
          repository={summary}
          contributionItems={contributionItems}
          onSelectRepository={requestLeave}
          onInterviewActiveChange={setInterviewActive}
        />
      </AppShell>
      {confirmingLeave ? (
        <div className={styles.leaveConfirmBackdrop}>
          <div
            className={styles.leaveConfirm}
            role="alertdialog"
            aria-labelledby={leaveConfirmTitleId}
            aria-describedby={leaveConfirmDescId}
          >
            <p id={leaveConfirmTitleId} className={styles.leaveConfirmTitle}>Repository를 바꾸시겠습니까?</p>
            <p id={leaveConfirmDescId} className={styles.leaveConfirmText}>
              지금까지의 인터뷰 대화가 사라지고 다시 이어갈 수 없습니다. 작성 중인 답변도 사라집니다.
            </p>
            <div className={styles.leaveConfirmActions}>
              <Button variant="primary" onClick={leaveToSelection} autoFocus>Repository 바꾸기</Button>
              <Button variant="secondary" onClick={() => setConfirmingLeave(false)}>인터뷰 계속하기</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

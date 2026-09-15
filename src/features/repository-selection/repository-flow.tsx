"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { Button } from "@/components/shell/button";
import { StatusScreen } from "@/components/shell/status-screen";
import { clearAnalysisFlow, startAnalysisFlow, trackEvent } from "@/features/analytics/events";
import { InterviewScreen } from "@/features/interview/interview-screen";
import { RepositoryAnalysisView } from "@/features/repository-analysis/repository-analysis-view";
import { SavedInterviewList } from "@/features/saved-interviews/saved-interview-list";
import { SavedInterviewScreen } from "@/features/saved-interviews/saved-interview-screen";
import { useSavedInterview } from "@/features/saved-interviews/use-saved-interview";
import { useSavedInterviews } from "@/features/saved-interviews/use-saved-interviews";
import { isRestorableBlockState, type StoredInterviewPayload } from "@/features/saved-interviews/payload";
import { isExperienceEvidenceSnapshot } from "@/features/interview/question-request";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { RepositorySummary } from "@/lib/github/types";
import type { AnalyzedRepository } from "@/features/repository-analysis/repository-analysis-view";
import { RepositorySelectScreen } from "./repository-select-screen";
import styles from "./repository-flow.module.css";

/**
 * 로그인 뒤 화면 전환입니다. 세 갈래가 있습니다. Repository를 고르는 화면, 고른 Repository의 분석
 * 화면, 그리고 저장된 인터뷰를 이어가는 화면입니다(이슈 #115).
 *
 * 세 갈래 모두 `AppShell`로 감쌉니다. 사이드바의 저장된 인터뷰 목록은 Repository를 고르기 전에도
 * 보여야 합니다. 로그인해서 들어온 사용자가 가장 먼저 할 일이 하다 만 인터뷰를 잇는 것일 수 있는데,
 * Repository를 먼저 고르게 하면 이어가기가 분석을 한 번 더 돌린 뒤에야 닿는 곳이 됩니다.
 *
 * 이어가기는 저장된 인터뷰를 읽어 먼저 보여 주고(`SavedInterviewScreen`), 사용자가 이어가기를 누를
 * 때 대화를 엽니다. 며칠 전에 하던 대화 한가운데로 곧바로 떨어지면 무엇을 이야기하던 중이었는지 모른
 * 채 답을 써야 합니다.
 */
type Mode =
  | { readonly kind: "select" }
  | {
      readonly kind: "analysis";
      readonly summary: AnalyzedRepository;
      readonly contributionItems: readonly string[];
      /**
       * 저장된 인터뷰에서 그 분석의 후보 목록으로 들어올 때 옵니다(이슈 #116). 이 값이 있으면 분석
       * 화면은 저장소 이름으로 찾지 않고 이 분석을 엽니다.
       */
      readonly analysisId?: string;
    }
  | { readonly kind: "resume"; readonly interviewId: string; readonly stage: "review" | "interview" };

/** 저장된 인터뷰를 읽지 못한 이유별 안내입니다. 없어진 인터뷰와 연결 실패는 사용자가 할 일이 다릅니다. */
const RESUME_ERROR: Record<string, { code: string; label: string; sub: string }> = {
  not_found: {
    code: "ERROR / NOT FOUND",
    label: "This interview is no longer available.",
    sub: "It may have been deleted. Pick another one from Interviews.",
  },
  unauthorized: {
    code: "ERROR / AUTH",
    label: "Your session has expired.",
    sub: "Log in again to continue this interview.",
  },
};

const RESUME_ERROR_FALLBACK = {
  code: "ERROR / STORAGE",
  label: "Couldn't open this interview.",
  sub: "The server didn't answer. Try again in a moment.",
};

export function RepositoryFlow() {
  const interviews = useSavedInterviews();
  const [mode, setMode] = useState<Mode>({ kind: "select" });
  /** 이어가기를 다시 읽을 때마다 오릅니다. 다시 시도와 "최신 내용 불러오기"가 같은 통로를 씁니다. */
  const [resumeAttempt, setResumeAttempt] = useState(0);
  /**
   * 인터뷰가 열려 있는지와, 저장되지 않은 턴이 남아 있는지입니다. 둘 다 이탈 확인을 걸지 판단하는 데만
   * 쓰고 화면을 그리는 데는 쓰지 않으므로 상태가 아니라 ref로 둡니다.
   *
   * 상태로 두면 이탈을 누르는 시점에 값이 한 박자 늦을 수 있습니다. 저장 실패는 응답이 돌아오는
   * 시점에 알려지는데, 그 알림이 다시 그리기 전에 사용자가 사이드바를 누르면 이탈 처리가 직전 렌더의
   * 값을 보고 판단합니다. 확인을 걸어야 할 때 그냥 나가 버리는 쪽으로 어긋납니다.
   *
   * 저장이 붙기 전에는 화면을 떠나는 것이 곧 대화를 잃는 것이라 언제나 확인했습니다. 이제 저장된
   * 대화는 사이드바에서 다시 이어갈 수 있으므로, 잃을 것이 있는 경우에만 묻습니다.
   */
  const interviewActiveRef = useRef(false);
  const hasUnsavedRef = useRef(false);
  const setActive = useCallback((active: boolean) => {
    interviewActiveRef.current = active;
  }, []);
  const setUnsaved = useCallback((value: boolean) => {
    hasUnsavedRef.current = value;
  }, []);
  /** 확인을 받은 뒤에 할 이동입니다. 확인 중이 아니면 `null`입니다. */
  const [pendingNavigation, setPendingNavigation] = useState<{ run: () => void } | null>(null);
  const leaveConfirmTitleId = useId();
  const leaveConfirmDescId = useId();

  const resumeState = useSavedInterview(mode.kind === "resume" ? mode.interviewId : null, resumeAttempt);

  /**
   * 화면을 옮깁니다. 저장되지 않은 턴이 남아 있으면 먼저 확인을 받습니다.
   *
   * 모든 이동이 이 함수를 지납니다. 사이드바의 목록과 새 경험 찾기는 인터뷰 화면 밖에 있어서, 각
   * 화면이 스스로 확인을 걸면 이 두 경로가 그대로 빠져나갑니다(PR #105 Codex 리뷰 P1과 같은 자리).
   */
  function navigate(
    next: Mode,
    options: { readonly confirm?: boolean; readonly onRun?: () => void } = {}
  ) {
    const wasInterviewOpen = interviewActiveRef.current;
    const run = () => {
      interviewActiveRef.current = false;
      hasUnsavedRef.current = false;
      // 이동이 확정된 뒤에만 실행합니다. 다시 읽기처럼 이동에 딸린 조작을 호출부에서 먼저 하면,
      // 사용자가 확인 대화에서 "인터뷰 계속하기"를 눌러도 이미 벌어진 일이 됩니다(PR #127 리뷰).
      options.onRun?.();
      setMode(next);
      /**
       * 분석 화면을 떠나면 그 분석의 묶음이 끝납니다. 비우지 않으면 다음 분석을 시작하기 전에
       * 일어나는 이벤트(`repo_list_loaded`)가 지난 분석의 `flow_id`를 달고 나갑니다.
       *
       * 이동이 전부 이 함수를 지나므로 여기 한 곳에서만 비웁니다. 되돌아가기마다 비우면 이어가기로
       * 빠지는 경로가 그대로 빠져나갑니다. 세운 적이 없을 때 지우기를 걸러내는 일은
       * `clearAnalysisFlow`가 자기 안에서 합니다.
       */
      if (next.kind !== "analysis") clearAnalysisFlow();
      // 인터뷰를 떠날 때마다 목록을 다시 읽습니다. 진행도와 끝난 표시가 그 사이에 바뀝니다.
      if (wasInterviewOpen) interviews.reload();
    };
    if (options.confirm !== false && wasInterviewOpen && hasUnsavedRef.current) {
      setPendingNavigation({ run });
      return;
    }
    run();
  }

  /**
   * 분석 한 번을 묶는 `flow_id`를 여기서 발급합니다. 저장소를 고른 순간이 아니라 분석을 시작하는
   * 순간입니다. `flow_id`의 정의가 "분석 한 번"이고, 화면 순서가 바뀌어도 분석 시작이라는 액션은
   * 남기 때문입니다. `repo_visibility`와 `repo_language`도 같은 시점부터 공통 파라미터로 붙습니다.
   *
   * 재시도는 같은 `flow_id`를 그대로 씁니다. 실패한 분석과 그 재시도는 한 번의 분석 시도이고,
   * 분석 화면을 떠나면 `navigate`가 비워 다음 분석에 새 값이 발급됩니다.
   *
   * `flow_id` 자체는 여기서 만들지 않습니다. 계측이 쓰는 값을 화면이 만들면 그 생성이 실패할 때
   * 예외가 계측 밖으로 나와 분석 시작을 막습니다.
   *
   * 저장된 인터뷰를 잇는 경로(`openInterview`)는 이 자리를 지나지 않아 분석 이벤트가 하나도 남지
   * 않습니다. 진입 경로를 가르는 파라미터는 아직 없습니다
   * (`llm-wiki/wiki/2026-09-15-GA4-계측-후속-backlog.md` 3번).
   */
  function startAnalysis(summary: RepositorySummary, contributionItems: readonly string[]) {
    startAnalysisFlow({ repoVisibility: summary.visibility, repoLanguage: summary.language });
    trackEvent({ name: "analysis_requested", contribution_item_count: contributionItems.length });
    navigate({ kind: "analysis", summary, contributionItems });
  }

  function openInterview(interviewId: string) {
    navigate({ kind: "resume", interviewId, stage: "review" });
  }

  /**
   * 인터뷰를 끝냈을 때입니다. 그 인터뷰의 요약 화면으로 옮기고 저장된 값을 다시 읽습니다.
   *
   * 끝낸 직후의 요약은 방금 끝낸 내용을 담아야 하므로 서버에서 다시 읽습니다. 화면이 들고 있던 값은
   * 이어가기로 들어올 때 읽은 것이라 이번 대화에서 채운 블록이 빠져 있습니다.
   */
  function showEndedInterview(interviewId: string) {
    // 이탈을 한 번 더 묻지 않습니다. 끝내기는 사용자가 이미 그만하겠다고 말한 조작이고, 그 시점에
    // 훅이 밀린 턴의 저장을 한 번 더 시도합니다. 여기서 확인을 또 띄우면 "인터뷰 계속하기"가 이미
    // 끝난 인터뷰를 가리키게 됩니다.
    navigate(
      { kind: "resume", interviewId, stage: "review" },
      { confirm: false, onRun: () => setResumeAttempt((count) => count + 1) }
    );
  }

  /**
   * 다른 탭이 먼저 저장했을 때입니다. 저장된 값을 다시 읽어 그 상태로 화면을 다시 세웁니다.
   *
   * 다시 읽기를 이동보다 먼저 걸지 않습니다. `resumeAttempt`가 오르면 `useSavedInterview`의 키가
   * 바뀌어 읽는 중이 되고 인터뷰 화면이 내려갑니다. 사용자가 확인 대화에서 이동을 취소해도 쓰던
   * 답변은 이미 사라진 뒤입니다(PR #127 리뷰).
   */
  function loadLatest(interviewId: string) {
    navigate(
      { kind: "resume", interviewId, stage: "review" },
      { onRun: () => setResumeAttempt((count) => count + 1) }
    );
  }

  /**
   * 이어가기 화면에서 그 인터뷰가 나온 분석의 후보 목록으로 갑니다(이슈 #116).
   *
   * 저장소 이름이 아니라 인터뷰가 가리키는 분석 식별자로 엽니다. 이름으로 찾으면 그 사이에 같은
   * 저장소를 다시 분석한 결과가 있을 때 사용자가 보던 것과 다른 후보 목록이 열립니다.
   */
  function openAnalysis() {
    if (resumeState.status !== "ready") return;
    const { interview } = resumeState;
    navigate({
      kind: "analysis",
      summary: { owner: interview.repoOwner, name: interview.repoName },
      // 저장된 분석을 여는 길이라 이번에 적을 기여 항목이 없습니다. 기여 항목은 분석을 새로 돌릴 때만 쓰입니다.
      contributionItems: [],
      analysisId: interview.analysisId,
    });
  }

  const sidebarInterviews = (
    <SavedInterviewList
      state={interviews.state}
      activeInterviewId={mode.kind === "resume" ? mode.interviewId : null}
      onSelect={openInterview}
      onDelete={interviews.remove}
      onRetry={interviews.reload}
    />
  );

  return (
    <>
      <AppShell
        repository={shellRepository(mode, resumeState.status === "ready" ? resumeState.interview : null)}
        onChangeRepository={mode.kind === "analysis" ? () => navigate({ kind: "select" }) : undefined}
        onFindNewExperience={mode.kind === "select" ? undefined : () => navigate({ kind: "select" })}
        interviews={sidebarInterviews}
      >
        {mode.kind === "select" ? (
          <RepositorySelectScreen
            onAnalyze={startAnalysis}
          />
        ) : null}

        {mode.kind === "analysis" ? (
          <RepositoryAnalysisView
            /**
             * 분석 화면을 분석마다 새로 만듭니다. 저장된 분석을 열어 둔 채 다른 분석으로 옮기면 화면이
             * 들고 있는 분석 식별자와 후보가 앞 분석의 것으로 남습니다. 그 상태로 경험을 확정하면 엉뚱한
             * 분석에 인터뷰가 붙습니다.
             */
            key={mode.analysisId ?? `${mode.summary.owner}/${mode.summary.name}`}
            repository={mode.summary}
            analysisId={mode.analysisId}
            contributionItems={mode.contributionItems}
            onSelectRepository={() => navigate({ kind: "select" })}
            onInterviewActiveChange={setActive}
            onInterviewCreated={interviews.reload}
            onLoadLatestInterview={loadLatest}
            onUnsavedInterviewChange={setUnsaved}
            onInterviewEnded={showEndedInterview}
          />
        ) : null}

        {mode.kind === "resume" ? (
          <ResumedInterview
            mode={mode}
            state={resumeState}
            onRetry={() => setResumeAttempt((count) => count + 1)}
            onResume={() => setMode({ ...mode, stage: "interview" })}
            onOpenAnalysis={openAnalysis}
            onBackToReview={() => setMode({ ...mode, stage: "review" })}
            onInterviewActiveChange={setActive}
            onUnsavedChange={setUnsaved}
            onLoadLatest={() => loadLatest(mode.interviewId)}
            onEnded={() => showEndedInterview(mode.interviewId)}
          />
        ) : null}
      </AppShell>

      {pendingNavigation ? (
        <div className={styles.leaveConfirmBackdrop}>
          <div
            className={styles.leaveConfirm}
            role="alertdialog"
            aria-labelledby={leaveConfirmTitleId}
            aria-describedby={leaveConfirmDescId}
          >
            <p id={leaveConfirmTitleId} className={styles.leaveConfirmTitle}>You have an unsaved answer.</p>
            <p id={leaveConfirmDescId} className={styles.leaveConfirmText}>
              Leaving now drops the answer that hasn&apos;t been saved yet. Everything already saved stays in
              Interviews on the left, and you can pick it up from there.
            </p>
            <div className={styles.leaveConfirmActions}>
              <Button
                variant="primary"
                autoFocus
                onClick={() => {
                  const { run } = pendingNavigation;
                  setPendingNavigation(null);
                  run();
                }}
              >
                Leave
              </Button>
              <Button variant="secondary" onClick={() => setPendingNavigation(null)}>Continue the interview</Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * 사이드바에 그릴 Repository입니다. 이어가기한 인터뷰에는 저장소 이름만 있습니다.
 *
 * 공개 여부와 언어는 저장하지 않습니다. 그 값은 GitHub 목록 조회에서 오는 것이고, 이어가기는 목록을
 * 조회하지 않고도 성립해야 합니다. 없는 값을 저장 계층에 만들어 두는 대신 이름만 보입니다.
 */
function shellRepository(mode: Mode, interview: StoredInterviewPayload | null) {
  if (mode.kind === "analysis") {
    return {
      owner: mode.summary.owner,
      name: mode.summary.name,
      visibility: mode.summary.visibility,
      language: mode.summary.language,
    };
  }
  if (mode.kind === "resume" && interview !== null) {
    return { owner: interview.repoOwner, name: interview.repoName };
  }
  return null;
}

/**
 * 이어가기 화면입니다. 읽는 동안과 읽지 못했을 때를 함께 그립니다(`AGENTS.md`의 Loading·Error).
 *
 * 저장된 근거가 스냅샷 모양이 아니면 인터뷰를 열지 않습니다. 근거 없이 연 인터뷰는 질문을 만들 수
 * 없고, 화면은 "질문을 준비하고 있습니다"에서 멈춘 것처럼 보입니다.
 */
function ResumedInterview({
  mode,
  state,
  onRetry,
  onResume,
  onOpenAnalysis,
  onBackToReview,
  onInterviewActiveChange,
  onUnsavedChange,
  onLoadLatest,
  onEnded,
}: {
  mode: Extract<Mode, { kind: "resume" }>;
  state: ReturnType<typeof useSavedInterview>;
  onRetry: () => void;
  onResume: () => void;
  /** 이 인터뷰가 나온 분석의 후보 목록을 엽니다(이슈 #116). */
  onOpenAnalysis: () => void;
  onBackToReview: () => void;
  onInterviewActiveChange: (active: boolean) => void;
  onUnsavedChange: (hasUnsaved: boolean) => void;
  onLoadLatest: () => void;
  onEnded: () => void;
}) {
  if (state.status === "loading") {
    return <StatusScreen kind="loading" code="Loading Interview" label="Opening the saved interview..." sub="" />;
  }

  if (state.status === "error") {
    const copy = RESUME_ERROR[state.kind] ?? RESUME_ERROR_FALLBACK;
    return (
      <StatusScreen
        kind="error"
        code={copy.code}
        label={copy.label}
        sub={copy.sub}
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }

  const { interview } = state;
  /*
   * 저장된 값을 인터뷰 화면이 쓰기 전에 모양을 확인합니다(PR #127 리뷰).
   *
   * 예전에는 `null`과 객체 여부만 봤습니다. 그런데 근거 스냅샷의 칸이 빠진 값이면 인터뷰 화면이
   * `snapshot.representativeCommit.title`을 읽다 렌더 도중 멈춥니다. 블록 상태도 같습니다. 질문
   * 경로가 쓰는 검사와 저장된 블록 상태 검사를 그대로 씁니다. 모양이 어긋나면 요약 화면에 남습니다.
   * 그 화면은 읽을 수 없는 값을 안내로 바꿔 그립니다.
   */
  const snapshot = isExperienceEvidenceSnapshot(interview.evidence) ? interview.evidence : null;
  if (mode.stage === "review") {
    return (
      <SavedInterviewScreen
        interview={interview}
        onResume={onResume}
        onLoadLatest={onLoadLatest}
        onOpenAnalysis={onOpenAnalysis}
      />
    );
  }
  if (snapshot === null || !isRestorableBlockState(interview.blockState)) {
    // 이어갈 수 없다고 알립니다. 요약 화면에 그냥 남기면 사용자가 버튼을 눌러도 아무 일도 일어나지
    // 않는 것처럼 보입니다.
    return (
      <StatusScreen
        kind="error"
        code="ERROR / STORAGE"
        label="Couldn't open this interview."
        sub="The saved evidence or blocks can no longer be read. You can still review what was saved."
        action={{ label: "Back to the summary", onClick: onBackToReview }}
      />
    );
  }

  return (
    <ResumedInterviewScreen
      interview={interview}
      snapshot={snapshot}
      onBack={onBackToReview}
      onInterviewActiveChange={onInterviewActiveChange}
      onUnsavedChange={onUnsavedChange}
      onLoadLatest={onLoadLatest}
      onEnded={onEnded}
    />
  );
}

/** 대화를 여는 자리입니다. 여는 동안 인터뷰가 활성 상태라는 것을 흐름에 알립니다. */
function ResumedInterviewScreen({
  interview,
  snapshot,
  onBack,
  onInterviewActiveChange,
  onUnsavedChange,
  onLoadLatest,
  onEnded,
}: {
  interview: StoredInterviewPayload;
  snapshot: ExperienceEvidenceSnapshot;
  onBack: () => void;
  onInterviewActiveChange: (active: boolean) => void;
  onUnsavedChange: (hasUnsaved: boolean) => void;
  onLoadLatest: () => void;
  onEnded: () => void;
}) {
  // 렌더 중에 부르면 흐름의 상태를 렌더 도중에 바꾸게 됩니다. 커밋된 뒤에 알립니다.
  useEffect(() => {
    onInterviewActiveChange(true);
    return () => onInterviewActiveChange(false);
  }, [onInterviewActiveChange]);

  return (
    <InterviewScreen
      snapshot={snapshot}
      interviewId={interview.id}
      restore={{
        history: interview.history,
        blockState: interview.blockState,
        progress: interview.progress,
        status: interview.status,
      }}
      onLoadLatest={onLoadLatest}
      onUnsavedChange={onUnsavedChange}
      onEnded={onEnded}
      onBack={onBack}
    />
  );
}

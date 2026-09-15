"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/shell/button";
import { StatusScreen } from "@/components/shell/status-screen";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import type { RepositorySummary } from "@/lib/github/types";
import { ExperienceCandidateList, StageAExclusions } from "@/features/experience-candidates/experience-candidate-list";
import type { ConfirmedExperience } from "@/features/experience-candidates/experience-selection";
import {
  createSavedInterview,
  fetchAnalysisByRepository,
  fetchStoredAnalysis,
  saveRepositoryAnalysis,
  SavedInterviewFetchError,
} from "@/features/saved-interviews/client";
import type { StoredAnalysisPayload } from "@/features/saved-interviews/payload";
import { buildStoredAnalysis } from "./analysis-snapshot";
import {
  analyzeRepository,
  generateCandidates,
  type AnalysisState,
  type EmptyKind,
  type LoadingPhase,
  type StageASelectionState,
} from "./repository-analysis";
import styles from "./repository-analysis.module.css";

const INITIAL_STATE: AnalysisState = { status: "idle" };

/**
 * 저장된 분석이 있는지 찾아보는 단계의 상태입니다(이슈 #116).
 *
 * `AnalysisState`에 섞지 않습니다. 이것은 분석의 한 단계가 아니라 분석을 할지 말지를 정하는 단계이고,
 * 섞으면 Loading 체크리스트가 하지 않은 분석 단계를 진행 중인 것처럼 보입니다.
 */
type LookupState =
  | { readonly status: "loading" }
  | { readonly status: "done" }
  /** 가리킨 분석이 사라졌습니다. 조회 실패와 갈라 둡니다. 사용자가 할 수 있는 일이 다릅니다. */
  | { readonly status: "missing" }
  | { readonly status: "failed"; readonly message: string };

/**
 * Loading 체크리스트가 그리는 6개 실제 분석 단계입니다. 순서는 `route-client.ts`의
 * `fetchContributionsFromApi`가 실제로 보고하는 순서(commit_details 완료 뒤 repository_metadata)와 같습니다.
 * `LoadingPhase`의 `details` 스텝 하나가 `commit_details`·`repository_metadata` 두 체크리스트 항목으로
 * 갈라지므로 여기서만 매핑하고 `repository-analysis.ts`의 실제 단계 수·순서는 바꾸지 않습니다.
 */
const CHECKLIST_STEPS = [
  { key: "commits", label: "Fetching commit history" },
  { key: "commit_details", label: "Fetching commit details" },
  { key: "repository_metadata", label: "Fetching repository metadata" },
  { key: "deriving", label: "Computing derived metrics" },
  { key: "stage_a", label: "Selecting experience candidates" },
  { key: "stage_b", label: "Finalizing candidates" },
] as const;

type ChecklistKey = (typeof CHECKLIST_STEPS)[number]["key"];

/**
 * ✓·●·○ 기호는 `aria-hidden`이고 완료·진행·대기 구분이 `data-state`와 CSS에만 있어 스크린리더에는
 * 여섯 항목의 라벨만 똑같이 나열됐습니다(PR #105 Codex 리뷰 P1). 항목마다 상태 문구를 시각적으로
 * 숨겨 함께 두면 `checklistStatus`의 `aria-live="polite"`가 단계 전환마다 바뀌는 이 문구를 읽어,
 * 기존 `LoadingState`가 `role="status"`로 현재 단계 제목을 알리던 것과 같은 효과를 냅니다.
 */
const CHECKLIST_STATUS_TEXT: Record<"done" | "active" | "pending", string> = {
  done: "Completed:",
  active: "In progress:",
  pending: "Pending:",
};

function checklistKeyFor(loading: LoadingPhase): ChecklistKey {
  if (loading.step === "details") {
    return loading.phase === "repository_metadata" ? "repository_metadata" : "commit_details";
  }
  return loading.step;
}

/**
 * `AppShell`의 사이드바 메타 표기(`ShellRepository` 기준 `visibility`·`language`)와 같은 형식입니다.
 * 저장된 인터뷰에서 들어온 경로에는 두 값이 없어 빈 문자열이 됩니다(이슈 #116).
 */
function analysisMeta(repository: AnalyzedRepository): string {
  return [repository.visibility?.toUpperCase(), repository.language ?? undefined].filter(Boolean).join(" · ");
}

/**
 * 분석할 Repository입니다. 공개 여부와 언어는 선택 사항입니다(이슈 #116).
 *
 * 저장된 인터뷰의 요약 화면에서 그 분석의 후보 목록으로 들어오는 경로가 생기면서 필요해졌습니다.
 * 저장된 인터뷰에는 owner와 name만 있고, 공개 여부와 언어는 저장소에서 바뀔 수 있는 값이라 저장하지
 * 않았습니다(backlog 3번). 없는 값을 지어내 채우면 화면이 낡은 값을 사실처럼 보입니다.
 */
export type AnalyzedRepository = Pick<RepositorySummary, "owner" | "name"> &
  Partial<Pick<RepositorySummary, "visibility" | "language">>;

export interface RepositoryAnalysisViewProps {
  repository: AnalyzedRepository;
  contributionItems: readonly string[];
  /**
   * 열어야 할 저장된 분석입니다(이슈 #116). 주면 저장소 이름으로 찾지 않고 이 분석을 엽니다.
   *
   * 저장된 인터뷰에서 "이 분석의 다른 경험"으로 들어올 때 씁니다. 저장소 이름으로 찾으면 그 사이에
   * 다시 분석한 결과가 있을 때 사용자가 고른 것과 다른 분석이 열립니다.
   */
  analysisId?: string;
  /** 테스트에서 인터뷰 줄 생성 요청을 대체하는 통로입니다. */
  createInterview?: typeof createSavedInterview;
  /** 테스트에서 분석 저장 요청을 대체하는 통로입니다(이슈 #116). */
  saveAnalysis?: typeof saveRepositoryAnalysis;
  /** 테스트에서 저장된 분석 조회를 대체하는 통로입니다(이슈 #116). */
  fetchAnalysis?: typeof fetchAnalysisByRepository;
  /** 테스트에서 식별자로 하는 분석 조회를 대체하는 통로입니다(이슈 #116). */
  fetchAnalysisById?: typeof fetchStoredAnalysis;
  /** 인터뷰 줄을 새로 만들었을 때 알립니다. 사이드바 목록이 그 줄을 바로 보이게 다시 조회합니다. */
  onInterviewCreated?: () => void;
  /** 다른 탭이 먼저 저장했을 때 그 인터뷰를 최신 내용으로 다시 엽니다. */
  onLoadLatestInterview?: (interviewId: string) => void;
  /** 저장되지 않은 턴이 있는지 알립니다. 이탈 확인을 받을지 흐름이 판단합니다. */
  onUnsavedInterviewChange?: (hasUnsaved: boolean) => void;
  /** 인터뷰를 끝냈을 때 그 인터뷰의 요약 화면으로 옮깁니다. */
  onInterviewEnded?: (interviewId: string) => void;
  /** 다른 Repository 선택입니다. 선택 화면으로 되돌아가는 일은 `RepositoryFlow`가 합니다. */
  onSelectRepository: () => void;
  /** `ExperienceCandidateList`로 그대로 전달합니다. `RepositoryFlow`가 사이드바 이탈 확인에 씁니다. */
  onInterviewActiveChange?: (active: boolean) => void;
}

/**
 * 선택한 Repository의 분석 진행과 결과 화면입니다. 마운트되면 곧바로 `analyzeRepository`를 시작합니다.
 * Repository와 기여 항목은 선택 화면(`features/repository-selection`)이 정해 prop으로 넘기고, 이 화면은 입력을 들고 있지 않습니다.
 * `repository`는 Loading 헤더에 owner·name과 visibility·language를 그리려고 `RepositorySummary` 전체를 받고,
 * 분석 로직과 후보 목록에는 `{owner, repo}`만 좁혀서 넘깁니다.
 *
 * 세션 여부는 `page.tsx`가 쿠키로 갈라 세션이 없으면 이 화면을 통째로 내리므로 여기서 세션을 다시 보지 않습니다.
 * 로그아웃 진입점은 둘입니다. 상단 헤더의 Sign out과 이 화면 오류 안내의 다시 로그인입니다. 둘 다 세션 삭제 뒤 라우터를 갱신해
 * 서버가 헤더와 화면을 함께 다시 그립니다. 내려간 뒤 늦게 도착하는 결과는 실행 번호로 걸러냅니다.
 */
export function RepositoryAnalysisView({
  repository,
  contributionItems,
  onSelectRepository,
  onInterviewActiveChange,
  createInterview = createSavedInterview,
  saveAnalysis = saveRepositoryAnalysis,
  fetchAnalysis = fetchAnalysisByRepository,
  fetchAnalysisById = fetchStoredAnalysis,
  analysisId,
  onInterviewCreated,
  onLoadLatestInterview,
  onUnsavedInterviewChange,
  onInterviewEnded,
}: RepositoryAnalysisViewProps) {
  const router = useRouter();
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  // 확정한 경험을 저장할 인터뷰 줄입니다. 요청 하나를 기다려야 생기므로 확정 직후에는 비어 있습니다.
  const [interviewId, setInterviewId] = useState<string | null>(null);
  /**
   * 이 분석을 저장한 줄입니다. 한 분석에서 경험을 여러 개 고를 때 다시 씁니다. 확정할 때마다 새로
   * 저장하면 같은 분석이 여러 줄로 쌓이고 목록에 같은 저장소가 여러 번 나옵니다.
   */
  const analysisIdRef = useRef<string | null>(null);
  /** 진행 중인 분석 저장입니다. 겹친 요청이 같은 줄을 쓰도록 이 약속을 함께 기다립니다(이슈 #116). */
  const savingAnalysisRef = useRef<Promise<string | null> | null>(null);
  /** 확정 번호입니다. 다른 경험으로 넘어간 뒤 늦게 도착한 응답을 걸러냅니다. */
  const confirmRef = useRef(0);
  // 진행 중인 분석의 실행 번호입니다. 초기화 뒤 늦게 도착한 결과가 화면에 다시 나타나지 않게 걸러냅니다.
  const runRef = useRef(0);
  // 개발 모드의 StrictMode는 effect를 두 번 실행합니다. 같은 분석을 두 번 시작하지 않게 한 번만 시작합니다.
  const startedRef = useRef(false);
  /**
   * 저장된 분석을 찾아보는 단계입니다(이슈 #116). 분석 상태와 따로 두는 이유는 이것이 분석의 한
   * 단계가 아니기 때문입니다. 체크리스트의 단계로 섞으면 화면이 하지 않은 일을 하고 있다고 말합니다.
   */
  const [lookup, setLookup] = useState<LookupState>({ status: "loading" });
  /** 저장된 분석으로 그린 화면이면 그 분석을 저장한 시각입니다. 다시 분석하면 비웁니다. */
  const [savedAt, setSavedAt] = useState<string | null>(null);
  /**
   * 열어야 할 분석의 식별자입니다. 그 분석이 사라졌을 때 비우고 저장소 이름으로 다시 찾습니다.
   * 상태로 두는 이유는 비우는 일이 사용자의 조작(다시 분석)에서 오기 때문입니다.
   */
  const requestedAnalysisIdRef = useRef<string | undefined>(analysisId);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void openRepository(++runRef.current);
    // 이 effect가 부르는 함수들은 렌더마다 새로 만들어지지만 붙드는 값이 모두 ref와 setState라 실행
    // 결과가 달라지지 않습니다. 의존성에 넣으면 effect가 매 렌더 다시 돌아 같은 분석을 다시 시작합니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repository, contributionItems]);

  /**
   * 이 Repository를 엽니다. 저장된 분석이 있으면 그것으로 후보 화면을 그리고, 없을 때만 분석합니다
   * (이슈 #116).
   *
   * 저장된 것이 있는데도 다시 분석하지 않는 이유는 Stage B가 쓰는 모델의 하루 요청 수가 프로젝트
   * 전체에서 20회이기 때문입니다. 자동으로 다시 분석하면 사용자가 고르지 않은 요청이 그 한도를 씁니다.
   * 다시 분석하는 일은 사용자가 화면에서 직접 고릅니다.
   *
   * 조회가 실패한 경우를 "저장된 것이 없음"으로 접지 않습니다. 접으면 저장 계층이 잠시 끊긴 동안
   * 들어온 사용자마다 새 분석이 돌아 한도를 씁니다. 없는 것(`not_found`)만 분석으로 넘어갑니다.
   */
  async function openRepository(run: number): Promise<void> {
    setLookup({ status: "loading" });
    const requested = requestedAnalysisIdRef.current;
    let stored: StoredAnalysisPayload | null = null;
    try {
      stored =
        requested === undefined
          ? await fetchAnalysis(repository.owner, repository.name)
          : await fetchAnalysisById(requested);
    } catch (error) {
      if (runRef.current !== run) return;
      if (!(error instanceof SavedInterviewFetchError) || error.kind !== "not_found") {
        setLookup({ status: "failed", message: error instanceof Error ? error.message : "" });
        return;
      }
      // 사용자가 가리킨 분석이 사라졌습니다. 저장소 이름으로 대신 찾지 않고 알립니다. 다른 분석을
      // 말없이 열면 사용자가 고른 것과 다른 후보 목록이 보입니다.
      if (requested !== undefined) {
        setLookup({ status: "missing" });
        return;
      }
    }
    if (runRef.current !== run) return;
    setLookup({ status: "done" });

    if (stored !== null) {
      analysisIdRef.current = stored.id;
      setSavedAt(stored.createdAt);
      setState({
        status: "success",
        data: { includedCommits: stored.candidates.includedCommits },
        candidates: stored.candidates.candidates,
        stageASelection: stored.stageASummary,
      });
      return;
    }

    await analyzeRepository(
      { owner: repository.owner, repo: repository.name },
      contributionItems,
      stateSinkFor(run)
    );
  }

  /**
   * 이 실행이 아직 최신일 때만 상태를 반영하고, 분석이 끝나면 그 결과를 저장합니다(이슈 #116).
   *
   * 저장 시점이 정의서가 정한 자리입니다. 확정 시점까지 미루면 경험을 하나도 고르지 않고 나간
   * 사용자가 다시 들어왔을 때 후보 목록이 없고, Stage B가 쓰는 모델은 하루 요청 수가 프로젝트 전체
   * 20회라 다시 분석하는 것이 사실상 막혀 있습니다.
   */
  function stateSinkFor(run: number) {
    return (next: AnalysisState) => {
      if (runRef.current !== run) return;
      setState(next);
      if (next.status === "success") void storedAnalysisId(next, run);
    };
  }

  /**
   * 이 분석을 저장한 줄의 식별자입니다. 아직 저장하지 않았으면 지금 저장합니다.
   *
   * 저장이 진행 중이면 그 약속을 그대로 돌려줍니다. 분석이 끝나자마자 저장이 시작되고 사용자가 곧바로
   * 경험을 확정하면 두 요청이 겹치는데, 겹칠 때마다 저장하면 같은 분석이 여러 줄로 쌓이고 목록에 같은
   * 저장소가 여러 번 나옵니다(backlog 9번). 요청을 직렬화해 둘이 같은 줄을 씁니다.
   *
   * 실패하면 `null`입니다. 화면을 막지 않습니다. 저장은 대화를 이어가기 위한 장치이지 대화의 전제가
   * 아니므로, 저장이 실패해도 후보 화면과 인터뷰는 그대로 됩니다. 확정 시점에 한 번 더 시도합니다.
   */
  function storedAnalysisId(
    state: Extract<AnalysisState, { status: "success" }>,
    run: number
  ): Promise<string | null> {
    if (analysisIdRef.current !== null) return Promise.resolve(analysisIdRef.current);
    if (savingAnalysisRef.current !== null) return savingAnalysisRef.current;

    const analysis = buildStoredAnalysis({
      repoOwner: repository.owner,
      repoName: repository.name,
      contributionItems,
      data: state.data,
      candidates: state.candidates,
      stageASelection: state.stageASelection,
    });
    const pending = saveAnalysis(analysis).then(
      (analysisId) => {
        savingAnalysisRef.current = null;
        // 다시 분석을 시작했으면 이 식별자는 더 이상 이 화면의 결과가 아닙니다. 붙들면 새 분석의
        // 후보로 만든 인터뷰가 앞 분석의 줄에 붙습니다.
        if (runRef.current !== run) return null;
        analysisIdRef.current = analysisId;
        return analysisId;
      },
      () => {
        savingAnalysisRef.current = null;
        return null;
      }
    );
    savingAnalysisRef.current = pending;
    return pending;
  }

  /**
   * 경험을 확정할 때 인터뷰 한 줄을 만듭니다(이슈 #115).
   *
   * 인터뷰는 이 요청을 기다리지 않고 곧바로 시작합니다. 저장은 대화를 이어가기 위한 장치이지 대화의
   * 전제가 아니므로, 기다리게 하면 저장 계층이 느릴 때 첫 질문도 함께 늦어집니다. 줄이 생기기 전에
   * 오간 턴은 줄이 생긴 뒤 밀린 턴으로 함께 저장됩니다.
   */
  function confirmExperience(confirmed: ConfirmedExperience | null) {
    const seq = ++confirmRef.current;
    setInterviewId(null);
    if (confirmed === null || state.status !== "success") return;
    const success = state;
    const run = runRef.current;

    void (async () => {
      // 가리킨 분석이 지워졌으면 다시 저장해 한 번만 더 붙입니다. 두 번째도 실패하면 그때는 저장
      // 계층이 응답하지 않는 것이므로 더 시도하지 않고 저장 없이 대화를 진행합니다.
      for (const attempt of [0, 1]) {
        const analysisId = await storedAnalysisId(success, run);
        if (analysisId === null || confirmRef.current !== seq) return;
        try {
          const created = await createInterview({
            analysisId,
            candidateKey: confirmed.candidateKey,
            title: confirmed.title,
            evidence: confirmed.snapshot,
          });
          if (confirmRef.current !== seq) return;
          analysisIdRef.current = created.analysisId;
          setInterviewId(created.interviewId);
          onInterviewCreated?.();
          return;
        } catch (error) {
          const missing = error instanceof SavedInterviewFetchError && error.kind === "not_found";
          if (attempt === 1 || !missing) return;
          analysisIdRef.current = null;
        }
      }
    })();
  }

  /** 가리킨 분석이 사라졌을 때 저장소를 처음부터 다시 분석합니다. 사용자가 눌러야 시작합니다. */
  function analyzeAgain(): void {
    requestedAnalysisIdRef.current = undefined;
    void restart();
  }

  function restart() {
    runRef.current += 1;
    // 다시 분석하면 앞 분석의 줄을 가리키는 식별자는 더 이상 이 화면의 결과가 아닙니다.
    analysisIdRef.current = null;
    savingAnalysisRef.current = null;
    setSavedAt(null);
    return analyzeRepository({ owner: repository.owner, repo: repository.name }, contributionItems, stateSinkFor(runRef.current));
  }

  function retry() {
    if (state.status === "error" && state.retryPoint) {
      return generateCandidates(state.retryPoint, stateSinkFor(runRef.current));
    }
    return restart();
  }

  async function reauthenticate() {
    // 삭제가 실패해도 진행합니다. 갱신된 헤더가 로그인 상태로 남으면 사용자가 알 수 있습니다.
    await fetch(SESSION_PATH, { method: "DELETE" }).catch(() => undefined);
    runRef.current += 1;
    setState(INITIAL_STATE);
    router.refresh();
  }

  return (
    <main className={styles.screen}>
      {/* Loading은 보이는 h1(LoadingChecklist 안)을 갖지만 Empty·Error·Success는 StatusScreen과
          ExperienceCandidateList가 h1을 그리지 않습니다. 시각적으로는 숨기되 스크린리더가 상태와 무관하게
          이 화면이 어느 Repository의 분석인지 읽을 수 있도록 h1을 하나 유지합니다. */}
      {state.status !== "loading" ? (
        <h1 className={styles.visuallyHidden}>{repository.owner} / {repository.name}</h1>
      ) : null}
      {lookup.status === "loading" ? (
        <StatusScreen
          kind="loading"
          code="LOADING"
          label="Looking for a saved analysis…"
          sub="If this repository was analyzed before, the saved result opens instead of a new analysis."
        />
      ) : null}
      {lookup.status === "missing" ? (
        <StatusScreen
          kind="empty"
          code="NOT FOUND"
          label="This saved analysis is no longer available."
          sub="It may have been deleted after 90 days without opening it. You can analyze this repository again."
          action={{ label: "Analyze this repository", onClick: analyzeAgain }}
        />
      ) : null}
      {lookup.status === "failed" ? (
        <StatusScreen
          kind="error"
          code="ERROR / STORAGE"
          label="Couldn't check for a saved analysis."
          sub={
            <>
              A new analysis isn&apos;t started automatically, because it would use one of the few daily model
              requests this project shares. {lookup.message}
            </>
          }
          action={{ label: "Try again", onClick: () => void openRepository(++runRef.current) }}
        />
      ) : null}
      {state.status === "loading" ? <LoadingChecklist repository={repository} loading={state.loading} onSelectRepository={onSelectRepository} /> : null}
      {state.status === "empty" ? (
        <EmptyState
          kind={state.kind}
          reason={state.kind === "no_final_candidates" ? state.reason : undefined}
          stageASelection={state.stageASelection}
          onSelectRepository={onSelectRepository}
        />
      ) : null}
      {state.status === "error" ? (
        <ErrorState
          error={state.error}
          retryLabel={state.retryPoint ? "Retry candidate generation" : "Retry full analysis"}
          onRetry={retry}
          onReauthenticate={reauthenticate}
          onSelectRepository={onSelectRepository}
        />
      ) : null}
      {state.status === "success" ? (
        <div className={styles.content}>
          {savedAt !== null ? <SavedAnalysisNotice savedAt={savedAt} onReanalyze={restart} /> : null}
          <ExperienceCandidateList
            repository={{ owner: repository.owner, repo: repository.name }}
            data={state.data}
            candidates={state.candidates}
            stageASelection={state.stageASelection}
            onSelectRepository={onSelectRepository}
            onInterviewActiveChange={onInterviewActiveChange}
            onExperienceConfirmed={confirmExperience}
            interviewId={interviewId}
            onLoadLatestInterview={interviewId === null ? undefined : () => onLoadLatestInterview?.(interviewId)}
            onUnsavedInterviewChange={onUnsavedInterviewChange}
            onInterviewEnded={interviewId === null ? undefined : () => onInterviewEnded?.(interviewId)}
          />
        </div>
      ) : null}
    </main>
  );
}

/**
 * 저장된 분석으로 그린 화면이라는 것을 알립니다(이슈 #116).
 *
 * 저장된 값이라는 사실을 감추면 사용자는 지금 저장소 상태를 본다고 오해합니다. 저장 뒤에 올라온
 * 커밋은 이 후보 목록에 없습니다. 다시 분석하는 길도 여기서 함께 엽니다. 자동으로 다시 분석하지
 * 않기로 한 이상(`openRepository`), 사용자가 고를 자리가 없으면 옛 결과에 갇힙니다.
 */
function SavedAnalysisNotice({ savedAt, onReanalyze }: { savedAt: string; onReanalyze: () => void }) {
  const date = new Date(savedAt);
  return (
    <div className={styles.savedNotice} role="status">
      <span className={styles.savedNoticeCode}>SAVED</span>
      <p className={styles.savedNoticeText}>
        Showing the analysis saved on{" "}
        <time dateTime={savedAt}>
          {Number.isNaN(date.getTime()) ? savedAt : date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
        </time>
        . Commits pushed since then are not in this list.
      </p>
      <Button variant="secondary" onClick={onReanalyze}>Analyze again</Button>
    </div>
  );
}

function LoadingChecklist({
  repository,
  loading,
  onSelectRepository,
}: {
  repository: AnalyzedRepository;
  loading: LoadingPhase;
  onSelectRepository: () => void;
}) {
  const activeKey = checklistKeyFor(loading);
  const activeIndex = CHECKLIST_STEPS.findIndex((step) => step.key === activeKey);
  const meta = analysisMeta(repository);

  return (
    <div className={styles.loadingScreen}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Analyzing Repository</p>
        <h1>{repository.owner} / {repository.name}</h1>
        {meta ? <p className={styles.meta}>{meta}</p> : null}
      </header>

      <div className={styles.checklistStatus} role="status" aria-live="polite">
        <ul className={styles.checklist}>
          {CHECKLIST_STEPS.map((step, index) => {
            // Stage A는 서버가 한 번의 요청으로 판단해 중간 진행률을 관측할 수 없습니다. 세지 못하는
            // 것을 세는 척하지 않고 기호만 둡니다(기존 프로젝트 결정, repository-analysis.ts 참고).
            const symbolState = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
            const progress =
              step.key === "commit_details" && loading.step === "details" && loading.phase === "commit_details"
                ? `${loading.completed} / ${loading.total}`
                : null;
            return (
              <li
                key={step.key}
                className={styles.checklistItem}
                data-state={symbolState}
                aria-current={symbolState === "active" ? "step" : undefined}
              >
                <span className={styles.symbol} aria-hidden="true">
                  {symbolState === "done" ? "✓" : symbolState === "active" ? "●" : "○"}
                </span>
                <span className={styles.checklistLabel}>
                  <span className={styles.visuallyHidden}>{CHECKLIST_STATUS_TEXT[symbolState]} </span>
                  {step.label}
                </span>
                {progress ? <span className={styles.checklistProgress}>{progress}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>

      <footer className={styles.footer}>
        <button className={styles.changeRepository} type="button" onClick={onSelectRepository}>← Change repository</button>
      </footer>
    </div>
  );
}

const EMPTY_COPY: Record<EmptyKind | "no_final_candidates", { code: string; label: string; description: string }> = {
  no_commits: {
    code: "No Commits",
    label: "No commits found to analyze.",
    description: "No commits were found on the default branch. Choose a repository with commit history.",
  },
  no_author_commits: {
    code: "No Author Commits",
    label: "No commits authored by you were found.",
    description:
      "The default branch has commits, but none are authored by the current GitHub account. Choose a repository where you have authored commits.",
  },
  no_analyzable_commits: {
    code: "No Analyzable Commits",
    label: "This repository is difficult to analyze.",
    description:
      "There are commits, but none remain once merge, docs, dependency, typo, and formatting commits are excluded. Choose a different repository with commit history.",
  },
  no_stage_a_candidates: {
    code: "No Candidates",
    label: "No experience candidates worth explaining were found.",
    description:
      "No commits matched your contribution items or stood out as worth explaining based on commit messages and change stats. Choose a different repository.",
  },
  no_final_candidates: {
    code: "No Final Candidates",
    label: "Unable to produce final experience candidates.",
    description: "We don't lower the bar or fill in candidates artificially. Choose a different repository.",
  },
};

function EmptyState({
  kind,
  reason,
  stageASelection,
  onSelectRepository,
}: {
  kind: EmptyKind | "no_final_candidates";
  reason?: string;
  // Stage A 전에 나는 no_commits·no_author_commits·no_analyzable_commits는 선별 정보가 없어 생략됩니다.
  // no_stage_a_candidates·no_final_candidates는 후보가 0개일 때가 제외 사유를 가장 알아야 할 순간이라
  // 값이 있으면 성공 상태와 같은 `StageAExclusions`로 그립니다(이슈 #58 Codex 리뷰 P1-2).
  stageASelection?: StageASelectionState;
  onSelectRepository: () => void;
}) {
  const copy = EMPTY_COPY[kind];
  return (
    <div className={styles.stateStack}>
      <StatusScreen
        kind="empty"
        code={copy.code}
        label={copy.label}
        sub={reason ? <>{reason} {copy.description}</> : copy.description}
        action={{ label: "Choose a different repository", onClick: onSelectRepository }}
      />
      {/* StageAExclusions는 <details>를 그리는 블록 엘리먼트라 StatusScreen의 sub(<p>) 안에는 못 넣고
          형제로 둡니다. StatusScreen 계약은 바꾸지 않습니다. */}
      {stageASelection ? <div className={styles.exclusionsPad}><StageAExclusions {...stageASelection} /></div> : null}
    </div>
  );
}

interface ErrorStateProps {
  error: Extract<AnalysisState, { status: "error" }>["error"];
  retryLabel: string;
  onRetry: () => void;
  onReauthenticate: () => void;
  onSelectRepository: () => void;
}

/**
 * GitHub 조회 오류(rate_limit·auth_revoked·repo_not_found·network·server_error·partial_failure)의 `code`만
 * 여기서 정합니다. 후보 생성 오류(LLM·diff 재조회·Stage A/B)는 이번 이슈 범위 밖이라 `title`·`message`가
 * 아직 한국어이고, 코드도 일반 `ERROR`로 남겨 둡니다. 번역 범위 확장은 후속 이슈입니다.
 */
function errorStatusCode(kind: string): string {
  switch (kind) {
    case "rate_limit":
      return "ERROR / RATE LIMIT";
    case "auth_revoked":
      return "ERROR / AUTH";
    case "repo_not_found":
      return "ERROR / NOT FOUND";
    case "network":
      return "ERROR / NETWORK";
    case "server_error":
      return "ERROR / GITHUB";
    case "partial_failure":
      return "ERROR / PARTIAL";
    default:
      return "ERROR";
  }
}

function ErrorState({ error, retryLabel, onRetry, onReauthenticate, onSelectRepository }: ErrorStateProps) {
  const action = error.recovery === "reauthenticate"
    ? { label: "Log in to GitHub again", onClick: onReauthenticate }
    : error.recovery === "select_repository"
      ? { label: "Choose a different repository", onClick: onSelectRepository }
      : { label: retryLabel, onClick: onRetry };
  return (
    <StatusScreen
      kind="error"
      code={errorStatusCode(error.kind)}
      label={error.title}
      sub={error.message}
      action={action}
    />
  );
}

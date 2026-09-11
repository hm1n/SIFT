"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { StatusScreen } from "@/components/shell/status-screen";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import type { RepositorySummary } from "@/lib/github/types";
import { ExperienceCandidateList, StageAExclusions } from "@/features/experience-candidates/experience-candidate-list";
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

/** `AppShell`의 사이드바 메타 표기(`ShellRepository` 기준 `visibility`·`language`)와 같은 형식입니다. */
function analysisMeta(repository: RepositorySummary): string {
  return [repository.visibility.toUpperCase(), repository.language ?? undefined].filter(Boolean).join(" · ");
}

export interface RepositoryAnalysisViewProps {
  repository: RepositorySummary;
  contributionItems: readonly string[];
  /** 다른 Repository 선택입니다. 선택 화면으로 되돌아가는 일은 `RepositoryFlow`가 합니다. */
  onSelectRepository: () => void;
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
export function RepositoryAnalysisView({ repository, contributionItems, onSelectRepository }: RepositoryAnalysisViewProps) {
  const router = useRouter();
  const [state, setState] = useState<AnalysisState>(INITIAL_STATE);
  // 진행 중인 분석의 실행 번호입니다. 초기화 뒤 늦게 도착한 결과가 화면에 다시 나타나지 않게 걸러냅니다.
  const runRef = useRef(0);
  // 개발 모드의 StrictMode는 effect를 두 번 실행합니다. 같은 분석을 두 번 시작하지 않게 한 번만 시작합니다.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const run = ++runRef.current;
    void analyzeRepository({ owner: repository.owner, repo: repository.name }, contributionItems, (next) => {
      if (runRef.current === run) setState(next);
    });
  }, [repository, contributionItems]);

  /** 이 실행이 아직 최신일 때만 상태를 반영합니다. */
  function stateSinkFor(run: number) {
    return (next: AnalysisState) => {
      if (runRef.current === run) setState(next);
    };
  }

  function restart() {
    runRef.current += 1;
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
          <ExperienceCandidateList
            repository={{ owner: repository.owner, repo: repository.name }}
            data={state.data}
            candidates={state.candidates}
            stageASelection={state.stageASelection}
            onSelectRepository={onSelectRepository}
          />
        </div>
      ) : null}
    </main>
  );
}

function LoadingChecklist({
  repository,
  loading,
  onSelectRepository,
}: {
  repository: RepositorySummary;
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

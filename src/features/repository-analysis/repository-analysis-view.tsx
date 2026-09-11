"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import type { RepositoryRef } from "@/lib/github/types";
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


function loadingCopy(loading: LoadingPhase) {
  if (loading.step === "commits") {
    return {
      step: "1단계",
      title: "전체 커밋을 조회하고 있습니다",
      description: "기본 브랜치의 커밋을 빠짐없이 확인합니다. 커밋 수에는 임의의 상한을 두지 않습니다.",
    };
  }
  if (loading.step === "deriving") {
    return {
      step: "3단계",
      title: "파생 지표를 계산하고 있습니다",
      description: "수집한 Repository 근거를 후보 데이터 입력 형태로 정리하고 있습니다.",
    };
  }
  if (loading.step === "stage_a") {
    return {
      step: "4단계",
      title: "경험 후보를 1차 선별하고 있습니다",
      // 청크 사이 한도 대기 문구가 있었습니다. 요청이 한 번이 되면서 기다릴 자리가 없어 지웠습니다.
      //
      // 진행 개수도 같은 이유로 지웠습니다. 요청이 하나라 중간에 보고할 지점이 없어 화면이 응답이
      // 올 때까지 "0개를 판단했다"를 붙들고 있었습니다(2026-09-02 브라우저 실측). 세지 못하는 것을
      // 세는 척하지 않고, 몇 묶음을 한 번에 보냈는지만 알립니다.
      description: `${loading.total}개 묶음을 한 번의 요청으로 판단하고 있습니다. 중간 진행률은 알 수 없습니다.`,
    };
  }
  if (loading.step === "stage_b") {
    return {
      step: "5·6단계",
      title: "diff·PR 근거를 수집하고 최종 후보를 판단하고 있습니다",
      description:
        "서버가 후보 커밋의 diff와 PR 소속을 수집한 뒤 한 번의 판단으로 최대 3개 후보를 고릅니다. 두 단계는 한 요청으로 처리됩니다.",
    };
  }
  return {
    step: "2단계",
    title:
      loading.phase === "repository_metadata"
        ? "Repository 정보를 조회하고 있습니다"
        : "분석할 커밋의 상세 정보를 조회하고 있습니다",
    description:
      loading.phase === "repository_metadata"
        ? "커밋 상세 조회를 마치고 파일 트리와 언어 통계를 확인하고 있습니다."
        : `${loading.total}개 중 ${loading.completed}개를 확인했습니다.`,
  };
}

export interface RepositoryAnalysisViewProps {
  repository: RepositoryRef;
  contributionItems: readonly string[];
  /** 다른 Repository 선택입니다. 선택 화면으로 되돌아가는 일은 `RepositoryFlow`가 합니다. */
  onSelectRepository: () => void;
}

/**
 * 선택한 Repository의 분석 진행과 결과 화면입니다. 마운트되면 곧바로 `analyzeRepository`를 시작합니다.
 * Repository와 기여 항목은 #95부터 선택 화면(`features/repository-selection`)이 정해 prop으로 넘기고, 이 화면은 입력을 들고 있지 않습니다.
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
    void analyzeRepository(repository, contributionItems, (next) => {
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
    return analyzeRepository(repository, contributionItems, stateSinkFor(runRef.current));
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
    <div className={styles.shell}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Repository analysis</p>
        <h1>코드에 남은 개발 경험을 찾아보세요</h1>
        <p>GitHub Repository의 실제 커밋과 파일을 조회해 인터뷰에 사용할 근거를 준비합니다.</p>
      </header>

      <main className={styles.card}>
        {state.status === "loading" ? <LoadingState loading={state.loading} /> : null}
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
            retryLabel={state.retryPoint ? "후보 생성 다시 시도" : "전체 조회 다시 시도"}
            onRetry={retry}
            onReauthenticate={reauthenticate}
            onSelectRepository={onSelectRepository}
          />
        ) : null}
        {state.status === "success" ? (
          <ExperienceCandidateList
            repository={repository}
            data={state.data}
            candidates={state.candidates}
            stageASelection={state.stageASelection}
            onSelectRepository={onSelectRepository}
          />
        ) : null}
      </main>
    </div>
  );
}

function LoadingState({ loading }: { loading: LoadingPhase }) {
  const copy = loadingCopy(loading);
  // stage_a는 진행률을 알 수 없어 불확정 막대를 씁니다. 응답 전까지 0퍼센트에 멈춘 막대는 멈춘
  // 것처럼 보이고, 실제로는 요청이 진행 중입니다.
  const progress = loading.step === "details" && loading.total > 0
    ? (loading.completed / loading.total) * 100
    : null;
  return (
    <section className={styles.state} role="status" aria-live="polite">
      <span className={styles.step}>{copy.step}</span>
      <h2>{copy.title}</h2>
      <p>{copy.description}</p>
      <div className={styles.progressTrack} aria-hidden="true">
        <div className={`${styles.progressBar} ${progress === null ? styles.indeterminate : ""}`} style={progress === null ? undefined : { width: `${progress}%` }} />
      </div>
    </section>
  );
}

const EMPTY_COPY: Record<EmptyKind | "no_final_candidates", { title: string; description: string }> = {
  no_commits: {
    title: "분석할 커밋이 없습니다",
    description: "기본 브랜치에 커밋이 확인되지 않았습니다. 커밋 이력이 있는 Repository를 선택해 주세요.",
  },
  no_author_commits: {
    title: "본인이 작성한 커밋이 없습니다",
    description:
      "기본 브랜치에는 커밋이 있지만 현재 GitHub 계정이 작성자로 연결된 커밋은 확인되지 않았습니다. 본인이 작성한 커밋이 있는 다른 Repository를 선택해 주세요.",
  },
  no_analyzable_commits: {
    title: "이 저장소는 분석하기 어렵습니다",
    description:
      "커밋은 있지만 병합, 문서, 의존성, 오타, 포맷팅 커밋을 제외하면 상세히 살펴볼 대상이 없습니다. 커밋 이력이 있는 다른 Repository를 선택해 주세요.",
  },
  no_stage_a_candidates: {
    title: "설명할 만한 경험 후보를 찾지 못했습니다",
    description:
      "커밋 메시지와 변경 통계에서 기여 항목과 일치하거나 설명할 가치가 있는 커밋을 찾지 못했습니다. 다른 Repository를 선택해 주세요.",
  },
  no_final_candidates: {
    title: "최종 경험 후보를 만들지 못했습니다",
    description: "기준을 완화하거나 후보를 임의로 채우지 않습니다. 다른 Repository를 선택해 주세요.",
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
    <section className={styles.state} aria-live="polite" data-empty-kind={kind}>
      <h2>{copy.title}</h2>
      {reason ? <p>{reason}</p> : null}
      <p>{copy.description}</p>
      {stageASelection ? <StageAExclusions {...stageASelection} /> : null}
      <div className={styles.actions}>
        <button className={styles.secondaryButton} type="button" onClick={onSelectRepository}>다른 Repository 선택</button>
      </div>
    </section>
  );
}

interface ErrorStateProps {
  error: Extract<AnalysisState, { status: "error" }>["error"];
  retryLabel: string;
  onRetry: () => void;
  onReauthenticate: () => void;
  onSelectRepository: () => void;
}

function ErrorState({ error, retryLabel, onRetry, onReauthenticate, onSelectRepository }: ErrorStateProps) {
  const action = error.recovery === "reauthenticate"
    ? { label: "GitHub으로 다시 로그인", run: onReauthenticate }
    : error.recovery === "select_repository"
      ? { label: "Repository 다시 선택", run: onSelectRepository }
      : { label: retryLabel, run: onRetry };
  return (
    <section className={styles.state} role="alert" data-error-kind={error.kind}>
      <h2>{error.title}</h2>
      <p>{error.message}</p>
      <div className={styles.actions}>
        <button className={styles.button} type="button" onClick={action.run}>{action.label}</button>
      </div>
    </section>
  );
}


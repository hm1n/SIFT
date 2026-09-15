"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExperienceCandidateListItem, StageBCandidateResult } from "./types";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import type { RepositoryRef } from "@/lib/github/types";
import { VERIFIABILITY_LABEL } from "./evidence-verifiability";
import { candidateTitle, deriveCandidatePeriod, pluralCount } from "./candidate-period";
import { MAX_TECHNICAL_TOPICS } from "./schema";
import { ExperienceCandidateDetail } from "./experience-candidate-detail";
import { InterviewScreen, type InterviewProgressSnapshot } from "@/features/interview/interview-screen";
import {
  confirmExperienceSelection,
  type ConfirmedExperience,
  type ExperienceSelectionState,
} from "./experience-selection";
import {
  WORK_UNIT_SELECTION_EXCLUSION_COPY,
  type ExcludedWorkUnit,
} from "./work-unit-selection";
import { WORK_UNIT_SIGNAL_COPY } from "./work-unit-score";
import { modelFacingUnitId } from "./work-unit";
import styles from "./experience-candidate-list.module.css";

/**
 * Stage A 선별에서 제외된 값입니다. `repository-analysis.ts`의 `StageASelectionState`와 구조가
 * 같습니다. 그 타입을 직접 가져오지 않는 이유는 `repository-analysis`가 이 기능을 소비하는
 * 상위 계층이기 때문입니다. 여기서 가져오면 역방향 의존이 생깁니다.
 */
export interface StageASelectionDisplay {
  readonly excludedUnits: readonly ExcludedWorkUnit<ReadonlyCommitDetail>[];
  readonly thresholdScore: number;
  /** 점수 선별을 통과해 실제로 판단한 묶음 수입니다. 전체 대비 얼마인지 말하려면 필요합니다. */
  readonly selectedUnitCount: number;
  readonly unjudgedShas: readonly string[];
}

/** 행에 보여줄 토픽 수입니다. 디자인 목록 행은 제목·커밋 수·기간까지라 두 개 넘으면 빽빽해집니다. */
const ROW_TOPIC_COUNT = 2;

export function createExperienceCandidateListItems(
  data: CandidateDataOutput,
  candidates: StageBCandidateResult
): readonly ExperienceCandidateListItem[] {
  const commitsBySha = new Map(data.includedCommits.map((commit) => [commit.sha, commit]));
  return candidates.candidates.map((candidate) => ({
    candidate,
    commit: commitsBySha.get(candidate.sha) ?? null,
    origin: "repository",
    normalizedRelatedShas: [...new Set(candidate.relatedShas.filter((sha) => sha !== candidate.sha))],
    normalizedCitedFilePaths: [...new Set(candidate.citedFilePaths)],
    // 스키마가 빈 문자열과 개수 초과를 거부하지 않으므로(이유는 `MAX_TECHNICAL_TOPICS`) 여기서
    // 거릅니다. 토픽 문자열을 React `key`로 쓰기 때문에 중복 제거가 필요합니다.
    normalizedTechnicalTopics: [
      ...new Set(candidate.technicalTopics.map((topic) => topic.trim()).filter((topic) => topic.length > 0)),
    ].slice(0, MAX_TECHNICAL_TOPICS),
  }));
}

interface ExperienceCandidateListProps {
  repository: RepositoryRef;
  data: CandidateDataOutput;
  candidates: StageBCandidateResult;
  /** 생략하면 제외 요약을 표시하지 않습니다. 실제 화면은 항상 값을 넘깁니다. */
  stageASelection?: StageASelectionDisplay;
  onSelectRepository: () => void;
  /**
   * 인터뷰 확정 여부가 바뀔 때마다 상위(`RepositoryFlow`)에 알립니다. `AppShell` 사이드바의
   * Change repository는 이 컴포넌트 밖에 있어, 인터뷰 중인지 모르면 `InterviewScreen`의 이탈
   * 확인을 그대로 건너뛰고 대화를 잃습니다(PR #105 Codex 리뷰 P1).
   */
  onInterviewActiveChange?: (active: boolean) => void;
  /**
   * 경험을 확정하거나(값) 확정을 물렀을 때(`null`) 불립니다(이슈 #115). 인터뷰 줄을 만드는 일은
   * 분석 결과를 들고 있는 상위 화면이 합니다. 여기서 만들면 저장할 분석 결과를 이 기능이 다시
   * 알아야 하고, `repository-analysis`를 가져오게 되어 역방향 의존이 생깁니다.
   */
  onExperienceConfirmed?: (confirmed: ConfirmedExperience | null) => void;
  /** 상위가 만든 인터뷰 줄입니다. 없으면 저장하지 않고 대화는 그대로 진행합니다. */
  interviewId?: string | null;
  /** 다른 탭이 먼저 저장했을 때 최신 내용을 다시 불러옵니다. 인터뷰 화면으로 그대로 내려보냅니다. */
  onLoadLatestInterview?: () => void;
  /** 저장되지 않은 턴이 있는지 상위에 알립니다. 이탈 확인을 받을지 흐름이 판단합니다. */
  onUnsavedInterviewChange?: (hasUnsaved: boolean) => void;
  /** 대화의 진행 상황입니다. 흐름이 이탈을 셀 때 씁니다(이슈 #126). 그대로 전달만 합니다. */
  onInterviewProgressChange?: (progress: InterviewProgressSnapshot) => void;
  /** 인터뷰를 끝냈을 때 알립니다. 흐름이 그 인터뷰의 요약 화면으로 옮깁니다. */
  onInterviewEnded?: () => void;
}

export function ExperienceCandidateList({
  repository,
  data,
  candidates,
  stageASelection,
  onSelectRepository,
  onInterviewActiveChange,
  onExperienceConfirmed,
  interviewId,
  onLoadLatestInterview,
  onUnsavedInterviewChange,
  onInterviewProgressChange,
  onInterviewEnded,
}: ExperienceCandidateListProps) {
  const items = useMemo(() => createExperienceCandidateListItems(data, candidates), [data, candidates]);
  // 목록 행과 상세 양쪽이 관련 커밋의 date를 봐야 해서 여기서 한 번만 모읍니다.
  const commitsBySha = useMemo(() => new Map(data.includedCommits.map((commit) => [commit.sha, commit])), [data]);
  // master-detail 배치라 항상 한 후보가 선택돼 있습니다. 디자인의 `useState(CANDIDATES[0])`과 같습니다.
  const [selectedSha, setSelectedSha] = useState<string | null>(() => items[0]?.candidate.sha ?? null);
  // 확정 상태는 `AnalysisState`가 아니라 후보 기능 안에 둡니다. 이유는 `experience-selection.ts`에 있습니다.
  const [selection, setSelection] = useState<ExperienceSelectionState>({ status: "idle" });
  useEffect(() => {
    onInterviewActiveChange?.(selection.status === "confirmed");
  }, [selection.status, onInterviewActiveChange]);
  const selectedItem = items.find(({ candidate }) => candidate.sha === selectedSha);

  // 인터뷰에서 돌아오거나 확정 실패 안내를 닫을 때 씁니다. 선택한 후보는 그대로 두고 확정 상태만
  // 비웁니다. master-detail에서는 목록이 항상 보이므로 선택 자체를 비울 필요가 없습니다.
  function returnToCandidates() {
    setSelection({ status: "idle" });
    onExperienceConfirmed?.(null);
  }

  /**
   * 확정 시점에 상위로 알립니다. 스냅샷을 만들지 못했으면 알리지 않습니다. 인터뷰가 시작되지 않으니
   * 저장할 것도 없습니다.
   */
  function confirmSelection(item: ExperienceCandidateListItem, title: string) {
    const next = confirmExperienceSelection(item, data, candidates);
    setSelection(next);
    if (next.status === "confirmed") {
      onExperienceConfirmed?.({ candidateKey: item.candidate.sha, title, snapshot: next.snapshot });
    }
  }

  if (selection.status === "confirmed") {
    return (
      <InterviewScreen
        snapshot={selection.snapshot}
        interviewId={interviewId}
        onLoadLatest={onLoadLatestInterview}
        onUnsavedChange={onUnsavedInterviewChange}
        onProgressChange={onInterviewProgressChange}
        onEnded={onInterviewEnded}
        onBack={returnToCandidates}
      />
    );
  }

  return (
    <section className={styles.state} aria-live="polite">
      <div className={styles.layout}>
        <div className={styles.listPanel}>
          <p className={styles.eyebrow}>Candidates</p>
          <p className={styles.listSubtitle}>{`${pluralCount(candidates.candidates.length, "experience")} found`}</p>
          {candidates.insufficientCandidatesReason ? (
            <p className={styles.insufficientReason}>
              <strong>Why there are not more candidates: </strong>
              {candidates.insufficientCandidatesReason} The bar is not lowered and candidates are not padded.
            </p>
          ) : null}
          <ul className={styles.candidateList} aria-label="Candidates">
            {items.map(({ candidate, commit, normalizedRelatedShas, normalizedTechnicalTopics }) => {
              const title = candidateTitle(candidate, commit);
              const selected = candidate.sha === selectedSha;
              const commitCount = 1 + normalizedRelatedShas.length;
              const relatedDates = normalizedRelatedShas
                .map((sha) => commitsBySha.get(sha)?.date)
                .filter((date): date is string => date !== undefined);
              const period = deriveCandidatePeriod(commit ? [commit.date, ...relatedDates] : relatedDates);
              return (
                <li key={candidate.sha}>
                  <button
                    type="button"
                    className={selected ? styles.selectedRow : styles.row}
                    aria-current={selected ? "true" : undefined}
                    aria-label={title}
                    onClick={() => {
                      setSelectedSha(candidate.sha);
                      setSelection({ status: "idle" });
                    }}
                  >
                    <span className={styles.title}>{title}</span>
                    <span className={styles.rowMeta}>
                      <span>{pluralCount(commitCount, "commit")}</span>
                      {period ? <span>{period.start}</span> : null}
                    </span>
                    {/* 토픽이 없는 후보는 줄 자체를 그리지 않습니다. 행 높이가 후보마다 달라지는 편이
                        빈 줄로 자리를 잡아 두는 것보다 낫습니다. 없다는 사실은 상세가 알립니다. */}
                    {normalizedTechnicalTopics.length > 0 ? (
                      <span className={styles.rowTopics}>
                        {normalizedTechnicalTopics.slice(0, ROW_TOPIC_COUNT).join(" · ")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {selectedItem ? (
          <ExperienceCandidateDetail
            key={selectedItem.candidate.sha}
            repository={repository}
            commitsBySha={commitsBySha}
            item={selectedItem}
            onBack={returnToCandidates}
            onConfirm={() => confirmSelection(selectedItem, candidateTitle(selectedItem.candidate, selectedItem.commit))}
            onSelectRepository={onSelectRepository}
            selectionError={selection.status === "error" ? selection.reason : undefined}
          />
        ) : null}
      </div>
      {stageASelection ? <StageAExclusions {...stageASelection} /> : null}
    </section>
  );
}

/**
 * 이슈 #58이 못박은 원칙("어떤 커밋도 사용자 모르게 배제하지 않는다")을 지키려고 판단 단위가
 * 빠진 지점을 보여줍니다. 후보 목록이 주인공이므로 이 구획은 목록과 요약 아래, 화면 맨 끝에 둡니다.
 *
 * Pull Request에 속하지 않은 커밋은 더는 여기서 배제하지 않습니다. 커밋 하나짜리 판단 단위가
 * 되어 다른 단위와 똑같이 점수 선별을 거칩니다. 근거는
 * `llm-wiki/wiki/2026-09-10-PR-없는-저장소-커밋-묶음-방식-실험.md` 6절입니다.
 *
 * 점수 컷에서 밀린 묶음(`over_input_budget`)과 분량 상한에서 밀린 묶음(`over_byte_budget`)은
 * 같은 "제외"라도 사용자에게 다른 의미라 구획을 나눕니다. 점수는 우리 휴리스틱이지 Repository
 * 사실이 아니므로 `확인 가능` 태그를 씌우지 않고 별도로 표시합니다. PR 번호·제목은 GitHub 응답
 * 값이라 `확인 가능`을 씌웁니다.
 *
 * 후보 0개인 빈 상태(`repository-analysis-view.tsx`의 `EmptyState`)도 같은 원칙이 적용되는
 * 지점이라 이 컴포넌트를 그대로 재사용합니다. 같은 정보를 두 곳에서 다르게 그리면 어긋납니다
 * (이슈 #58 Codex 리뷰 P1-2).
 */
/** Pull Request 묶음은 번호로, 단일 커밋은 SHA 7자리로 사람이 읽을 라벨을 만듭니다. */
function unitLabel(unit: ExcludedWorkUnit<ReadonlyCommitDetail>["unit"]): string {
  return unit.kind === "pull_request"
    ? `PR #${unit.pullRequest.number}`
    : `Commit ${modelFacingUnitId(unit.unitId).slice("commit:".length)}`;
}

export function StageAExclusions({
  excludedUnits,
  selectedUnitCount,
  unjudgedShas,
}: StageASelectionDisplay) {
  const overInputBudget = excludedUnits
    .filter((item) => item.reason === "over_input_budget")
    .sort((a, b) => b.score - a.score);
  // 전체 묶음 수입니다. 판단한 것과 빠진 것을 합치면 저장소의 묶음 전부가 됩니다.
  const totalUnitCount = selectedUnitCount + excludedUnits.length;
  const overBudget = excludedUnits
    .filter((item) => item.reason === "over_byte_budget")
    .sort((a, b) => b.score - a.score);

  if (
    overInputBudget.length === 0 &&
    overBudget.length === 0 &&
    unjudgedShas.length === 0
  ) {
    return null;
  }

  return (
    <section className={styles.exclusions} aria-labelledby="stage-a-exclusions-heading">
      <h3 id="stage-a-exclusions-heading">Excluded in the first pass</h3>

      {overInputBudget.length > 0 ? (
        <details className={styles.exclusionDetails}>
          {/*
            접힌 상태에서도 보이는 줄이라 여기에 전체 대비 몇 묶음을 판단했는지 적습니다. 제외
            개수만 적으면 그것이 전체의 얼마인지 알 수 없어, 저장소가 커서 잘렸다는 사실이 드러나지
            않습니다. 2026-09-02까지 이 줄은 "점수 N점 미만 M묶음을 제외했습니다"였고, 점수에 합격선이
            있다는 뜻으로 읽혔습니다. 실제 방아쇠는 입력 상한입니다.

            2026-09-11에 선별을 동점 무리 일괄 처리에서 개별 항목 예산 검사로 바꾸면서 "점수 상위
            N묶음"이라는 표현과 `thresholdScore` 경계 문장을 지웠습니다. 이제 선택은 점수가 높고
            요약이 큰 묶음이 빠지고 점수가 낮고 작은 묶음이 들어가는 비단조 결과일 수 있어, 단일
            점수 경계로 설명하면 사실과 다릅니다. 근거는
            `llm-wiki/raw/2026-09-11-Stage-A-개별-예산-선별-설계-session-log.md`에 있습니다.
          */}
          <summary>
            <span>{`The repository is large, so only ${selectedUnitCount} of ${totalUnitCount} work units were judged`}</span>
          </summary>
          <p className={styles.exclusionReason}>
            {WORK_UNIT_SELECTION_EXCLUSION_COPY.over_input_budget}
            {" Units were picked by score within the analyzable budget, and ties went to the more recent commit."}
            <span className={styles.heuristicNotice}> The score is an automatically computed heuristic, not a fact from the Repository.</span>
          </p>
          <ul className={`${styles.exclusionList} ${styles.scrollableList}`}>
            {overInputBudget.map(({ unit, score, signals }) => (
              <li key={unit.unitId}>
                <span className={styles.verifiedTag}>{VERIFIABILITY_LABEL.verified}</span>
                <span>{unitLabel(unit)}</span>
                <span>{unit.title}</span>
                <span className={styles.heuristicScore}>{`${score} · heuristic`}</span>
                {signals.length > 0 ? (
                  <span className={styles.signalList}>
                    {signals.map((signal) => <span key={signal}>{WORK_UNIT_SIGNAL_COPY[signal]}</span>)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {overBudget.length > 0 ? (
        <details className={styles.exclusionDetails}>
          <summary>
            <span>{`${pluralCount(overBudget.length, "work unit")} excluded for exceeding what one request can carry`}</span>
          </summary>
          <p className={styles.exclusionReason}>{WORK_UNIT_SELECTION_EXCLUSION_COPY.over_byte_budget}</p>
          <ul className={`${styles.exclusionList} ${styles.scrollableList}`}>
            {overBudget.map(({ unit, score, signals }) => (
              <li key={unit.unitId}>
                <span className={styles.verifiedTag}>{VERIFIABILITY_LABEL.verified}</span>
                <span>{unitLabel(unit)}</span>
                <span>{unit.title}</span>
                <span className={styles.heuristicScore}>{`${score} · heuristic`}</span>
                {signals.length > 0 ? (
                  <span className={styles.signalList}>
                    {signals.map((signal) => <span key={signal}>{WORK_UNIT_SIGNAL_COPY[signal]}</span>)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {unjudgedShas.length > 0 ? (
        <details className={styles.exclusionDetails}>
          <summary>
            <span>{`${pluralCount(unjudgedShas.length, "work unit")} the model did not judge`}</span>
          </summary>
          <p className={styles.exclusionReason}>
            The model returned no judgment for these units. They were not excluded — there is simply no judgment.
          </p>
          <ul className={styles.exclusionList}>
            {unjudgedShas.map((sha) => (
              <li key={sha}><code>{sha.slice(0, 7)}</code></li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

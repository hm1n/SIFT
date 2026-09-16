import {
  CandidateRequestError,
  fetchStageACandidatesFromApi,
  fetchStageBCandidatesFromApi,
  toStageAUnits,
  type CandidateStage,
  type StageACandidateResult,
} from "@/features/experience-candidates/candidate-client";
import {
  toExcludedUnitSummary,
  type ExcludedUnitSummary,
} from "@/features/experience-candidates/work-unit-selection";
import type {
  StageBCandidateResult,
} from "@/features/experience-candidates/types";
import {
  CANDIDATE_GENERATION_ERROR_COPY,
  DIFF_REFETCH_GUIDANCE,
  GITHUB_FETCH_ERROR_COPY,
  PARTIAL_FETCH_COPY,
} from "@/copy/repository";
import { buildCandidateData } from "@/lib/github/candidate-data";
import { filterCommitsForDetail } from "@/lib/github/commit-blacklist";
import type { AuthoredCommitsResult } from "@/lib/github/commits";
import { GitHubFetchError, type GitHubFetchErrorKind } from "@/lib/github/errors";
import { fetchAuthoredCommitsFromApi, fetchContributionsFromApi } from "@/lib/github/route-client";
import type {
  CandidateCommitIndex,
  CandidateDataOutput,
  CommitSummary,
  ContributionFetchProgress,
  RepositoryRef,
  RepositoryContributionData,
} from "@/lib/github/types";

export type LoadingPhase =
  | { step: "commits" }
  | {
      step: "details";
      completed: number;
      total: number;
      phase: ContributionFetchProgress["phase"];
    }
  | { step: "deriving" }
  | { step: "stage_a"; total: number }
  // 서버가 diff·PR 수집(5단계)과 판단(6단계)을 한 요청으로 처리해 클라이언트는 경계를 관측할 수 없습니다.
  // 시간 같은 대리 지표로 가짜 전환을 만들지 않고 두 단계를 하나의 Loading으로 표현합니다.
  | { step: "stage_b" };

/**
 * 실제 분석 단계 여섯 개입니다. 순서는 `route-client.ts`의 `fetchContributionsFromApi`가 보고하는
 * 순서(commit_details 완료 뒤 repository_metadata)와 같습니다.
 *
 * `LoadingPhase`의 `details` 스텝 하나가 `commit_details`·`repository_metadata` 두 단계로 갈리므로
 * 매핑이 필요합니다. 그 매핑을 화면(`repository-analysis-view.tsx`의 Loading 체크리스트)에 두면
 * 화면 개편이 계측 어휘를 함께 바꿉니다. 단계는 화면이 아니라 분석 로직이 정하는 값이므로 여기
 * 둡니다. 화면과 `analysis_stage_done`이 같은 함수를 봅니다(이슈 #125).
 */
export const ANALYSIS_STAGES = [
  "commits",
  "commit_details",
  "repository_metadata",
  "deriving",
  "stage_a",
  "stage_b",
] as const;

export type AnalysisStage = (typeof ANALYSIS_STAGES)[number];

export function analysisStageOf(loading: LoadingPhase): AnalysisStage {
  if (loading.step === "details") {
    return loading.phase === "repository_metadata" ? "repository_metadata" : "commit_details";
  }
  return loading.step;
}

export type EmptyKind =
  | "no_commits"
  | "no_author_commits"
  | "no_analyzable_commits"
  | "no_stage_a_candidates";

/**
 * Empty 갈래 전체입니다. `no_final_candidates`는 `reason`을 함께 실어야 해서 `AnalysisState`에서
 * 별도 변형으로 갈라져 있고 `EmptyKind`에 들어가 있지 않습니다. 화면 안내표와 `analysis_empty`의
 * `empty_kind`는 다섯 갈래를 모두 다뤄야 하므로 둘이 같은 타입을 봅니다.
 */
export type AnalysisEmptyKind = EmptyKind | "no_final_candidates";

export type RecoveryAction = "retry" | "reauthenticate" | "select_repository";

/**
 * 이슈 #18이 구분하는 후보 생성 오류 4종과 요청 크기 초과, 그리고 서버 계약 위반입니다.
 * `contract_violation`은 GitHub를 호출하지 않고도 나는 오류(잘못된 요청, 응답 형식 위반, 예기치 않은
 * 예외)라 GitHub 조회 오류의 `server_error`와 구분합니다. 같은 값을 재사용하면 화면이 GitHub 문제로
 * 잘못 안내합니다(PR #105 Codex 리뷰).
 */
export type CandidateGenerationErrorKind =
  | "llm_call_failure"
  | "llm_schema_violation"
  | "llm_hallucination_rejected"
  | "diff_refetch_failure"
  | "request_too_large"
  | "contract_violation";

export interface AnalysisError {
  kind: GitHubFetchErrorKind | CandidateGenerationErrorKind;
  causeKind?: Exclude<GitHubFetchErrorKind, "partial_failure">;
  title: string;
  message: string;
  recovery: RecoveryAction;
  completed?: number;
  total?: number;
}

/** 실패한 후보 생성 단계부터 다시 시작할 때 필요한 입력입니다. stageA가 있으면 Stage B부터 재시도합니다. */
export interface CandidateRetryPoint {
  readonly repository: RepositoryRef;
  readonly contributionItems: readonly string[];
  readonly data: CandidateDataOutput;
  readonly stageA?: StageACandidateResult;
}

/**
 * 성공 상태가 화면에 실어 보내는 Stage A 선별 정보입니다. `unjudgedShas`는 `StageACandidateOutput`에
 * 이미 있지만 성공 경로에서는 그동안 어디에도 실리지 않았습니다. 화면이 "판단 불가" 건수를
 * 보여주려면(Task 9-2) 이 값이 성공 상태까지 와야 합니다.
 */
export interface StageASelectionState {
  /**
   * 점수 선별에서 빠진 묶음입니다. 화면이 그리는 필드만 남긴 모양입니다(이슈 #116).
   *
   * Stage A가 돌려주는 `ExcludedWorkUnit`은 묶음 안의 커밋 상세를 통째로 들고 있습니다. 화면은 그
   * 커밋을 한 번도 읽지 않고, 저장된 분석도 이 모양으로 저장합니다. 여기서 줄여 두면 저장된 분석으로
   * 후보 화면을 다시 그릴 때 모양을 맞추는 코드가 따로 필요 없습니다.
   */
  readonly excludedUnits: readonly ExcludedUnitSummary[];
  /** 선택된 묶음 중 가장 낮은 점수입니다. */
  readonly thresholdScore: number;
  /** 점수 선별을 통과해 실제로 모델에 보낸 묶음 수입니다. */
  readonly selectedUnitCount: number;
  readonly unjudgedShas: readonly string[];
}

/**
 * Stage A가 한 번에 보내는 단위는 커밋이 아니라 Pull Request 묶음입니다.
 *
 * 커밋 수를 대신 보여주면 커밋 여러 개짜리 PR이 있는 저장소에서 화면이 실제보다 훨씬 많은 수를
 * 알립니다. `andbread`는 상세 조회 커밋 327개가 묶음 67개입니다.
 *
 * `toStageAUnits`는 네트워크를 쓰지 않는 순수 함수라 클라이언트가 쓰는 값을 여기서 다시 구할 수
 * 있습니다. 기여 항목이 선별 예산을 먹으므로 함께 넘겨야 같은 수가 나옵니다.
 */
function stageAUnitTotal(
  data: CandidateDataOutput,
  contributionItems: readonly string[]
): number {
  return toStageAUnits(data.includedCommits, contributionItems).units.length;
}

export type AnalysisState =
  | { status: "idle" }
  | { status: "loading"; loading: LoadingPhase }
  // stageASelection은 선택 필드입니다. Stage A를 부르기 전에 나는 no_commits·no_author_commits·
  // no_analyzable_commits 세 갈래는 선별 정보가 존재하지 않아 값을 채우지 않습니다. no_stage_a_candidates는
  // Stage A 직후 갈래라 항상 값을 싣습니다(이슈 #58 Codex 리뷰 P1-2).
  | { status: "empty"; kind: EmptyKind; stageASelection?: StageASelectionState }
  | { status: "empty"; kind: "no_final_candidates"; reason: string; stageASelection?: StageASelectionState }
  | { status: "error"; error: AnalysisError; retryPoint?: CandidateRetryPoint }
  | {
      status: "success";
      /**
       * 후보 화면이 읽는 커밋 색인입니다. 저장된 분석으로 이 상태를 다시 만들 수 있어야 하므로
       * `CandidateDataOutput` 전체가 아니라 화면이 쓰는 만큼만 싣습니다(이슈 #116).
       */
      data: CandidateCommitIndex;
      candidates: StageBCandidateResult;
      stageASelection: StageASelectionState;
    };

interface AnalysisDependencies {
  fetchCommits(repository: RepositoryRef): Promise<AuthoredCommitsResult>;
  filterCommits(commits: readonly CommitSummary[]): CommitSummary[];
  fetchContributions(
    repository: RepositoryRef,
    commits: readonly CommitSummary[],
    onProgress: (progress: ContributionFetchProgress) => void
  ): Promise<RepositoryContributionData>;
  buildData: typeof buildCandidateData;
  yieldToBrowser(): Promise<void>;
  fetchStageACandidates: typeof fetchStageACandidatesFromApi;
  fetchStageBCandidates: typeof fetchStageBCandidatesFromApi;
}

const defaultDependencies: AnalysisDependencies = {
  fetchCommits: fetchAuthoredCommitsFromApi,
  filterCommits: filterCommitsForDetail,
  fetchContributions: fetchContributionsFromApi,
  buildData: buildCandidateData,
  yieldToBrowser: () => new Promise((resolve) => setTimeout(resolve, 0)),
  fetchStageACandidates: fetchStageACandidatesFromApi,
  fetchStageBCandidates: fetchStageBCandidatesFromApi,
};

interface FailureContext {
  step: "commits" | "details";
  total?: number;
}

function underlyingKind(error: GitHubFetchError): AnalysisError["causeKind"] {
  let cause: unknown = error.cause;
  while (cause instanceof GitHubFetchError) {
    if (cause.kind !== "partial_failure") return cause.kind;
    cause = cause.cause;
  }
  return undefined;
}

/** 종류별 복구 수단입니다. 문구는 `@/copy/repository`가, 무엇을 할 수 있는지는 여기가 정합니다. */
const FETCH_ERROR_RECOVERY = {
  rate_limit: "retry",
  auth_revoked: "reauthenticate",
  repo_not_found: "select_repository",
  network: "retry",
  server_error: "retry",
} as const satisfies Record<Exclude<GitHubFetchErrorKind, "partial_failure">, AnalysisError["recovery"]>;

function errorCopy(kind: Exclude<GitHubFetchErrorKind, "partial_failure">) {
  return { ...GITHUB_FETCH_ERROR_COPY[kind], recovery: FETCH_ERROR_RECOVERY[kind] };
}

export function toAnalysisError(error: unknown, context: FailureContext): AnalysisError {
  if (!(error instanceof GitHubFetchError)) {
    return { kind: "server_error", ...errorCopy("server_error") };
  }

  if (error.kind !== "partial_failure") {
    return { kind: error.kind, ...errorCopy(error.kind) };
  }

  const completed = error.partialCommits?.length ?? 0;
  const causeKind = underlyingKind(error);
  const range =
    context.step === "details" && context.total !== undefined
      ? PARTIAL_FETCH_COPY.detailRange(completed, context.total)
      : PARTIAL_FETCH_COPY.commitRange(completed);
  const causeGuidance = causeKind ? PARTIAL_FETCH_COPY.cause(errorCopy(causeKind).title) : "";

  return {
    kind: "partial_failure",
    ...(causeKind === undefined ? {} : { causeKind }),
    title: PARTIAL_FETCH_COPY.title,
    message: `${range}${causeGuidance}${PARTIAL_FETCH_COPY.guidance}`,
    recovery: causeKind ? errorCopy(causeKind).recovery : "retry",
    completed,
    ...(context.total === undefined ? {} : { total: context.total }),
  };
}

export async function analyzeRepository(
  repository: RepositoryRef,
  contributionItems: readonly string[],
  onStateChange: (state: AnalysisState) => void,
  dependencies: AnalysisDependencies = defaultDependencies
): Promise<void> {
  let failureContext: FailureContext = { step: "commits" };
  onStateChange({ status: "loading", loading: { step: "commits" } });

  try {
    const { commits: allCommits, repositoryHasCommits } = await dependencies.fetchCommits(repository);
    if (allCommits.length === 0) {
      onStateChange({
        status: "empty",
        kind: repositoryHasCommits ? "no_author_commits" : "no_commits",
      });
      return;
    }

    const includedCommits = dependencies.filterCommits(allCommits);
    if (includedCommits.length === 0) {
      onStateChange({ status: "empty", kind: "no_analyzable_commits" });
      return;
    }

    failureContext = { step: "details", total: includedCommits.length };
    const contributionData = await dependencies.fetchContributions(
      repository,
      includedCommits,
      (progress) => {
        onStateChange({
          status: "loading",
          loading:
            progress.phase === "commit_details"
              ? {
                  step: "details",
                  completed: progress.completed,
                  total: progress.total,
                  phase: progress.phase,
                }
              : {
                  step: "details",
                  completed: includedCommits.length,
                  total: includedCommits.length,
                  phase: progress.phase,
                },
        });
      }
    );

    onStateChange({ status: "loading", loading: { step: "deriving" } });
    await dependencies.yieldToBrowser();
    const data = dependencies.buildData({ allCommits, contributionData });
    await generateCandidates({ repository, contributionItems, data }, onStateChange, dependencies);
  } catch (error) {
    onStateChange({ status: "error", error: toAnalysisError(error, failureContext) });
  }
}

/**
 * 4~6단계: Stage A 1차 선별, diff·PR 입력 수집, Stage B 최종 판단을 진행합니다.
 * retryPoint에 stageA가 있으면 4단계를 건너뛰고 Stage B부터 재시도합니다.
 */
export async function generateCandidates(
  retryPoint: CandidateRetryPoint,
  onStateChange: (state: AnalysisState) => void,
  dependencies: AnalysisDependencies = defaultDependencies
): Promise<void> {
  const { repository, contributionItems, data } = retryPoint;
  let stageA = retryPoint.stageA;
  try {
    if (!stageA) {
      onStateChange({ status: "loading", loading: {
        step: "stage_a", total: stageAUnitTotal(data, contributionItems),
      } });
      stageA = await dependencies.fetchStageACandidates(data.includedCommits, contributionItems);
    }
    // 세 상태(빈 둘·성공)가 같은 선별 값을 싣도록 여기서 한 번만 만듭니다. 후보가 0개일 때가 제외
    // 사유를 가장 알아야 할 순간이라 두 빈 갈래에도 성공 경로와 동일한 객체를 실어 보냅니다(이슈 #58 P1-2).
    const stageASelection: StageASelectionState = {
      excludedUnits: stageA.excludedUnits.map(toExcludedUnitSummary),
      thresholdScore: stageA.thresholdScore,
      selectedUnitCount: stageA.selectedUnitCount,
      unjudgedShas: stageA.unjudgedShas,
    };
    if (stageA.candidates.length === 0) {
      onStateChange({ status: "empty", kind: "no_stage_a_candidates", stageASelection });
      return;
    }
    onStateChange({ status: "loading", loading: { step: "stage_b" } });
    const candidates = await dependencies.fetchStageBCandidates(repository, stageA.candidates);
    if (candidates.candidates.length === 0) {
      onStateChange({
        status: "empty",
        kind: "no_final_candidates",
        // 출력 계약이 후보 3개 미만이면 부족 사유를 보장하므로 0개에서 사유는 항상 존재합니다.
        reason: candidates.insufficientCandidatesReason!,
        stageASelection,
      });
      return;
    }
    onStateChange({
      status: "success",
      data,
      candidates,
      stageASelection,
    });
  } catch (error) {
    /**
     * 계약 위반(422)은 보존한 입력을 그대로 다시 보내면 반드시 같은 결과라 retryPoint를 남기지
     * 않습니다. retryPoint가 없으면 재시도가 전체 재분석이 되어 입력을 처음부터 다시 구성합니다.
     *
     * 2026-09-02에 Stage A 체크포인트를 걷어냈습니다. 청크를 나눠 보내던 시절에는 앞 청크가 끝난
     * 뒤 실패하면 그 결과를 체크포인트로 남겨 재개했습니다. 지금은 Stage A 호출이 한 번이라 실패가
     * 전부 아니면 전무이고, 남길 부분 결과가 없습니다. 그래서 "전체 N묶음 중 M묶음을 판단했습니다"
     * 문구도 함께 없앴습니다. 그 문구의 M은 이제 언제나 0입니다.
     */
    const samePayloadAlwaysFails =
      error instanceof CandidateRequestError &&
      (error.kind === "invalid_request" || error.retryable === false);
    onStateChange({
      status: "error",
      error: toCandidateGenerationError(error, stageA ? "stage_b" : "stage_a"),
      ...(samePayloadAlwaysFails
        ? {}
        : { retryPoint: { repository, contributionItems, data, ...(stageA ? { stageA } : {}) } }),
    });
  }
}

export function toCandidateGenerationError(error: unknown, stage: CandidateStage): AnalysisError {
  const fallback: AnalysisError = {
    kind: "contract_violation",
    ...CANDIDATE_GENERATION_ERROR_COPY.unknown,
    recovery: "retry",
  };
  if (!(error instanceof CandidateRequestError)) return fallback;

  switch (error.kind) {
    case "unauthorized":
      return { kind: "auth_revoked", ...errorCopy("auth_revoked") };
    case "auth_revoked":
    case "rate_limit":
    case "repo_not_found":
    case "network":
    case "server_error":
    case "partial_failure": {
      // GitHub 조회 오류가 Stage B에서 오면 diff·PR 재조회(5단계) 실패입니다.
      if (stage !== "stage_b") return fallback;
      const causeKind = error.kind === "partial_failure" ? "server_error" : error.kind;
      return {
        kind: "diff_refetch_failure",
        causeKind,
        title: CANDIDATE_GENERATION_ERROR_COPY.diffRefetch.title,
        message: CANDIDATE_GENERATION_ERROR_COPY.diffRefetch.message(DIFF_REFETCH_GUIDANCE[causeKind]),
        recovery: errorCopy(causeKind).recovery,
      };
    }
    case "schema_validation":
    case "json_parse":
      return {
        kind: "llm_schema_violation",
        title: CANDIDATE_GENERATION_ERROR_COPY.schemaViolation.title,
        message: CANDIDATE_GENERATION_ERROR_COPY.schemaViolation.message(error.message),
        recovery: "retry",
      };
    case "unknown_sha":
    case "unrelated_sha":
    case "unknown_file_path":
      return {
        kind: "llm_hallucination_rejected",
        title: CANDIDATE_GENERATION_ERROR_COPY.hallucinationRejected.title,
        message: CANDIDATE_GENERATION_ERROR_COPY.hallucinationRejected.message(error.message),
        recovery: "retry",
      };
    case "llm_timeout":
      // Stage B의 llm_timeout은 LLM 자체가 아니라 GitHub 조회를 포함한 라우트 전체 예산 소진을 뜻합니다.
      return stage === "stage_b"
        ? {
            kind: "llm_call_failure",
            ...CANDIDATE_GENERATION_ERROR_COPY.stageBTimeout,
            recovery: "retry",
          }
        : {
            kind: "llm_call_failure",
            ...CANDIDATE_GENERATION_ERROR_COPY.llmTimeout,
            recovery: "retry",
          };
    case "llm_rate_limit":
      return {
        kind: "llm_call_failure",
        ...CANDIDATE_GENERATION_ERROR_COPY.llmRateLimit,
        recovery: "retry",
      };
    case "llm_auth":
    case "llm_configuration":
      return {
        kind: "llm_call_failure",
        ...CANDIDATE_GENERATION_ERROR_COPY.llmConfiguration,
        recovery: "retry",
      };
    case "llm_network":
    case "llm_request":
    case "llm_failure":
      return {
        kind: "llm_call_failure",
        title: CANDIDATE_GENERATION_ERROR_COPY.llmCallFailure.title,
        message: CANDIDATE_GENERATION_ERROR_COPY.llmCallFailure.message(error.message),
        recovery: "retry",
      };
    case "body_too_large":
      return {
        kind: "request_too_large",
        ...CANDIDATE_GENERATION_ERROR_COPY.requestTooLarge,
        recovery: "select_repository",
      };
    case "fetch_network":
      return {
        kind: "network",
        ...CANDIDATE_GENERATION_ERROR_COPY.network,
        recovery: "retry",
      };
    case "invalid_request":
      return {
        kind: "contract_violation",
        title: CANDIDATE_GENERATION_ERROR_COPY.contractViolation.title,
        message: CANDIDATE_GENERATION_ERROR_COPY.contractViolation.message(error.message),
        recovery: "retry",
      };
    default:
      // invalid_response, invalid_json 등 사용자가 복구 방법을 고를 수 없는 오류입니다.
      return { ...fallback, message: CANDIDATE_GENERATION_ERROR_COPY.fallback(error.message) };
  }
}

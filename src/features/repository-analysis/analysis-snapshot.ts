import type { StageBCandidateResult } from "@/features/experience-candidates/types";
import type { ExcludedUnitSummary } from "@/features/experience-candidates/work-unit-selection";
import type {
  CandidateCommitIndex,
  CommitFileChangeWithoutPatch,
  ReadonlyCommitDetail,
} from "@/lib/github/types";
import type { StageASelectionState } from "./repository-analysis";

/**
 * 분석 한 줄에 저장하는 축약본입니다. 표의 모양은 기능 정의서 `인터뷰 저장과 이어가기`에 있습니다.
 *
 * 정의서가 "분석 결과에서 화면을 다시 그리는 데 필요한 것만 저장하고 원본 커밋 전량은 저장하지
 * 않는다"고 정했습니다. 이 파일이 그 "필요한 것"의 목록을 코드로 고정합니다. 분석 결과를 읽어 후보
 * 화면을 다시 그리는 일은 이슈 #116이지만, 값을 쓰는 것은 이 이슈이므로 계약도 여기서 정합니다.
 *
 * 빼는 것이 셋입니다.
 *
 * - `allCommits`는 블랙리스트와 무관한 사용자 커밋 전량입니다. Stage B가 끝난 뒤로 후보 화면도
 *   근거 스냅샷도 이 값을 읽지 않습니다.
 * - `repository`의 파일 트리와 언어 통계도 Stage B 입력으로만 쓰이고 그 뒤로 읽히지 않습니다.
 * - `includedCommits`는 최종 후보가 가리키는 커밋만 남기고, 남긴 커밋에서도 파일의 `patch` 본문을
 *   지웁니다. 저장소에 따라 수백 건이고 후보 밖 커밋은 다시 화면에 쓰이지 않습니다. patch 본문은
 *   `candidates.diffs`에 이미 있고 Stage B가 총량을 `STAGE_B_MAX_TOTAL_PATCH_CHARS`로 묶어 둡니다.
 *   두 곳에 같은 본문을 두면 상한이 두 배가 됩니다.
 */
export type StoredCommitDetail = Readonly<
  Omit<ReadonlyCommitDetail, "files"> & {
    readonly files: readonly Readonly<CommitFileChangeWithoutPatch>[];
  }
>;

/**
 * 표의 `candidates` 칸에 담는 값입니다. 후보 목록과 그 후보가 가리키는 커밋을 한 칸에 둡니다.
 *
 * 커밋을 따로 둘 칸이 없어서 여기에 함께 넣습니다. 표의 칸 셋은 정의서가 정한 것이고 이 이슈에서
 * 늘리지 않습니다. 후보 화면이 `candidates`와 `includedCommits`를 언제나 함께 읽으므로 한 칸에
 * 두는 편이 읽고 쓸 때 조립 비용도 없습니다.
 */
export interface StoredAnalysisCandidates {
  readonly candidates: StageBCandidateResult;
  readonly includedCommits: readonly StoredCommitDetail[];
}

/**
 * 제외된 묶음 하나입니다. 정의서가 저장 대상을 "Stage A 선별 요약 수치"라고 적은 자리입니다.
 *
 * 화면이 쓰는 타입(`ExcludedUnitSummary`)을 그대로 씁니다. 이슈 #116 전에는 여기서 원래 값인
 * `ExcludedWorkUnit`을 줄여 저장했는데, 저장된 분석으로 같은 화면을 다시 그리게 되면서 화면이 받는
 * 타입도 같은 모양으로 좁혔습니다. 둘이 갈라지면 저장과 복원 사이에 모양을 맞추는 코드가 한 벌 더
 * 생기고, 그 코드가 어긋나도 양쪽 테스트는 각자 통과합니다.
 */
export type StoredExcludedUnit = ExcludedUnitSummary;

/** 표의 `stage_a_summary` 칸에 담는 값입니다. */
export interface StoredStageASummary {
  readonly excludedUnits: readonly StoredExcludedUnit[];
  readonly selectedUnitCount: number;
  readonly thresholdScore: number;
  readonly unjudgedShas: readonly string[];
}

/** 저장 계층의 `NewAnalysis`에서 사용자 번호만 뺀 것입니다. 사용자 번호는 세션에서 오므로 요청 본문에 담지 않습니다. */
export interface StoredAnalysis {
  readonly repoOwner: string;
  readonly repoName: string;
  readonly contributionItems: readonly string[];
  readonly candidates: StoredAnalysisCandidates;
  readonly stageASummary: StoredStageASummary;
}

export interface BuildStoredAnalysisInput {
  readonly repoOwner: string;
  readonly repoName: string;
  readonly contributionItems: readonly string[];
  readonly data: CandidateCommitIndex;
  readonly candidates: StageBCandidateResult;
  readonly stageASelection: StageASelectionState;
}

/** 최종 후보가 가리키는 커밋입니다. 대표 커밋과 관련 커밋을 모두 셉니다. */
function referencedShas(candidates: StageBCandidateResult): Set<string> {
  const shas = new Set<string>();
  for (const candidate of candidates.candidates) {
    shas.add(candidate.sha);
    for (const sha of candidate.relatedShas) shas.add(sha);
  }
  return shas;
}

/**
 * 남길 파일 필드를 골라 적습니다. `patch`만 빼는 방식으로 쓰지 않는 이유는, 나중에 파일 항목에 본문을
 * 담는 칸이 하나 더 생기면 그 칸이 말없이 저장으로 새기 때문입니다. 저장 범위는 빼는 목록이 아니라
 * 담는 목록으로 적습니다.
 */
function withoutPatch(commit: ReadonlyCommitDetail): StoredCommitDetail {
  return {
    ...commit,
    files: commit.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    })),
  };
}

export function buildStoredAnalysis({
  repoOwner,
  repoName,
  contributionItems,
  data,
  candidates,
  stageASelection,
}: BuildStoredAnalysisInput): StoredAnalysis {
  const referenced = referencedShas(candidates);
  return {
    repoOwner,
    repoName,
    contributionItems,
    candidates: {
      candidates,
      includedCommits: data.includedCommits
        .filter((commit) => referenced.has(commit.sha))
        .map(withoutPatch),
    },
    stageASummary: {
      excludedUnits: stageASelection.excludedUnits,
      selectedUnitCount: stageASelection.selectedUnitCount,
      thresholdScore: stageASelection.thresholdScore,
      unjudgedShas: stageASelection.unjudgedShas,
    },
  };
}

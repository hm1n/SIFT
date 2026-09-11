import { renderInterviewEvidencePrompt } from "@/features/interview/question-prompt";
import {
  EVIDENCE_SNAPSHOT_MAX_INPUT_TOKENS,
  buildExperienceEvidenceSnapshot,
} from "./evidence-snapshot";
import type {
  EvidenceSnapshotFailureReason,
  ExperienceCandidateListItem,
  ExperienceEvidenceSnapshot,
  StageBCandidateResult,
} from "./types";
import type { CandidateDataOutput } from "@/lib/github/types";

/**
 * 인터뷰 대상 확정 상태입니다.
 *
 * `AnalysisState`에 넣지 않습니다. Repository 분석 진행 상태와 인터뷰 대상 확정은 서로 다른
 * 축이고, 얹으면 분석을 다시 실행할 때 확정 상태가 함께 초기화됩니다.
 *
 * Loading 상태를 따로 두지 않았습니다. 스냅샷 생성은 LLM을 호출하지 않는 동기 순수 함수여서
 * 관측할 진행 상태가 없습니다. 시간 같은 대리 지표로 가짜 전환을 만들지 않는 기존 결정을
 * 따릅니다(`repository-analysis.ts`의 `stage_b` 주석). 선택 흐름의 Loading은 분석 Loading이
 * 담당하고, 그 동안 후보 목록과 선택 액션은 렌더링되지 않습니다.
 *
 * Empty도 새로 만들지 않았습니다. 최종 후보 0개는 `no_final_candidates` Empty가 처리하므로
 * 후보 목록과 선택 액션에 도달하지 않습니다.
 */
export type ExperienceSelectionState =
  | { readonly status: "idle" }
  | { readonly status: "confirmed"; readonly snapshot: ExperienceEvidenceSnapshot }
  | { readonly status: "error"; readonly reason: EvidenceSnapshotFailureReason };

/** 근거 스냅샷을 만들지 못한 이유별 안내입니다. 무엇이 부족한지 알리고 목록 복귀로 유도합니다. */
export const EXPERIENCE_SELECTION_ERROR_COPY: Record<
  EvidenceSnapshotFailureReason,
  { readonly title: string; readonly message: string }
> = {
  representative_commit_not_indexed: {
    title: "Can't start an interview for this experience",
    message:
      "The representative commit wasn't found in the commit index, so its title, message, PR info, and changed files can't be used as evidence. Go back to the candidate list and choose a different experience.",
  },
  no_repository_evidence: {
    title: "Can't start an interview for this experience",
    message:
      "Neither the representative commit nor its related commits have any changed files, so there's no code to ask about. Go back to the candidate list and choose a different experience.",
  },
  evidence_input_too_large: {
    title: "This experience's evidence exceeds the interview input limit",
    message:
      "Even without any code changes, the commit messages and changed file list alone exceed the limit. Go back to the candidate list and choose a different experience.",
  },
};

/**
 * 상세 화면의 선택 액션이 호출합니다. 확정 시점에 근거 스냅샷을 만들고, 재선택하면 이전 확정
 * 상태를 그대로 교체합니다.
 */
export function confirmExperienceSelection(
  item: ExperienceCandidateListItem,
  data: CandidateDataOutput,
  candidates: StageBCandidateResult
): ExperienceSelectionState {
  // 근거 상한은 모델 입력을 묶는 값이므로 실제 첫 질문 프롬프트로 잽니다. JSON 직렬화로 재면
  // patch가 큰 근거에서 상한이 보증되지 않습니다(2026-08-28 실측).
  const result = buildExperienceEvidenceSnapshot(
    item,
    data,
    candidates,
    EVIDENCE_SNAPSHOT_MAX_INPUT_TOKENS,
    renderInterviewEvidencePrompt
  );
  return result.ok
    ? { status: "confirmed", snapshot: result.snapshot }
    : { status: "error", reason: result.reason };
}

import { BLOCK_KINDS, type BlockKind, type ExperienceBlockState } from "@/features/experience-block/types";
import type { InterviewListItem, StoredInterview } from "@/lib/db/store";

/**
 * 저장 계층의 값을 응답 본문 모양으로 옮깁니다.
 *
 * 시각을 `Date`가 아니라 ISO 문자열로 내보냅니다. JSON에는 날짜 타입이 없어 `Date`를 그대로 실으면
 * 어차피 문자열이 되는데, 타입만 `Date`로 남으면 받는 쪽이 `getTime()`을 부르다 깨집니다.
 *
 * 목록에 `updatedAt`을 싣고 `openedAt`은 싣지 않습니다. 화면이 보여 주는 "마지막으로 이어간 시각"은
 * `updatedAt`이고, `openedAt`은 90일 정리의 기준이라 화면이 쓰지 않습니다.
 */
export interface InterviewListItemPayload {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly title: string;
  readonly status: InterviewListItem["status"];
  /** 목록 행의 `PAAR n/4`에서 n입니다. 분모는 화면이 `BLOCK_KINDS.length`로 만듭니다. */
  readonly completedBlockCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredInterviewPayload extends InterviewListItemPayload {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly evidence: unknown;
  readonly history: StoredInterview["history"];
  readonly blockState: StoredInterview["blockState"];
  readonly blockVersion: number;
  /** 재질문 예산을 정하는 값입니다. 이것이 없으면 복원한 인터뷰가 이미 답하지 못한 요소를 다시 묻습니다. */
  readonly progress: StoredInterview["progress"];
  /** 저장된 분석에서 고른 후보 하나입니다. 이어가기 화면이 기술 토픽과 선정 이유를 여기서 읽습니다. */
  readonly candidate: unknown;
}

export function toInterviewListItemPayload(item: InterviewListItem): InterviewListItemPayload {
  return {
    id: item.id,
    repoOwner: item.repoOwner,
    repoName: item.repoName,
    title: item.title,
    status: item.status,
    completedBlockCount: item.completedBlockCount,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toStoredInterviewPayload(interview: StoredInterview): StoredInterviewPayload {
  return {
    ...toInterviewListItemPayload(interview),
    analysisId: interview.analysisId,
    candidateKey: interview.candidateKey,
    evidence: interview.evidence,
    history: interview.history,
    blockState: interview.blockState,
    blockVersion: interview.blockVersion,
    progress: interview.progress,
    candidate: interview.candidate,
  };
}

/**
 * 저장된 블록 상태를 화면이 그대로 쓸 수 있는지 봅니다(PR #127 리뷰).
 *
 * 저장 계층은 이 칸을 `jsonb`로 돌려주므로 타입만 믿을 수 없습니다. 지금 저장된 값은 우리가 쓴
 * 것이라 온전하지만, 블록 상태의 모양이 바뀌면 그 전에 저장한 줄이 남습니다. 그때 화면은
 * `display[block].map`과 `evaluation[block]`을 그대로 읽으므로 렌더 도중 TypeError로 멈춥니다.
 * 안내 한 줄을 보이는 것과 화면 전체가 깨지는 것은 다릅니다.
 *
 * **중첩된 원소까지 봅니다.** 바깥 모양만 보면 `claims: [null]`이 그대로 통과하고, `markDisplay`가
 * `claim.id`를 읽는 자리에서 결국 같은 곳이 깨집니다. 가드가 지키지 못하는 것을 지킨다고 적어 두면
 * 없느니만 못합니다(재검증 라운드 지적). 평가는 특히 조심해서 봅니다. `{}`가 통과하면
 * `isBlockClosed`가 `askable`을 `undefined`로 읽어 그 블록을 닫힌 것으로 처리하고, 이어간 인터뷰가
 * 물어야 할 것을 건너뜁니다. 렌더가 멈추지 않고 조용히 어긋나는 쪽이라 더 나쁩니다.
 *
 * 근거 스냅샷은 `isExperienceEvidenceSnapshot`이 같은 일을 이미 합니다. 이 함수는 블록 상태 쪽의
 * 같은 자리를 메웁니다. 요청 본문을 보는 `isExperienceBlockState`를 그대로 쓰지 않는 이유는 그쪽이
 * 근거 스냅샷에서 만든 커밋 색인을 함께 받아 주장의 출처까지 대조하기 때문입니다. 여기서 막으려는
 * 것은 그 대조가 아니라 화면이 읽는 모양입니다.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 주장의 출처입니다. 저장소 출처는 화면이 커밋과 파일을 그대로 그립니다. */
function isClaimSource(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.source === "user") return true;
  return (
    value.source === "repository" &&
    typeof value.commitSha === "string" &&
    (value.filePath === null || typeof value.filePath === "string")
  );
}

function isStoredClaim(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.text === "string" &&
    typeof value.turnId === "string" &&
    typeof value.status === "string" &&
    BLOCK_KINDS.includes(value.block as BlockKind) &&
    Array.isArray(value.sources) &&
    value.sources.every(isClaimSource)
  );
}

function isStoredConflict(value: unknown): boolean {
  return isRecord(value) && typeof value.claimId === "string" && typeof value.observation === "string";
}

function isStoredSentence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.text === "string" &&
    Array.isArray(value.claimIds) &&
    value.claimIds.every((id) => typeof id === "string")
  );
}

function isStoredEvaluation(value: unknown): boolean {
  if (value === null) return true;
  return (
    isRecord(value) &&
    typeof value.sufficient === "boolean" &&
    typeof value.askable === "boolean" &&
    typeof value.reason === "string"
  );
}

export function isRestorableBlockState(value: unknown): value is ExperienceBlockState {
  if (!isRecord(value)) return false;
  if (typeof value.version !== "number" || typeof value.nextClaimSeq !== "number") return false;
  if (!Array.isArray(value.claims) || !value.claims.every(isStoredClaim)) return false;
  if (!Array.isArray(value.conflicts) || !value.conflicts.every(isStoredConflict)) return false;
  if (!isRecord(value.display) || !isRecord(value.evaluation)) return false;
  const display = value.display;
  const evaluation = value.evaluation;
  return BLOCK_KINDS.every(
    (block) =>
      Array.isArray(display[block]) &&
      (display[block] as unknown[]).every(isStoredSentence) &&
      block in evaluation &&
      isStoredEvaluation(evaluation[block])
  );
}

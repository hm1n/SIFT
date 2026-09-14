import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { serializedByteLength } from "@/features/experience-candidates/evidence-snapshot";
import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES, INTERVIEW_MAX_TURNS } from "@/features/interview/history";
import { isExperienceEvidenceSnapshot, SNAPSHOT_BODY_BYTES } from "@/features/interview/question-request";
import { isInterviewProgress, type InterviewProgress } from "./progress";
import { byteLength, CLAIMS_STATE_MAX_BYTES, evidenceIndex } from "./reducer";
import {
  BLOCK_KINDS,
  isBlockElement,
  isBlockKind,
  type BlockElement,
  type BlockEvaluation,
  type BlockKind,
  type Claim,
  type ClaimConflict,
  type ClaimSource,
  type ClaimStatus,
  type DisplaySentence,
  type ExperienceBlockState,
  type ProgressReason,
} from "./types";

/**
 * `POST /api/interview/experience-block`의 요청 본문입니다. 설계는
 * `llm-wiki/wiki/2026-09-11-PAAR-경험블록-설계-개정.md` 5절입니다.
 *
 * 무상태 서버 전제에 따라 `state`의 진위와 최신성은 이 route가 보장하지 않습니다(설계 3-2절). 여기서
 * 하는 검증은 모양과 크기뿐이고, `state.version`과 요청 순서 충돌 처리는 클라이언트 훅의 몫입니다.
 */
export interface ExperienceBlockRequestBody {
  readonly snapshot: ExperienceEvidenceSnapshot;
  readonly history: readonly BlockUpdateTurn[];
  readonly state: ExperienceBlockState;
  readonly targetBlock: BlockKind;
  /**
   * 이번 질문이 겨냥한 블록 목적의 두 요소 중 하나입니다(`BLOCK_ELEMENT_PURPOSES`). 이슈 #90의
   * "같은 부족 요소에 최대 1회 재질문" 규칙을 추적하는 최소 단위이고, 이 값 자체는 클라이언트 훅이
   * 다음 질문을 고를 때 결정합니다. 이 route는 프롬프트에 실어 모델에게 초점을 알리는 데만 씁니다.
   */
  readonly targetElement: BlockElement;
  readonly answerTurnId: string;
  /**
   * 이 턴을 저장할 인터뷰입니다(이슈 #115). 없으면 저장하지 않고 블록만 갱신합니다.
   *
   * 저장 전용 API를 새로 만들지 않고 이미 있는 이 요청에 얹습니다. 무상태 서버라 클라이언트가 이미 매
   * 턴 근거와 이력과 블록 상태를 전부 보내고 있어, 저장에 필요한 값이 이 요청에 다 들어 있습니다.
   *
   * 없어도 되는 값으로 둡니다. 저장 계층이 막혀 인터뷰를 만들지 못한 사용자도 인터뷰는 그대로 할 수
   * 있어야 하고, 그 경우 이 값이 없는 채로 옵니다.
   */
  readonly save?: ExperienceBlockSaveTarget;
}

export interface ExperienceBlockSaveTarget {
  readonly interviewId: string;
  /**
   * 저장된 블록 버전으로 클라이언트가 알고 있는 값입니다. 이 값이 저장된 값과 다르면 다른 탭이 먼저
   * 저장한 것이므로 아무것도 쓰지 않습니다.
   *
   * 요청의 `state.version`으로 대신하지 않습니다. 앞선 턴에서 저장이 실패했으면 화면의 버전만 오르고
   * 저장된 버전은 그대로여서 둘이 어긋납니다. 저장된 값과 맞춰야 하는 것은 화면의 버전이 아니라
   * 마지막으로 저장에 성공한 버전입니다.
   */
  readonly expectedBlockVersion: number;
  /** 앞선 턴에서 저장이 실패해 아직 저장되지 않은 턴입니다. 이번 턴과 함께 이어 붙입니다. */
  readonly pendingTurnIds?: readonly string[];
  /**
   * 이번 답변을 반영하기 **전**의 질문 진행 상태입니다. 질문을 보낸 기록(`recordAsked`)까지는 들어
   * 있고 이번 답변의 반응은 아직 들어 있지 않습니다.
   *
   * 반영한 뒤의 값을 받지 않는 이유는, 반영에 필요한 `targetResponse`를 모델 출력에서 서버가 계산하기
   * 때문입니다. 클라이언트는 요청을 보내는 시점에 그 값을 알 수 없습니다. 그래서 반영 전 값을 받아
   * 서버가 `recordResponse`를 적용해 저장합니다. 이렇게 해야 저장된 진행 상태와 블록 상태가 같은
   * 응답에서 나온 값이 됩니다.
   */
  readonly progress: InterviewProgress;
  /**
   * 이번에 답한 질문을 보낸 시점의 그 요소 `askedCount`입니다. `recordResponse`가 처음 `unknown`을
   * 받은 시점을 기록할 때 쓰고, "지금" 값을 대신 쓰면 재질문 예산 판정이 어긋납니다.
   */
  readonly askedCountAtQuestion: number;
}

/**
 * 이 route가 받는 이력 턴 상한입니다. 질문 생성 경로의 `INTERVIEW_HISTORY_MAX_ITEMS`(18개 항목 = 9턴,
 * 아직 답하지 않은 마지막 질문을 뺀 값)와 달리, 블록 갱신은 마지막 턴의 답변까지 이미 이력에 실려
 * 들어오므로(설계 5절, "최신 답변은 이력에 이미 들어 있다") 인터뷰 전체 턴 수인
 * `INTERVIEW_MAX_TURNS`가 상한입니다.
 */
export const EXPERIENCE_BLOCK_HISTORY_MAX_TURNS = INTERVIEW_MAX_TURNS;

/** 이력 몫입니다. 턴 하나(질문+답변)에 이력 항목 상한을 두 번 적용합니다. */
export const EXPERIENCE_BLOCK_HISTORY_MAX_BYTES =
  EXPERIENCE_BLOCK_HISTORY_MAX_TURNS * 2 * INTERVIEW_HISTORY_ITEM_MAX_BYTES;

/** `targetBlock`·`answerTurnId`와 JSON 구조 오버헤드를 위한 여유입니다. */
export const EXPERIENCE_BLOCK_REQUEST_META_BYTES = 1024;

/** 설계 5-1절의 유도식(근거 몫 + 이력 몫 + 주장 상태 몫 + 요청 메타)입니다. */
export const MAX_EXPERIENCE_BLOCK_BODY_BYTES =
  SNAPSHOT_BODY_BYTES +
  EXPERIENCE_BLOCK_HISTORY_MAX_BYTES +
  CLAIMS_STATE_MAX_BYTES +
  EXPERIENCE_BLOCK_REQUEST_META_BYTES;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInt(value: unknown): boolean {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isBlockUpdateTurn(value: unknown): value is BlockUpdateTurn {
  return (
    isRecord(value) &&
    isNonEmptyString(value.turnId) &&
    isNonEmptyString(value.question) &&
    isNonEmptyString(value.answer)
  );
}

/**
 * `commits`는 스냅샷에서 뽑은 커밋→파일 인덱스입니다(`reducer.ts`의 `evidenceIndex`와 같은 형식).
 * `state.claims`는 클라이언트가 보관하다 돌려보낸 값이라 신뢰할 수 없고, 여기서 대조하지 않으면
 * 스냅샷에 없는 커밋을 인용한 "저장소 출처" 주장이 검증 없이 그대로 화면에 표시될 수 있습니다.
 */
function isClaimSource(
  value: unknown,
  commits: ReadonlyMap<string, ReadonlySet<string>>
): value is ClaimSource {
  if (!isRecord(value)) return false;
  if (value.source === "user") return true;
  if (value.source !== "repository" || typeof value.commitSha !== "string") return false;
  const files = commits.get(value.commitSha);
  if (!files) return false;
  return value.filePath === null || (typeof value.filePath === "string" && files.has(value.filePath));
}

const CLAIM_STATUSES: readonly ClaimStatus[] = ["active", "retracted", "conflicted"];
const PROGRESS_REASONS: readonly ProgressReason[] = [
  "sufficient",
  "askable",
  "unknown",
  "not_done",
  "refused",
  "none",
];

function isClaim(
  value: unknown,
  commits: ReadonlyMap<string, ReadonlySet<string>>
): value is Claim {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isBlockKind(value.block) &&
    isNonEmptyString(value.text) &&
    Array.isArray(value.sources) &&
    value.sources.length > 0 &&
    value.sources.every((source) => isClaimSource(source, commits)) &&
    typeof value.status === "string" &&
    CLAIM_STATUSES.includes(value.status as ClaimStatus) &&
    isNonEmptyString(value.turnId)
  );
}

function isClaimConflict(value: unknown): value is ClaimConflict {
  return (
    isRecord(value) &&
    isNonEmptyString(value.claimId) &&
    isNonEmptyString(value.observation) &&
    isNonEmptyString(value.turnId)
  );
}

function isDisplaySentence(value: unknown): value is DisplaySentence {
  return (
    isRecord(value) &&
    isNonEmptyString(value.text) &&
    Array.isArray(value.claimIds) &&
    value.claimIds.length > 0 &&
    value.claimIds.every((id) => typeof id === "string" && id.length > 0)
  );
}

function isBlockEvaluation(value: unknown): value is BlockEvaluation {
  return (
    isRecord(value) &&
    typeof value.sufficient === "boolean" &&
    typeof value.askable === "boolean" &&
    typeof value.reason === "string" &&
    PROGRESS_REASONS.includes(value.reason as ProgressReason)
  );
}

/** `display`·`evaluation`은 네 `BlockKind` 키를 모두 갖춰야 합니다. 하나라도 없으면 리듀서가
 *  `state.display[block]`류 접근에서 어긋납니다. */
function isBlockRecord<T>(
  value: unknown,
  isItem: (item: unknown, block: BlockKind) => item is T
): value is Readonly<Record<BlockKind, T>> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length === BLOCK_KINDS.length &&
    BLOCK_KINDS.every((block) => Object.hasOwn(value, block) && isItem(value[block], block))
  );
}

/** 서버가 부여하는 확정 ID의 형식입니다(`c` 뒤에 정수, `reducer.ts` `applyBlockUpdate` 참고). */
const CLAIM_ID_PATTERN = /^c(\d+)$/;

function isExperienceBlockState(
  value: unknown,
  commits: ReadonlyMap<string, ReadonlySet<string>>
): value is ExperienceBlockState {
  if (!isRecord(value)) return false;
  if (!isNonNegativeInt(value.version)) return false;
  if (!Number.isInteger(value.nextClaimSeq) || (value.nextClaimSeq as number) < 1) return false;
  if (!Array.isArray(value.claims) || !value.claims.every((claim) => isClaim(claim, commits))) {
    return false;
  }
  const claims = value.claims as readonly Claim[];

  // 주장 ID는 서버가 `c<정수>`로 부여하고 세션 안에서 증가합니다. 중복되거나 `nextClaimSeq`가
  // 이미 쓰인 번호 이하이면, 다음 add 연산이 배정하는 ID가 기존 주장과 충돌해 리듀서의 Map이
  // 조용히 덮어씁니다.
  const seenIds = new Set<string>();
  let maxUsedSeq = 0;
  for (const claim of claims) {
    if (seenIds.has(claim.id)) return false;
    seenIds.add(claim.id);
    const match = CLAIM_ID_PATTERN.exec(claim.id);
    if (match) maxUsedSeq = Math.max(maxUsedSeq, Number(match[1]));
  }
  if ((value.nextClaimSeq as number) <= maxUsedSeq) return false;

  if (!Array.isArray(value.conflicts) || !value.conflicts.every(isClaimConflict)) return false;

  // 표시 문장이 실재하지 않거나 철회·충돌된 주장을 참조하면, 그 문장의 `text`는 검증 없이 그대로
  // 응답에 실립니다(`markDisplay`는 존재하지 않는 참조를 조용히 걸러낼 뿐 문장 자체는 지우지
  // 않습니다). 조작된 요청이 지어낸 문장을 "검증된 표시"처럼 돌려받는 경로를 막습니다.
  const activeClaimIdsByBlock = new Map<BlockKind, ReadonlySet<string>>();
  for (const block of BLOCK_KINDS) {
    activeClaimIdsByBlock.set(
      block,
      new Set(claims.filter((claim) => claim.block === block && claim.status === "active").map((c) => c.id))
    );
  }

  if (
    !isBlockRecord(
      value.display,
      (item, block): item is readonly DisplaySentence[] =>
        Array.isArray(item) &&
        item.every(
          (sentence) =>
            isDisplaySentence(sentence) &&
            sentence.claimIds.every((id) => activeClaimIdsByBlock.get(block)!.has(id))
        )
    )
  ) {
    return false;
  }
  if (
    !isBlockRecord(
      value.evaluation,
      (item): item is BlockEvaluation | null => item === null || isBlockEvaluation(item)
    )
  ) {
    return false;
  }
  return true;
}

/**
 * 실패를 하나로 묶지 않는 이유는 `interview/question-request.ts`와 같습니다. 모양이 어긋난 요청은
 * 사용자가 손댈 것이 없고, 이력이나 주장 상태가 큰 요청은 대화를 줄이거나(이력) 화면 쪽에서 응축해야
 * 풀립니다(주장 상태). 설계 5-1절에 따라 넘긴 이력을 조용히 자르지 않고 거절합니다.
 */
export type ExperienceBlockRequestParseResult =
  | { readonly ok: true; readonly body: ExperienceBlockRequestBody }
  | {
      readonly ok: false;
      readonly kind: "invalid_request" | "history_too_large" | "claims_too_large";
      readonly message: string;
    };

export function parseExperienceBlockRequestBody(value: unknown): ExperienceBlockRequestParseResult {
  if (!isRecord(value) || !isExperienceEvidenceSnapshot(value.snapshot)) {
    return { ok: false, kind: "invalid_request", message: "근거 스냅샷 형식이 올바르지 않습니다." };
  }
  const commits = evidenceIndex(value.snapshot);
  if (!Array.isArray(value.history) || !value.history.every(isBlockUpdateTurn)) {
    return { ok: false, kind: "invalid_request", message: "대화 이력 형식이 올바르지 않습니다." };
  }
  const history = value.history as readonly BlockUpdateTurn[];
  if (!isExperienceBlockState(value.state, commits)) {
    return { ok: false, kind: "invalid_request", message: "주장 상태 형식이 올바르지 않습니다." };
  }
  if (!isBlockKind(value.targetBlock)) {
    return { ok: false, kind: "invalid_request", message: "대상 블록이 올바르지 않습니다." };
  }
  if (!isBlockElement(value.targetElement)) {
    return { ok: false, kind: "invalid_request", message: "대상 요소가 올바르지 않습니다." };
  }
  if (!isNonEmptyString(value.answerTurnId)) {
    return { ok: false, kind: "invalid_request", message: "처리할 답변의 턴 ID가 필요합니다." };
  }
  if (!history.some((turn) => turn.turnId === value.answerTurnId)) {
    return { ok: false, kind: "invalid_request", message: "처리할 답변의 턴 ID가 이력에 없습니다." };
  }

  if (history.length > EXPERIENCE_BLOCK_HISTORY_MAX_TURNS) {
    return {
      ok: false,
      kind: "history_too_large",
      message: `대화 이력은 ${EXPERIENCE_BLOCK_HISTORY_MAX_TURNS}턴 이하여야 합니다.`,
    };
  }
  if (
    history.some(
      (turn) =>
        serializedByteLength(turn.question) > INTERVIEW_HISTORY_ITEM_MAX_BYTES ||
        serializedByteLength(turn.answer) > INTERVIEW_HISTORY_ITEM_MAX_BYTES
    )
  ) {
    return {
      ok: false,
      kind: "history_too_large",
      message: `질문과 답변은 하나에 ${INTERVIEW_HISTORY_ITEM_MAX_BYTES}바이트 이하여야 합니다.`,
    };
  }
  if (byteLength(JSON.stringify(value.state.claims)) > CLAIMS_STATE_MAX_BYTES) {
    return {
      ok: false,
      kind: "claims_too_large",
      message: `주장 상태는 ${CLAIMS_STATE_MAX_BYTES}바이트 이하여야 합니다.`,
    };
  }

  const save = parseSaveTarget(value.save, history);
  if (save !== undefined && !save.ok) {
    return { ok: false, kind: "invalid_request", message: save.message };
  }

  return {
    ok: true,
    body: {
      snapshot: value.snapshot,
      history,
      state: value.state,
      targetBlock: value.targetBlock,
      targetElement: value.targetElement,
      answerTurnId: value.answerTurnId,
      ...(save === undefined ? {} : { save: save.target }),
    },
  };
}

/**
 * 저장 대상을 확인합니다. 값이 없으면 저장하지 않는다는 뜻이므로 `undefined`를 돌려줍니다.
 *
 * `pendingTurnIds`가 이력에 없는 턴을 가리키면 거절합니다. 조용히 넘기면 밀렸다고 보고한 턴이
 * 저장되지 않은 채로 요청만 성공하고, 사용자는 밀린 대화가 저장된 줄 압니다.
 */
function parseSaveTarget(
  value: unknown,
  history: readonly BlockUpdateTurn[]
): { ok: true; target: ExperienceBlockSaveTarget } | { ok: false; message: string } | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) return { ok: false, message: "save 형식이 올바르지 않습니다." };
  if (!isNonEmptyString(value.interviewId)) {
    return { ok: false, message: "save.interviewId가 필요합니다." };
  }
  if (!isNonNegativeInt(value.expectedBlockVersion)) {
    return { ok: false, message: "save.expectedBlockVersion은 0 이상의 정수여야 합니다." };
  }
  if (!isInterviewProgress(value.progress)) {
    return { ok: false, message: "save.progress 형식이 올바르지 않습니다." };
  }
  if (!isNonNegativeInt(value.askedCountAtQuestion)) {
    return { ok: false, message: "save.askedCountAtQuestion은 0 이상의 정수여야 합니다." };
  }
  const pendingTurnIds = value.pendingTurnIds;
  if (pendingTurnIds !== undefined) {
    if (!Array.isArray(pendingTurnIds) || !pendingTurnIds.every(isNonEmptyString)) {
      return { ok: false, message: "save.pendingTurnIds는 문자열 배열이어야 합니다." };
    }
    const known = new Set(history.map((turn) => turn.turnId));
    if (pendingTurnIds.some((turnId) => !known.has(turnId))) {
      return { ok: false, message: "save.pendingTurnIds에 이력에 없는 턴이 있습니다." };
    }
  }

  return {
    ok: true,
    target: {
      interviewId: value.interviewId,
      expectedBlockVersion: value.expectedBlockVersion as number,
      progress: value.progress,
      askedCountAtQuestion: value.askedCountAtQuestion as number,
      ...(pendingTurnIds === undefined ? {} : { pendingTurnIds: pendingTurnIds as readonly string[] }),
    },
  };
}

/**
 * PAAR 경험 블록의 상태와 모델 출력 계약입니다. 설계는 `llm-wiki/wiki/2026-09-11-PAAR-경험블록-설계-개정.md`
 * 3절과 4절에 있습니다.
 *
 * 화면에 보이는 블록 문장을 다음 갱신의 유일한 기억으로 쓰지 않습니다. 주장(claim)이 누적 정보이고,
 * 표시 문장(display)은 주장을 참조하는 화면용 응축입니다. 모델은 매 턴 주장 단위 변경 연산(op)과
 * 영향받은 블록의 표시 문장과 평가를 함께 냅니다.
 *
 * 이 상태는 영속 저장되지 않습니다. 클라이언트 훅이 세션 안에서 보관하고 매 요청에 서버로 보냅니다.
 * 무상태 서버는 클라이언트가 보낸 과거 상태의 진위와 최신성을 독립적으로 보장하지 못합니다.
 */

export const BLOCK_KINDS = ["problem", "alternatives", "action", "result"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

/** 블록마다 문장이 담아야 하는 두 요소입니다. sufficient는 두 요소가 모두 구체적으로 채워졌을 때만 true입니다. */
export const BLOCK_PURPOSES: Readonly<Record<BlockKind, string>> = {
  problem: "문제: 이 작업을 시작하게 만든 상황과, 기존 방식이 만든 구체적인 비용이나 한계",
  alternatives: "대안: 실제로 검토한 선택지와, 그것을 고르거나 버린 이유",
  action: "해결: 실제로 택한 방식과, 코드에서 확인되는 구체적인 구현",
  result: "결과: 변경 뒤 관찰한 변화와, 그것을 확인한 방법",
};

/**
 * 블록 목적을 이루는 두 요소입니다. `a`가 앞 절, `b`가 뒷 절입니다(`BLOCK_PURPOSES`를 "와," 기준으로
 * 나눈 것과 같습니다). 이슈 #90 "같은 부족 요소에 최대 1회 재질문" 규칙을 구현하는 최소 추적 단위로
 * 씁니다. 모델이 자유 형식으로 부족 요소를 지어내게 하면 같은 뜻을 다른 이름으로 내 재질문 제한을
 * 우회할 수 있어, 제품이 고정한 이 두 값만 씁니다.
 */
export const BLOCK_ELEMENTS = ["a", "b"] as const;
export type BlockElement = (typeof BLOCK_ELEMENTS)[number];

export const BLOCK_ELEMENT_PURPOSES: Readonly<Record<BlockKind, Readonly<Record<BlockElement, string>>>> = {
  problem: { a: "이 작업을 시작하게 만든 상황", b: "기존 방식이 만든 구체적인 비용이나 한계" },
  alternatives: { a: "실제로 검토한 선택지", b: "그것을 고르거나 버린 이유" },
  action: { a: "실제로 택한 방식", b: "코드에서 확인되는 구체적인 구현" },
  result: { a: "변경 뒤 관찰한 변화", b: "그것을 확인한 방법" },
};

/** 주장의 출처입니다. 한 주장에 두 종류가 함께 붙을 수 있습니다. */
export type ClaimSource =
  | { readonly source: "repository"; readonly commitSha: string; readonly filePath: string | null }
  | { readonly source: "user" };

/** `conflicted`는 사용자 주장과 저장소 관찰이 어긋나 아직 해소되지 않은 상태입니다. 표시 문장이 참조할 수 없습니다. */
export type ClaimStatus = "active" | "retracted" | "conflicted";

export interface Claim {
  /** 서버가 부여합니다. `c` 뒤에 세션 안에서 증가하는 정수입니다. */
  readonly id: string;
  readonly block: BlockKind;
  readonly text: string;
  readonly sources: readonly ClaimSource[];
  readonly status: ClaimStatus;
  /** 이 주장을 만들거나 마지막으로 바꾼 답변의 턴 ID입니다. */
  readonly turnId: string;
}

export interface ClaimConflict {
  readonly claimId: string;
  /** 저장소 근거에서 관찰한 내용입니다. 사용자 주장을 반박하는 확정 문장이 아니라 확인 질문의 재료입니다. */
  readonly observation: string;
  readonly turnId: string;
}

export interface DisplaySentence {
  readonly text: string;
  /** 이 문장이 응축한 주장입니다. 하나 이상이고 모두 같은 블록의 active 주장이어야 합니다. */
  readonly claimIds: readonly string[];
}

/**
 * 진행 사유입니다. sufficient 하나로 질문 지속·이동·종료를 판단하지 않습니다.
 * `unknown`은 기억나지 않음, `not_done`은 미실시·미측정, `refused`는 답변 거절, `none`은 더 물을 것이 없음입니다.
 */
export type ProgressReason = "sufficient" | "askable" | "unknown" | "not_done" | "refused" | "none";

export interface BlockEvaluation {
  readonly sufficient: boolean;
  /** 아직 확인할 구체적인 내용이 있고 사용자가 답할 여지가 있는지입니다. */
  readonly askable: boolean;
  readonly reason: ProgressReason;
}

/**
 * 이번 질문이 겨냥한 블록·요소 하나에 대한 이번 답변의 반응입니다. 블록 전체의 누적 평가인
 * `BlockEvaluation`과 달리, 방금 던진 질문 하나에 한정된 값입니다.
 *
 * `unanswered`는 답변이 이 질문과 무관했거나 반응이 없던 경우입니다. `unknown`(기억나지 않음)과
 * 구분합니다. 기억나지 않는다는 명시적 답변이 아닌 것을 기억 못 하는 것으로 잘못 세면 재질문 예산을
 * 엉뚱하게 소진시킵니다.
 */
export const TARGET_RESPONSES = ["provided", "unknown", "not_done", "refused", "unanswered"] as const;
export type TargetResponse = (typeof TARGET_RESPONSES)[number];

export interface ExperienceBlockState {
  /** 갱신이 반영될 때마다 1씩 오릅니다. 요청의 기준 버전과 다르면 응답을 적용하지 않습니다. */
  readonly version: number;
  readonly nextClaimSeq: number;
  readonly claims: readonly Claim[];
  readonly conflicts: readonly ClaimConflict[];
  readonly display: Readonly<Record<BlockKind, readonly DisplaySentence[]>>;
  readonly evaluation: Readonly<Record<BlockKind, BlockEvaluation | null>>;
}

/** 모델이 내는 변경 연산입니다. 같은 응답에서 추가한 주장은 `new:<tempId>`로 참조합니다. */
export type ClaimOp =
  | { readonly op: "add"; readonly tempId: string; readonly block: BlockKind; readonly text: string; readonly sources: readonly ClaimSource[] }
  | { readonly op: "revise"; readonly claimId: string; readonly text: string; readonly sources: readonly ClaimSource[] }
  | { readonly op: "retract"; readonly claimId: string }
  | { readonly op: "conflict"; readonly claimId: string; readonly observation: string };

export interface BlockDisplayOutput {
  readonly block: BlockKind;
  readonly sentences: readonly DisplaySentence[];
}

export interface BlockEvaluationOutput extends BlockEvaluation {
  readonly block: BlockKind;
}

/** 블록 갱신 호출 한 번의 모델 출력입니다. 변경 없는 블록은 `display`와 `evaluation`에 나오지 않습니다. */
export interface BlockUpdateOutput {
  readonly ops: readonly ClaimOp[];
  readonly display: readonly BlockDisplayOutput[];
  readonly evaluation: readonly BlockEvaluationOutput[];
  /** 이번 호출이 겨냥한 블록·요소 하나에 대한 이번 답변의 반응입니다. `targetResponse` 참고. */
  readonly targetResponse: TargetResponse;
}

export function emptyExperienceBlockState(): ExperienceBlockState {
  return {
    version: 0,
    nextClaimSeq: 1,
    claims: [],
    conflicts: [],
    display: { problem: [], alternatives: [], action: [], result: [] },
    evaluation: { problem: null, alternatives: null, action: null, result: null },
  };
}

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === "string" && (BLOCK_KINDS as readonly string[]).includes(value);
}

export function isBlockElement(value: unknown): value is BlockElement {
  return typeof value === "string" && (BLOCK_ELEMENTS as readonly string[]).includes(value);
}

export function isTargetResponse(value: unknown): value is TargetResponse {
  return typeof value === "string" && (TARGET_RESPONSES as readonly string[]).includes(value);
}

import {
  BLOCK_MAX_BYTES,
  BLOCK_MAX_STATEMENTS,
  blockConflicts,
  byteLength,
  markDisplay,
  type DisplayMark,
} from "./reducer";
import { BLOCK_KINDS, type BlockKind, type DisplaySentence, type ExperienceBlockState } from "./types";

/**
 * 인터뷰를 끝낸 뒤 사용자가 고친 블록 문장입니다. 설계 8절 "종료 후 사용자가 문장을 수정하면 기존
 * 출처와 검증 상태를 자동으로 승계하지 않습니다"와 9절 "재처리가 종료 후 사용자 편집을 덮어쓰지
 * 않습니다"를 구현합니다.
 *
 * 편집본을 `ExperienceBlockState`에 되돌려 넣지 않고 따로 듭니다. 종료 뒤에도 미반영 턴의 재처리가
 * 성공하면 `blockState.display`가 바뀌는데, 편집본을 그 상태에서 파생시키면 사용자가 고친 문장이
 * 그 순간 사라집니다. 이 자료구조에서는 편집한 블록이 `blockState`를 아예 읽지 않으므로 덮어쓸
 * 경로 자체가 없습니다.
 *
 * 값이 없는 블록은 아직 고치지 않은 블록입니다. 빈 배열은 사용자가 내용을 모두 지운 블록이라
 * 뜻이 다릅니다.
 */
export type BlockEdits = Readonly<Partial<Record<BlockKind, readonly DisplaySentence[]>>>;

/**
 * 편집 입력을 표시 문장 배열로 바꿉니다. 한 줄이 한 문장이고 빈 줄은 버립니다.
 *
 * `claimIds`를 언제나 비웁니다. 출처 승계 금지를 조건문이 아니라 자료구조로 지킵니다. 고친 문장이
 * 원래 참조하던 주장을 그대로 달고 있으면 저장소 인용이 함께 따라와, 사용자가 직접 쓴 문장에
 * 저장소가 뒷받침한다는 표시가 붙습니다.
 */
export function parseBlockEdit(text: string): readonly DisplaySentence[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ text: line, claimIds: [] }));
}

/** 편집 입력을 편집 전 모습으로 되돌립니다. `parseBlockEdit`의 역방향입니다. */
export function formatBlockEdit(sentences: readonly DisplaySentence[]): string {
  return sentences.map((sentence) => sentence.text).join("\n");
}

/**
 * 표시 문장 배열이 차지하는 바이트입니다. 상한 판정을 서버와 같은 기준으로 맞춥니다.
 *
 * 글자 수가 아니라 직렬화 바이트로 재는 것까지는 이슈 #91의 Constraint이고, **무엇을 직렬화하는지**는
 * `applyBlockUpdate`가 정합니다. 그 검증은 `byteLength(JSON.stringify(sentences))`를 `BLOCK_MAX_BYTES`와
 * 비교하므로(`reducer.ts`), 문장 원문만 재면 `text`·`claimIds` 키와 따옴표, 그리고 JSON 이스케이프가
 * 빠져 화면이 통과시킨 편집을 서버가 거절합니다.
 */
export function blockEditByteLength(sentences: readonly DisplaySentence[]): number {
  return byteLength(JSON.stringify(sentences));
}

export type BlockEditRejection = "too_many_statements" | "block_too_large";

/** 편집을 저장할 수 있는지입니다. 서버가 거절할 편집을 화면에서 먼저 막습니다. */
export function validateBlockEdit(sentences: readonly DisplaySentence[]): BlockEditRejection | null {
  if (sentences.length > BLOCK_MAX_STATEMENTS) return "too_many_statements";
  if (blockEditByteLength(sentences) > BLOCK_MAX_BYTES) return "block_too_large";
  return null;
}

/**
 * 화면에 그릴 블록의 미해소 충돌입니다. 고친 블록은 언제나 비어 있습니다.
 *
 * 충돌은 모델이 낸 문장과 저장소 관찰이 어긋난 지점이라 특정 주장에 매여 있습니다. 사용자가 그
 * 블록을 자기 문장으로 바꾸면 그 주장은 화면에서 사라지는데, `blockConflicts`는 편집을 모르므로
 * 예전 충돌을 계속 돌려줍니다. 그대로 그리면 사용자가 쓴 적 없는 문장에 대한 경고가 남아, 편집이
 * 기존 검증 상태를 승계하지 않는다는 계약(설계 8절)이 깨집니다(PR #121 리뷰 1라운드).
 *
 * `effectiveDisplay`·`blockMarks`와 같은 규칙입니다. 고친 블록에서는 `blockState`를 읽지 않습니다.
 */
export function effectiveConflicts(
  state: ExperienceBlockState,
  edits: BlockEdits,
  block: BlockKind
): ReturnType<typeof blockConflicts> {
  return edits[block] === undefined ? blockConflicts(state, block) : [];
}

/** 화면에 그릴 블록 문장입니다. 고친 블록은 편집본을, 그 밖에는 모델이 낸 표시 문장을 씁니다. */
export function effectiveDisplay(
  state: ExperienceBlockState,
  edits: BlockEdits,
  block: BlockKind
): readonly DisplaySentence[] {
  return edits[block] ?? state.display[block];
}

/**
 * 문장별 출처 표시입니다. 고치지 않은 블록은 `markDisplay`가 주장에서 계산하고, 고친 블록은 모든
 * 문장이 사용자 진술입니다.
 *
 * 고친 블록을 `markDisplay`에 넘기지 않습니다. `markDisplay`는 `state.display`를 읽으므로 편집 전
 * 문장을 그대로 돌려주고, 그 문장에 붙어 있던 저장소 인용까지 함께 남깁니다. 사용자가 고친 문장에
 * 예전 인용이 따라붙으면 확인되지 않은 문장이 확인된 것처럼 보입니다(설계 8절).
 */
export function blockMarks(
  state: ExperienceBlockState,
  edits: BlockEdits,
  block: BlockKind
): readonly DisplayMark[] {
  const edited = edits[block];
  if (edited === undefined) return markDisplay(state, block);
  return edited.map((sentence) => ({
    text: sentence.text,
    userStatement: true,
    repositorySources: [],
  }));
}

/** 내용이 채워진 블록 수입니다. 헤더 토글과 좁은 폭 탭, 패널 머리글의 `n/4`가 모두 이 값을 씁니다. */
export function filledBlockCount(state: ExperienceBlockState, edits: BlockEdits): number {
  return BLOCK_KINDS.filter((block) => effectiveDisplay(state, edits, block).length > 0).length;
}

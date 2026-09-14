import { BLOCK_ELEMENTS, BLOCK_KINDS, type BlockElement, type BlockEvaluation, type BlockKind, type TargetResponse } from "./types";

/**
 * 이슈 #90 "충분성과 진행의 분리, 턴 분배"의 다음 질문 선택 로직입니다. 설계는
 * `llm-wiki/wiki/2026-09-11-PAAR-경험블록-설계-개정.md` 6절이고, 재질문·거절 추적 단위를 요소로
 * 좁힌 결정은 이 기능의 핸드오프 논의(2026-09-11)에서 확정했습니다.
 *
 * 서버가 아니라 훅이 답변 반영 뒤 이 순수 함수로 판단합니다(6-2절). 서버는 무상태라 재질문 이력을
 * 들고 있을 수 없고, 클라이언트가 매 요청에 이 상태를 함께 보냅니다(기존 주장 상태와 같은 방식).
 *
 * "같은 부족 요소"의 추적 단위는 모델이 자유 형식으로 지어내는 문자열이 아니라 `BlockElement`
 * (`a`·`b`, 블록 목적의 두 요소)로 고정합니다. 모델이 부족 요소 이름을 스스로 짓게 하면 같은 뜻을
 * 다른 이름으로 내 재질문 제한을 우회할 수 있습니다.
 */

/**
 * 설계 6-1절의 임시 운영값입니다. 손으로 고른 값이고 실제 인터뷰 데이터로 검증되지 않았습니다.
 * 합성 답변 테스트 통과를 턴 수 충분성의 근거로 쓰지 않습니다. 값을 조정할 자리를 한 곳으로
 * 모으려고 설정 객체로 분리했습니다.
 */
export const PROGRESS_CONFIG = {
  /** 같은 요소에서 `unknown` 응답을 이 횟수만큼 받으면(최초 질문 포함) 더 묻지 않습니다. */
  maxAsksAfterUnknown: 2,
  /** 미확인 블록 하나에 예약하는 질문 기회입니다. */
  unvisitedBlockReserve: 1,
} as const;

export interface ElementProgress {
  /** 이 요소를 겨냥한 질문을 보낸 횟수입니다. */
  readonly askedCount: number;
  /**
   * 이 요소에서 처음 `unknown`을 받았을 때의 `askedCount`입니다. 아직 `unknown`을 받은 적이
   * 없으면 `null`입니다. `reaskUsed` 판정의 기준점이고, `askedCount`(총 질문 횟수)와 분리해 둬야
   * "provided로 답한 요소를 나중에 다시 물었을 때 첫 unknown에 바로 소진되는" 오작동을 막을 수
   * 있습니다(구현검토 2026-09-11 P1-1).
   */
  readonly firstUnknownAskedCount: number | null;
}

export interface BlockProgress {
  /** 이 블록으로 질문을 한 번이라도 보냈는지입니다. "미확인 블록" 예약(6-2절 3번)의 판정 기준입니다. */
  readonly visited: boolean;
  /**
   * 이 블록에서 답변 거절을 받았는지입니다. 6-1절 "답변 거절은 그 주제의 재질문을 중단합니다"를
   * 요소 범위로 정확히 표현할 신호가 지금 계약에 없어(거절의 범위가 요소 하나인지 블록 전체인지
   * 모델 출력만으로 가르지 못합니다), MVP는 블록 전체를 닫는 보수적 정책을 씁니다. 요소 단위로
   * 좁히려면 모델 출력에 `refusalScope` 같은 값이 추가로 필요합니다.
   */
  readonly refused: boolean;
  readonly elements: Readonly<Record<BlockElement, ElementProgress>>;
}

export type InterviewProgress = Readonly<Record<BlockKind, BlockProgress>>;

const EMPTY_ELEMENT_PROGRESS: ElementProgress = { askedCount: 0, firstUnknownAskedCount: null };

export function emptyInterviewProgress(): InterviewProgress {
  return Object.fromEntries(
    BLOCK_KINDS.map((block) => [
      block,
      { visited: false, refused: false, elements: { a: EMPTY_ELEMENT_PROGRESS, b: EMPTY_ELEMENT_PROGRESS } },
    ])
  ) as InterviewProgress;
}

/** 질문을 보낸 직후 기록합니다. 답변은 아직 없으므로 `askedCount`만 올립니다. */
export function recordAsked(progress: InterviewProgress, block: BlockKind, element: BlockElement): InterviewProgress {
  const blockProgress = progress[block];
  const elementProgress = blockProgress.elements[element];
  return {
    ...progress,
    [block]: {
      ...blockProgress,
      visited: true,
      elements: {
        ...blockProgress.elements,
        [element]: { ...elementProgress, askedCount: elementProgress.askedCount + 1 },
      },
    },
  };
}

/**
 * 답변의 `targetResponse`를 반영합니다. 처음 `unknown`을 받으면 그 질문을 보낸 시점의 `askedCount`를
 * `firstUnknownAskedCount`로 남겨 둡니다. 호출부가 그 값을 `askedCountAtQuestion`으로 명시해서
 * 넘겨야 합니다. `progress`의 "지금" `askedCount`를 암묵적으로 쓰지 않는 이유는, 재처리
 * (`retryAllUnreflected`)로 응답이 늦게 도착하면 그 사이 같은 요소에 더 최근 질문이 나가
 * `askedCount`가 이미 앞서 있을 수 있고, 그 최신 값을 이 응답의 질문 시점인 것처럼 기록하면 재질문
 * 예산이 실제보다 넉넉하게 남은 것으로 잘못 계산되기 때문입니다(CodeRabbit PR #117).
 *
 * 이미 `firstUnknownAskedCount`가 있는데 더 이른 질문의 `unknown` 응답이 늦게 도착하면 더 작은
 * 값(더 이른 질문 시점)을 남깁니다. 예산은 "언제 처음 unknown을 받았는가"를 기준으로 계산되므로
 * 실제로 더 이른 시점이 있었다면 그 값이 맞습니다.
 *
 * 재질문 예산을 다 썼는지는 이 함수가 판정하지 않습니다. `isElementClosed`가 `askedCount`와
 * `firstUnknownAskedCount`만으로 매번 다시 계산합니다. 예전에는 이 함수가 그 시점에 `reaskUsed`
 * 플래그를 계산해 저장했는데, 재질문을 보낸 뒤 그 응답의 블록 갱신 호출 자체가 실패하면(네트워크
 * 오류 등) 이 함수가 한 번도 불리지 않아 플래그가 영영 세워지지 않고, 이미 재질문 예산을 다 쓴
 * 요소를 다시 골라 버렸습니다(추가 재검증 2026-09-12). `askedCount`는 질문을 보내는 즉시
 * `recordAsked`가 올리므로 응답 처리 성공 여부와 무관하게 항상 최신입니다. 판정을 그 값에서 직접
 * 계산하면 응답을 받기도 전에 이미 재질문을 보냈다는 사실만으로 닫을 수 있습니다.
 */
export function recordResponse(
  progress: InterviewProgress,
  block: BlockKind,
  element: BlockElement,
  response: TargetResponse,
  askedCountAtQuestion: number
): InterviewProgress {
  const blockProgress = progress[block];
  const elementProgress = blockProgress.elements[element];
  const firstUnknownAskedCount =
    response !== "unknown"
      ? elementProgress.firstUnknownAskedCount
      : elementProgress.firstUnknownAskedCount === null
        ? askedCountAtQuestion
        : Math.min(elementProgress.firstUnknownAskedCount, askedCountAtQuestion);
  return {
    ...progress,
    [block]: {
      ...blockProgress,
      refused: blockProgress.refused || response === "refused",
      elements: {
        ...blockProgress.elements,
        [element]: { ...elementProgress, firstUnknownAskedCount },
      },
    },
  };
}

/**
 * `askedCount`와 `firstUnknownAskedCount`만으로 재질문 예산 소진 여부를 계산합니다(구현검토
 * 2026-09-11 P1-1, 추가 재검증 2026-09-12). 첫 `unknown` 이후 이 요소에 다시 질문을 보낸 횟수가
 * 재질문 허용 횟수에 닿으면, 그 재질문의 응답을 아직 받지 못했어도(진행 중이거나 실패했어도) 닫힌
 * 것으로 봅니다. 응답 도착을 기다려야만 닫힌다고 하면, 재질문 자체는 나갔는데 그 응답의 블록 갱신
 * 호출만 실패한 경우 이 요소가 계속 열려 있어 예산을 넘겨 다시 물을 수 있습니다.
 */
function isElementClosed(elementProgress: ElementProgress): boolean {
  const { firstUnknownAskedCount, askedCount } = elementProgress;
  if (firstUnknownAskedCount === null) return false;
  return askedCount - firstUnknownAskedCount >= PROGRESS_CONFIG.maxAsksAfterUnknown - 1;
}

/**
 * 블록이 더 물을 가치가 없는지 봅니다. 충분하거나(sufficient), 모델이 더 물을 것이 없다고 했거나
 * (!askable), 두 요소 모두 재질문 예산을 다 썼으면 닫힙니다. 평가가 아직 없으면(null, 미확인
 * 블록) 닫히지 않은 것으로 봅니다.
 */
function isBlockClosed(evaluation: BlockEvaluation | null, blockProgress: BlockProgress): boolean {
  if (blockProgress.refused) return true;
  if (evaluation === null) return false;
  if (evaluation.sufficient) return true;
  if (!evaluation.askable) return true;
  return BLOCK_ELEMENTS.every((element) => isElementClosed(blockProgress.elements[element]));
}

export type NextQuestionTarget =
  | { readonly kind: "ask"; readonly block: BlockKind; readonly element: BlockElement }
  | { readonly kind: "done" };

export interface SelectNextTargetInput {
  readonly evaluation: Readonly<Record<BlockKind, BlockEvaluation | null>>;
  readonly progress: InterviewProgress;
  /** 지금까지 확정된 턴 수입니다. 질문 하나와 그 답변이 한 턴입니다. */
  readonly turnsUsed: number;
  /** `INTERVIEW_MAX_TURNS`를 그대로 받습니다. 이 함수는 상수를 직접 참조하지 않습니다. */
  readonly maxTurns: number;
  readonly isEnded: boolean;
  /** 직전 질문이 겨냥했던 대상입니다. 있으면 같은 블록을 이어가는 것을 우선합니다. */
  readonly lastTarget?: { readonly block: BlockKind; readonly element: BlockElement };
}

/**
 * 다음 질문 대상을 고릅니다(설계 6-2절 여섯 단계).
 *
 * 5번째 단계("모든 블록을 확인한 뒤에는 중요한 모순이나 부족 요소를 우선합니다")는 지금 출력
 * 계약에 중요도나 모순 여부를 구조화된 값으로 담지 않아 판단할 신호가 없습니다. 그 대신 결정적인
 * `BLOCK_KINDS` 순서로 고릅니다. 실제 인터뷰 데이터를 본 뒤 우선순위 신호가 필요하면 그때
 * 넓힙니다.
 */
export function selectNextTarget(input: SelectNextTargetInput): NextQuestionTarget {
  const { evaluation, progress, turnsUsed, maxTurns, isEnded, lastTarget } = input;
  // 1. 상한 도달이나 사용자 종료를 확인합니다.
  if (isEnded || turnsUsed >= maxTurns) return { kind: "done" };

  // 2. 충족됐거나 추가 확인이 어려운 블록은 후보에서 뺍니다.
  const openBlocks = BLOCK_KINDS.filter((block) => !isBlockClosed(evaluation[block], progress[block]));
  // 6. 유효한 질문 후보가 없으면 질문을 만들지 않습니다.
  if (openBlocks.length === 0) return { kind: "done" };

  // "미확인"은 질문을 보낸 적이 없는 것뿐 아니라 평가도 없는 블록입니다(설계 6-2절: "다른 답변에서
  // 정보를 얻었다면 별도 질문을 예약하지 않습니다"). `evaluation[block]`이 있다는 것은 다른 블록을
  // 겨냥한 답변이 이 블록의 주장까지 만들어 이미 한 번 평가받았다는 뜻이므로, 질문을 보낸 적이
  // 없어도(`visited=false`) 예약 대상에서 뺍니다. `visited`만 보면 이런 블록도 미확인으로 잘못 세어
  // 남은 질문을 억지로 그쪽에 씁니다(구현검토 2026-09-11 P2, R8).
  const unvisitedBlocks = openBlocks.filter((block) => !progress[block].visited && evaluation[block] === null);
  const remainingQuestions = maxTurns - turnsUsed;

  // 3. 예약 예산: 남은 질문 수가 다른 미확인 블록 수(블록당 예약 수만큼) 이하이면 미확인 블록으로 이동합니다.
  const reserveForUnvisited =
    unvisitedBlocks.length > 0 &&
    remainingQuestions <= unvisitedBlocks.length * PROGRESS_CONFIG.unvisitedBlockReserve;
  const continuingBlock = lastTarget !== undefined && openBlocks.includes(lastTarget.block) ? lastTarget.block : undefined;

  // 4. 예산이 허용되면 현재(직전) 블록을 이어가고, 아니면 미확인 블록이나 다음 열린 블록을 고릅니다.
  const target = reserveForUnvisited
    ? unvisitedBlocks[0]
    : (continuingBlock ?? unvisitedBlocks[0] ?? openBlocks[0]);

  const targetProgress = progress[target];
  // 열린(재질문 예산이 남은) 요소 가운데 가장 적게 물은 것을 고릅니다. 한 번도 안 물은 요소가
  // 있으면 askedCount 0이 가장 작으므로 자연히 먼저 뽑힙니다. 둘 다 이미 물었다면 한쪽에만
  // 쏠리지 않도록 적게 물은 쪽으로 번갈아 갑니다.
  const openElements = BLOCK_ELEMENTS.filter((element) => !isElementClosed(targetProgress.elements[element]));
  // isBlockClosed가 이미 "두 요소 모두 닫힘"을 걸렀으므로 여기 도달했다면 항상 열린 요소가 있어야
  // 합니다. 방어적으로만 done을 남깁니다.
  if (openElements.length === 0) return { kind: "done" };
  const openElement = openElements.reduce((least, element) =>
    targetProgress.elements[element].askedCount < targetProgress.elements[least].askedCount ? element : least
  );
  return { kind: "ask", block: target, element: openElement };
}

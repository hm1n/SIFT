import type { BlockKind } from "./types";

/**
 * 화면에 보이는 블록 이름입니다. 오른쪽 PAAR 패널의 카드와 답변 입력 아래의 현재 블록 안내가 같은
 * 값을 써야 해서 여기 한 곳에 둡니다.
 *
 * 두 번째 블록의 이름은 디자인 개편의 공통 결정을 따라 `Analyze`이고, 설계 문서의 `ALTERNATIVE`를
 * 대체합니다(이슈 #92 Approach). 상태 키 `alternatives`는 모델 계약이라 그대로 둡니다.
 *
 * `types.ts`의 `BLOCK_PURPOSES`와 나누는 이유는 읽는 쪽이 다르기 때문입니다. 그 값은 모델에게 주는
 * 한국어 설명이고 이 값은 사용자가 읽는 영어 이름입니다.
 */
export const BLOCK_LABELS: Readonly<Record<BlockKind, string>> = {
  problem: "Problem",
  alternatives: "Analyze",
  action: "Action",
  result: "Result",
};

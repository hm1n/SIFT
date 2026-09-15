import { describe, expect, it } from "vitest";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { isRestorableBlockState } from "./payload";

/**
 * 저장된 블록 상태를 화면이 쓰기 전에 좁히는 가드입니다(PR #127 리뷰와 재검증 라운드).
 *
 * 바깥 모양만 보면 `claims: [null]` 같은 값이 통과하고, 화면이 `claim.id`를 읽는 자리에서 결국
 * 깨집니다. 여기서 막는 것이 그 자리입니다.
 */
function stateWith(overrides: Record<string, unknown>): unknown {
  return { ...emptyExperienceBlockState(), ...overrides };
}

const display = emptyExperienceBlockState().display;
const evaluation = emptyExperienceBlockState().evaluation;

describe("isRestorableBlockState", () => {
  it("갓 만든 빈 상태를 받아들인다", () => {
    expect(isRestorableBlockState(emptyExperienceBlockState())).toBe(true);
  });

  it("실제로 쌓인 상태를 받아들인다", () => {
    const state = stateWith({
      version: 3,
      nextClaimSeq: 2,
      claims: [
        {
          id: "c1",
          block: "problem",
          text: "로그가 청크마다 전체를 다시 그렸다",
          sources: [{ source: "repository", commitSha: "abc1234", filePath: "src/log.tsx" }, { source: "user" }],
          status: "active",
          turnId: "t1",
        },
      ],
      conflicts: [{ claimId: "c1", observation: "커밋에는 그 변경이 없습니다", turnId: "t1" }],
      display: { ...display, problem: [{ text: "모델이 쓴 문장", claimIds: ["c1"] }] },
      evaluation: { ...evaluation, problem: { sufficient: true, askable: false, reason: "sufficient" } },
    });

    expect(isRestorableBlockState(state)).toBe(true);
  });

  it.each([
    ["값이 아예 아니면", null],
    ["버전이 없으면", stateWith({ version: undefined })],
    ["주장이 배열이 아니면", stateWith({ claims: {} })],
    ["블록이 하나 빠졌으면", stateWith({ display: { problem: [], alternatives: [], action: [] } })],
  ])("%s 거절한다", (_label, value) => {
    expect(isRestorableBlockState(value)).toBe(false);
  });

  /**
   * 중첩된 원소가 비어 있는 경우입니다. 바깥 모양만 보던 첫 구현은 이 넷을 모두 통과시켰고, 화면은
   * `markDisplay`와 `blockConflicts`에서 멈췄습니다.
   */
  it.each([
    ["주장 자리에 null이 있으면", stateWith({ claims: [null] })],
    ["주장의 출처가 모양이 아니면", stateWith({ claims: [{ id: "c1", block: "problem", text: "문장", sources: [null], status: "active", turnId: "t1" }] })],
    ["충돌 자리에 null이 있으면", stateWith({ conflicts: [null] })],
    ["표시 문장 자리에 null이 있으면", stateWith({ display: { ...display, problem: [null] } })],
    ["표시 문장의 참조가 문자열이 아니면", stateWith({ display: { ...display, problem: [{ text: "문장", claimIds: [1] }] } })],
  ])("%s 거절한다", (_label, value) => {
    expect(isRestorableBlockState(value)).toBe(false);
  });

  /**
   * 평가는 렌더를 멈추지 않고 조용히 어긋나는 쪽이라 더 나쁩니다. `askable`이 없으면
   * `isBlockClosed`가 그 블록을 닫힌 것으로 처리해, 이어간 인터뷰가 물어야 할 것을 건너뜁니다.
   */
  it("평가의 칸이 빠져 있으면 거절한다", () => {
    expect(isRestorableBlockState(stateWith({ evaluation: { ...evaluation, problem: {} } }))).toBe(false);
  });

  it("아직 다루지 않은 블록의 평가가 null인 것은 받아들인다", () => {
    expect(isRestorableBlockState(stateWith({ evaluation }))).toBe(true);
  });
});

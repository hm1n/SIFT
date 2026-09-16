import { describe, expect, it } from "vitest";
import {
  blockEditByteLength,
  blockMarks,
  effectiveConflicts,
  effectiveDisplay,
  filledBlockCount,
  formatBlockEdit,
  parseBlockEdit,
  validateBlockEdit,
  type BlockEdits,
} from "./block-edits";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS, byteLength } from "./reducer";
import { emptyExperienceBlockState, type Claim, type ExperienceBlockState } from "./types";

function stateWith(overrides: Partial<ExperienceBlockState>): ExperienceBlockState {
  return { ...emptyExperienceBlockState(), ...overrides };
}

const repositoryClaim: Claim = {
  id: "c1",
  block: "problem",
  text: "로그 렌더링이 매 청크마다 전체를 다시 그렸다",
  sources: [{ source: "repository", commitSha: "abc1234def", filePath: "src/log.tsx" }],
  status: "active",
  turnId: "t1",
};

const userClaim: Claim = {
  id: "c2",
  block: "result",
  text: "체감 지연이 절반으로 줄었다",
  sources: [{ source: "user" }],
  status: "active",
  turnId: "t2",
};

describe("parseBlockEdit", () => {
  it("한 줄을 한 문장으로 나누고 빈 줄을 버린다", () => {
    expect(parseBlockEdit("첫 문장\n\n  둘째 문장  \n")).toEqual([
      { text: "첫 문장", claimIds: [] },
      { text: "둘째 문장", claimIds: [] },
    ]);
  });

  it("편집한 문장은 주장 참조를 승계하지 않는다", () => {
    // 설계 8절 "종료 후 사용자가 문장을 수정하면 기존 출처와 검증 상태를 자동으로 승계하지
    // 않습니다". 승계 금지를 조건문이 아니라 자료구조로 지키는 자리라 여기서 고정합니다.
    for (const sentence of parseBlockEdit("고친 문장")) {
      expect(sentence.claimIds).toEqual([]);
    }
  });

  it("formatBlockEdit과 왕복해도 문장이 그대로다", () => {
    const sentences = parseBlockEdit("첫 문장\n둘째 문장");
    expect(parseBlockEdit(formatBlockEdit(sentences))).toEqual(sentences);
  });
});

describe("blockEditByteLength", () => {
  it("문장 원문이 아니라 서버가 재는 직렬화 결과로 잰다", () => {
    // `applyBlockUpdate`가 `byteLength(JSON.stringify(sentences))`로 재므로(reducer.ts) 화면도 같은
    // 값을 봐야 합니다. 원문만 재면 키와 따옴표, 이스케이프가 빠져 화면이 통과시킨 편집을 서버가
    // 거절합니다.
    const sentences = parseBlockEdit("짧은 문장");
    expect(blockEditByteLength(sentences)).toBe(byteLength(JSON.stringify(sentences)));
    expect(blockEditByteLength(sentences)).toBeGreaterThan(byteLength("짧은 문장"));
  });

  it("JSON 이스케이프가 필요한 글자를 원문보다 크게 잰다", () => {
    // 따옴표 하나가 직렬화에서 두 바이트가 됩니다. 원문 기준으로 재면 이 차이를 놓칩니다.
    const plain = blockEditByteLength(parseBlockEdit("aaaa"));
    const quoted = blockEditByteLength(parseBlockEdit('"aa"'));
    expect(quoted).toBeGreaterThan(plain);
  });
});

describe("validateBlockEdit", () => {
  it("문장 수 상한을 넘으면 거절한다", () => {
    const tooMany = parseBlockEdit(Array.from({ length: BLOCK_MAX_STATEMENTS + 1 }, (_, i) => `문장 ${i}`).join("\n"));
    expect(validateBlockEdit(tooMany)).toBe("too_many_statements");
  });

  it("바이트 상한을 넘으면 거절한다", () => {
    const huge = parseBlockEdit("가".repeat(BLOCK_MAX_BYTES));
    expect(validateBlockEdit(huge)).toBe("block_too_large");
  });

  it("상한 안이면 통과한다", () => {
    expect(validateBlockEdit(parseBlockEdit("짧은 문장\n둘째 문장"))).toBeNull();
  });

  it("빈 편집을 거절하지 않는다", () => {
    // 사용자가 블록을 통째로 비우는 것은 허용합니다. 내용이 없는 블록을 AI가 대신 채우지 않는 것과
    // 사용자가 지우는 것은 다른 규칙입니다.
    expect(validateBlockEdit(parseBlockEdit(""))).toBeNull();
  });
});

describe("blockMarks", () => {
  it("고치지 않은 블록은 주장의 출처에서 표시를 계산한다", () => {
    const state = stateWith({
      claims: [repositoryClaim],
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "표시 문장", claimIds: ["c1"] }] },
    });

    const [mark] = blockMarks(state, {}, "problem");
    expect(mark.userStatement).toBe(false);
    expect(mark.repositorySources).toEqual([
      { source: "repository", commitSha: "abc1234def", filePath: "src/log.tsx" },
    ]);
  });

  it("사용자 진술만 근거인 주장을 참조하면 사용자 진술로 표시한다", () => {
    const state = stateWith({
      claims: [userClaim],
      display: { ...emptyExperienceBlockState().display, result: [{ text: "표시 문장", claimIds: ["c2"] }] },
    });

    expect(blockMarks(state, {}, "result")[0].userStatement).toBe(true);
  });

  it("고친 블록은 저장소 인용을 잃고 사용자 진술이 된다", () => {
    // 이슈 #91이 요구한 회귀 테스트입니다. 저장소 인용이 붙어 있던 문장을 고쳐도 그 인용이 따라오면
    // 사용자가 직접 쓴 문장에 저장소가 뒷받침한다는 표시가 남습니다.
    const state = stateWith({
      claims: [repositoryClaim],
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "표시 문장", claimIds: ["c1"] }] },
    });
    const edits: BlockEdits = { problem: parseBlockEdit("사용자가 고친 문장") };

    const [mark] = blockMarks(state, edits, "problem");
    expect(mark.text).toBe("사용자가 고친 문장");
    expect(mark.userStatement).toBe(true);
    expect(mark.repositorySources).toEqual([]);
  });
});

describe("effectiveConflicts", () => {
  const conflictedClaim: Claim = { ...repositoryClaim, id: "c9", block: "problem", status: "conflicted" };
  const conflict = { claimId: "c9", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" };

  function conflictedState(): ExperienceBlockState {
    return stateWith({
      claims: [conflictedClaim],
      conflicts: [conflict],
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "모델이 쓴 문장", claimIds: ["c9"] }] },
    });
  }

  it("고치지 않은 블록은 미해소 충돌을 그대로 돌려준다", () => {
    expect(effectiveConflicts(conflictedState(), {}, "problem")).toEqual([conflict]);
  });

  it("고친 블록은 예전 충돌을 승계하지 않는다", () => {
    // 설계 8절 "종료 후 사용자가 문장을 수정하면 기존 출처와 검증 상태를 자동으로 승계하지
    // 않습니다". 충돌은 모델이 낸 주장에 매여 있어 사용자가 문장을 바꾸면 근거가 사라집니다
    // (PR #121 리뷰 1라운드).
    const edits: BlockEdits = { problem: parseBlockEdit("사용자가 고친 문장") };
    expect(effectiveConflicts(conflictedState(), edits, "problem")).toEqual([]);
  });

  it("내용을 모두 지운 블록도 예전 충돌을 남기지 않는다", () => {
    const edits: BlockEdits = { problem: [] };
    expect(effectiveConflicts(conflictedState(), edits, "problem")).toEqual([]);
  });

  it("다른 블록을 고쳐도 이 블록의 충돌은 그대로다", () => {
    const edits: BlockEdits = { result: parseBlockEdit("다른 블록 편집") };
    expect(effectiveConflicts(conflictedState(), edits, "problem")).toEqual([conflict]);
  });
});

describe("effectiveDisplay", () => {
  it("고친 뒤 블록 상태가 바뀌어도 편집본이 남는다", () => {
    // 설계 9절 "재처리가 종료 후 사용자 편집을 덮어쓰지 않습니다". 종료해도 미반영 턴의 재처리는
    // 계속 돌 수 있어 `blockState.display`가 뒤늦게 바뀝니다.
    const edits: BlockEdits = { problem: parseBlockEdit("사용자가 고친 문장") };
    const afterRetry = stateWith({
      version: 7,
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "재처리가 낸 새 문장", claimIds: [] }] },
    });

    expect(effectiveDisplay(afterRetry, edits, "problem")).toEqual([
      { text: "사용자가 고친 문장", claimIds: [] },
    ]);
  });

  it("고치지 않은 블록은 재처리 결과를 그대로 따른다", () => {
    const edits: BlockEdits = { problem: parseBlockEdit("사용자가 고친 문장") };
    const afterRetry = stateWith({
      display: { ...emptyExperienceBlockState().display, action: [{ text: "재처리가 낸 새 문장", claimIds: [] }] },
    });

    expect(effectiveDisplay(afterRetry, edits, "action")).toEqual([
      { text: "재처리가 낸 새 문장", claimIds: [] },
    ]);
  });

  it("빈 배열 편집과 편집하지 않음을 구분한다", () => {
    const state = stateWith({
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "모델이 낸 문장", claimIds: [] }] },
    });

    expect(effectiveDisplay(state, {}, "problem")).toHaveLength(1);
    expect(effectiveDisplay(state, { problem: [] }, "problem")).toHaveLength(0);
  });
});

describe("filledBlockCount", () => {
  it("내용이 있는 블록만 센다", () => {
    const state = stateWith({
      display: {
        ...emptyExperienceBlockState().display,
        problem: [{ text: "문장", claimIds: [] }],
        action: [{ text: "문장", claimIds: [] }],
      },
    });

    expect(filledBlockCount(state, {})).toBe(2);
  });

  it("사용자가 비운 블록은 세지 않는다", () => {
    const state = stateWith({
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "문장", claimIds: [] }] },
    });

    expect(filledBlockCount(state, { problem: [] })).toBe(0);
  });

  it("빈 블록을 사용자가 채우면 센다", () => {
    expect(filledBlockCount(emptyExperienceBlockState(), { result: parseBlockEdit("직접 쓴 결과") })).toBe(1);
  });
});

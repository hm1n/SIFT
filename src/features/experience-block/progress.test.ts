import { describe, expect, it } from "vitest";
import { emptyInterviewProgress, PROGRESS_CONFIG, recordAsked, recordResponse, selectNextTarget } from "./progress";
import { BLOCK_KINDS, type BlockEvaluation, type BlockKind } from "./types";

function noEvaluation(): Readonly<Record<BlockKind, BlockEvaluation | null>> {
  return { problem: null, alternatives: null, action: null, result: null };
}

const ASKABLE: BlockEvaluation = { sufficient: false, askable: true, reason: "askable" };
const SUFFICIENT: BlockEvaluation = { sufficient: true, askable: false, reason: "sufficient" };
const NONE_LEFT: BlockEvaluation = { sufficient: false, askable: false, reason: "none" };

describe("recordAsked·recordResponse", () => {
  it("빈 진행 상태는 네 블록 모두 미방문이고 두 요소 모두 0회다", () => {
    const progress = emptyInterviewProgress();
    for (const block of BLOCK_KINDS) {
      expect(progress[block]).toEqual({
        visited: false,
        refused: false,
        elements: { a: { askedCount: 0, reaskUsed: false }, b: { askedCount: 0, reaskUsed: false } },
      });
    }
  });

  it("질문을 보내면 방문 표시와 해당 요소의 askedCount만 오른다", () => {
    const progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    expect(progress.problem.visited).toBe(true);
    expect(progress.problem.elements.a.askedCount).toBe(1);
    expect(progress.problem.elements.b.askedCount).toBe(0);
    expect(progress.alternatives.visited).toBe(false);
  });

  it("같은 요소에서 unknown을 설정값만큼 받으면 그 요소만 재질문 예산을 소진한다", () => {
    expect(PROGRESS_CONFIG.maxAsksAfterUnknown).toBe(2);
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown");
    expect(progress.problem.elements.a.reaskUsed).toBe(false); // 첫 unknown은 재질문 기회를 아직 남깁니다.

    progress = recordAsked(progress, "problem", "a"); // 다른 단서가 있어 다시 묻습니다.
    progress = recordResponse(progress, "problem", "a", "unknown");
    expect(progress.problem.elements.a.reaskUsed).toBe(true); // 두 번째 unknown으로 예산을 다 썼습니다.
    expect(progress.problem.elements.b.reaskUsed).toBe(false); // 다른 요소는 영향받지 않습니다.
  });

  it("unanswered는 unknown과 구분되어 재질문 예산을 쓰지 않는다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unanswered");
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unanswered");
    expect(progress.problem.elements.a.reaskUsed).toBe(false);
  });

  it("refused 응답은 그 블록 전체를 닫는다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "alternatives", "b");
    progress = recordResponse(progress, "alternatives", "b", "refused");
    expect(progress.alternatives.refused).toBe(true);
  });
});

describe("selectNextTarget", () => {
  it("첫 호출은 problem.a를 겨냥한다", () => {
    const target = selectNextTarget({
      evaluation: noEvaluation(),
      progress: emptyInterviewProgress(),
      turnsUsed: 0,
      maxTurns: 10,
      isEnded: false,
    });
    expect(target).toEqual({ kind: "ask", block: "problem", element: "a" });
  });

  it("사용자 종료나 턴 상한에 닿으면 done이다. 모델의 sufficient 판정에는 종료 권한이 없다", () => {
    const base = { evaluation: noEvaluation(), progress: emptyInterviewProgress(), maxTurns: 10 };
    expect(selectNextTarget({ ...base, turnsUsed: 3, isEnded: true })).toEqual({ kind: "done" });
    expect(selectNextTarget({ ...base, turnsUsed: 10, isEnded: false })).toEqual({ kind: "done" });
    // sufficient=false인 블록이 남아 있으면 상한에 닿기 전까지는 계속 질문합니다.
    expect(selectNextTarget({ ...base, turnsUsed: 9, isEnded: false }).kind).toBe("ask");
  });

  it("충분하거나 더 물을 것이 없는 블록은 건너뛰고 다음 미확인 블록으로 이동한다", () => {
    const target = selectNextTarget({
      evaluation: { problem: SUFFICIENT, alternatives: null, action: null, result: null },
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
      turnsUsed: 1,
      maxTurns: 10,
      isEnded: false,
    });
    expect(target).toEqual({ kind: "ask", block: "alternatives", element: "a" });
  });

  it("예약 예산: 남은 질문 수가 다른 미확인 블록 수 이하이면 진행 중인 블록을 멈추고 미확인 블록으로 이동한다", () => {
    // problem·alternatives·action은 방문했고 아직 askable입니다. result만 미확인입니다.
    let progress = emptyInterviewProgress();
    for (const block of ["problem", "alternatives", "action"] as const) progress = recordAsked(progress, block, "a");
    const evaluation = { problem: ASKABLE, alternatives: ASKABLE, action: ASKABLE, result: null };

    // 남은 질문 3(turnsUsed=7): 미확인 블록 1개 * 예약 1 = 1이므로 3 <= 1이 아니라 예약이 걸리지
    // 않고, 직전 블록(action)을 이어갑니다.
    const continuing = selectNextTarget({
      evaluation, progress, turnsUsed: 7, maxTurns: 10, isEnded: false,
      lastTarget: { block: "action", element: "a" },
    });
    expect(continuing).toEqual({ kind: "ask", block: "action", element: "b" });

    // 남은 질문 1(turnsUsed=9): 1 <= 1이므로 예약이 걸려 result로 강제 이동합니다.
    const reserved = selectNextTarget({
      evaluation, progress, turnsUsed: 9, maxTurns: 10, isEnded: false,
      lastTarget: { block: "action", element: "a" },
    });
    expect(reserved).toEqual({ kind: "ask", block: "result", element: "a" });
  });

  it("재질문 1회 제한: 요소 하나가 재질문 예산을 다 써도 같은 블록의 다른 요소는 계속 물을 수 있다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown");
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown"); // a 요소 재질문 소진

    const target = selectNextTarget({
      evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
      progress,
      turnsUsed: 2,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "problem", element: "a" },
    });
    expect(target).toEqual({ kind: "ask", block: "problem", element: "b" });
  });

  it("두 요소가 모두 재질문 예산을 다 쓰면 그 블록을 닫고 다음 블록으로 이동한다", () => {
    let progress = emptyInterviewProgress();
    for (const element of ["a", "b"] as const) {
      progress = recordAsked(progress, "problem", element);
      progress = recordResponse(progress, "problem", element, "unknown");
      progress = recordAsked(progress, "problem", element);
      progress = recordResponse(progress, "problem", element, "unknown");
    }
    const target = selectNextTarget({
      evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
      progress,
      turnsUsed: 4,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "problem", element: "b" },
    });
    expect(target).toEqual({ kind: "ask", block: "alternatives", element: "a" });
  });

  it("거절한 주제는 다시 묻지 않고 다음 블록으로 이동한다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "alternatives", "a");
    progress = recordResponse(progress, "alternatives", "a", "refused");

    const target = selectNextTarget({
      evaluation: { problem: SUFFICIENT, alternatives: ASKABLE, action: null, result: null },
      progress,
      turnsUsed: 2,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "alternatives", element: "a" },
    });
    expect(target).toEqual({ kind: "ask", block: "action", element: "a" });
  });

  it("유효한 질문 후보가 없으면 완료로 처리한다", () => {
    const evaluation = { problem: SUFFICIENT, alternatives: SUFFICIENT, action: NONE_LEFT, result: SUFFICIENT };
    const target = selectNextTarget({
      evaluation,
      progress: emptyInterviewProgress(),
      turnsUsed: 5,
      maxTurns: 10,
      isEnded: false,
    });
    expect(target).toEqual({ kind: "done" });
  });
});

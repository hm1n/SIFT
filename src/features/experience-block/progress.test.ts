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
    const emptyElement = { askedCount: 0, firstUnknownAskedCount: null };
    for (const block of BLOCK_KINDS) {
      expect(progress[block]).toEqual({
        visited: false,
        refused: false,
        elements: { a: emptyElement, b: emptyElement },
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

  /**
   * 아래 세 테스트는 모두 b 요소를 먼저 완전히 닫아 둡니다. selectNextTarget의 요소 선택은 열린
   * 요소 중 가장 적게 물은 쪽을 고르므로(같은 진행 상태의 다른 테스트 참고), b가 열려 있으면
   * askedCount가 더 낮은 쪽이 뽑혀 "a가 아직 열려 있는지"를 직접 확인할 수 없습니다. b를 먼저
   * 닫아 두면 a가 뽑히는지 여부만으로 a의 개폐 상태를 그대로 드러낼 수 있습니다.
   */
  function closeElementB(): ReturnType<typeof emptyInterviewProgress> {
    let progress = recordAsked(emptyInterviewProgress(), "problem", "b");
    progress = recordResponse(progress, "problem", "b", "unknown", progress.problem.elements.b.askedCount);
    progress = recordAsked(progress, "problem", "b");
    return recordResponse(progress, "problem", "b", "unknown", progress.problem.elements.b.askedCount);
  }

  it("같은 요소에서 unknown을 설정값만큼 받으면 그 요소만 재질문 예산을 소진한다", () => {
    expect(PROGRESS_CONFIG.maxAsksAfterUnknown).toBe(2);
    let progress = closeElementB();
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount);
    // 첫 unknown은 재질문 기회를 아직 남깁니다. b는 이미 닫혀 있으므로 a가 열려 있어야만 뽑힙니다.
    expect(
      selectNextTarget({
        evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
        progress,
        turnsUsed: 3,
        maxTurns: 10,
        isEnded: false,
        lastTarget: { block: "problem", element: "a" },
      })
    ).toEqual({ kind: "ask", block: "problem", element: "a" });

    progress = recordAsked(progress, "problem", "a"); // 다른 단서가 있어 다시 묻습니다.
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount);
    // 두 번째 unknown으로 a의 예산도 다 썼습니다. 두 요소 모두 닫혀 다음 블록으로 넘어갑니다.
    expect(
      selectNextTarget({
        evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
        progress,
        turnsUsed: 4,
        maxTurns: 10,
        isEnded: false,
        lastTarget: { block: "problem", element: "a" },
      })
    ).toEqual({ kind: "ask", block: "alternatives", element: "a" });
  });

  it("provided로 답한 요소를 다시 물었을 때 첫 unknown만으로는 소진되지 않는다 (구현검토 P1-1, R1)", () => {
    let progress = closeElementB();
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "provided", progress.problem.elements.a.askedCount);
    progress = recordAsked(progress, "problem", "a"); // 다른 이유로 같은 요소를 한 번 더 묻습니다.
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount);
    expect(progress.problem.elements.a.firstUnknownAskedCount).toBe(2); // 이번이 첫 unknown입니다.
    expect(
      selectNextTarget({
        evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
        progress,
        turnsUsed: 4,
        maxTurns: 10,
        isEnded: false,
        lastTarget: { block: "problem", element: "a" },
      })
    ).toEqual({ kind: "ask", block: "problem", element: "a" }); // 아직 재질문 기회가 남아 열려 있습니다.
  });

  it("unknown 뒤 재질문이 나가면 그 응답을 받기 전에도(진행 중이거나 실패해도) 예산을 소진한다 (추가 재검증 2026-09-12)", () => {
    // 평가 실패로 recordResponse가 두 번째 응답을 반영하지 못하는 상황을 재현합니다.
    // askedCount는 질문을 보내는 즉시 오르므로, 그 응답을 못 받아도 재질문 예산은 이미 소진돼야 합니다.
    let progress = closeElementB();
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount);
    progress = recordAsked(progress, "problem", "a"); // 재질문을 실제로 보냈습니다.
    // 이 재질문의 블록 갱신 호출이 실패해 recordResponse를 부르지 못했다고 가정합니다.

    const target = selectNextTarget({
      evaluation: { problem: ASKABLE, alternatives: null, action: null, result: null },
      progress,
      turnsUsed: 4,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "problem", element: "a" },
    });
    // a도 이미 닫혔고 b도 닫혔으므로 problem 전체가 닫혀 다음 블록으로 넘어가야 합니다. 응답을
    // 받지 못했다는 이유로 a를 또 고르면 안 됩니다.
    expect(target).toEqual({ kind: "ask", block: "alternatives", element: "a" });
  });

  it("늦게 도착한 이전 질문의 unknown 응답이 그 사이 더 최신 질문의 askedCount를 자기 것으로 삼지 않는다 (CodeRabbit PR #117)", () => {
    // 요소 a에 재질문(2번째 질문)을 보낸 뒤 그 응답이 오기 전에, 다른 사정으로 같은 요소에 3번째
    // 질문까지 나갔다고 가정합니다. 그다음 2번째 질문의 응답(unknown)이 뒤늦게 도착합니다.
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a"); // 1번째 질문, askedCount=1
    progress = recordAsked(progress, "problem", "a"); // 2번째 질문, askedCount=2
    progress = recordAsked(progress, "problem", "a"); // 3번째 질문, askedCount=3 (2번째 응답보다 먼저 나감)

    // 2번째 질문 시점의 askedCount(2)를 그대로 넘겨야 합니다. "지금" askedCount(3)를 쓰면 이
    // 요소가 실제보다 늦게 열린 것처럼 계산됩니다.
    progress = recordResponse(progress, "problem", "a", "unknown", 2);
    expect(progress.problem.elements.a.firstUnknownAskedCount).toBe(2);

    // 이 시점에서 재질문 예산(maxAsksAfterUnknown=2)은 이미 소진됩니다. askedCount(3) -
    // firstUnknownAskedCount(2) = 1 >= maxAsksAfterUnknown(2) - 1 = 1이 성립합니다.
    const target = selectNextTarget({
      evaluation: { problem: ASKABLE, alternatives: ASKABLE, action: null, result: null },
      progress,
      turnsUsed: 3,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "problem", element: "a" },
    });
    expect(target).not.toEqual({ kind: "ask", block: "problem", element: "a" });
  });

  it("unanswered는 unknown과 구분되어 재질문 예산을 쓰지 않는다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unanswered", progress.problem.elements.a.askedCount);
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unanswered", progress.problem.elements.a.askedCount);
    expect(progress.problem.elements.a.firstUnknownAskedCount).toBeNull();
  });

  it("refused 응답은 그 블록 전체를 닫는다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "alternatives", "b");
    progress = recordResponse(progress, "alternatives", "b", "refused", progress.alternatives.elements.b.askedCount);
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

  it("다른 답변에서 이미 평가받은 블록은 질문을 보낸 적이 없어도 미확인으로 예약하지 않는다 (구현검토 P2, R8)", () => {
    // problem만 직접 질문을 보냈습니다(visited=true). alternatives는 다른 답변에서 정보를 얻어
    // 평가는 있지만(evaluation !== null) 한 번도 직접 묻지 않았습니다(visited=false).
    const askable = { sufficient: false, askable: true, reason: "askable" as const };
    const next = selectNextTarget({
      evaluation: { problem: askable, alternatives: askable, action: null, result: null },
      progress: recordAsked(emptyInterviewProgress(), "problem", "a"),
      turnsUsed: 7,
      maxTurns: 10,
      isEnded: false,
      lastTarget: { block: "problem", element: "a" },
    });
    // alternatives를 미확인으로 잘못 세면 예약이 걸려 강제로 그쪽으로 이동합니다. 실제 미확인은
    // action·result뿐이라(둘 다 evaluation === null) 예약 조건(남은 3 <= 미확인 2 * 1)이 걸리지
    // 않고 problem을 이어갑니다.
    expect(next).toEqual({ kind: "ask", block: "problem", element: "b" });
  });

  it("재질문 1회 제한: 요소 하나가 재질문 예산을 다 써도 같은 블록의 다른 요소는 계속 물을 수 있다", () => {
    let progress = recordAsked(emptyInterviewProgress(), "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount);
    progress = recordAsked(progress, "problem", "a");
    progress = recordResponse(progress, "problem", "a", "unknown", progress.problem.elements.a.askedCount); // a 요소 재질문 소진

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
      progress = recordResponse(progress, "problem", element, "unknown", progress.problem.elements[element].askedCount);
      progress = recordAsked(progress, "problem", element);
      progress = recordResponse(progress, "problem", element, "unknown", progress.problem.elements[element].askedCount);
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
    progress = recordResponse(progress, "alternatives", "a", "refused", progress.alternatives.elements.a.askedCount);

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

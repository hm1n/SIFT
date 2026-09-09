import { describe, expect, it } from "vitest";
import {
  MODEL_PRICES,
  canonicalQuestionOf,
  datasetShortfall,
  UnknownModelPriceError,
  averageUsagePerRound,
  completeRounds,
  interviewCost,
  priceFor,
  questionGenerationCost,
  type UsageRow,
} from "./cost.mjs";

function row(round: number, turn: number, overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    round,
    turn,
    inputTokens: 1_000,
    outputTokens: 100,
    cacheReadTokens: 0,
    ...overrides,
  };
}

describe("모델별 단가", () => {
  it("gemini-3.5-flash-lite는 3.1과 다른 단가를 쓴다", () => {
    // 하나를 두 모델에 쓰면 3.5의 비용이 낮게 나오고, 비용으로 모델을 고르는 판단이 근거를
    // 잃습니다. 값은 `llm-wiki/wiki/2026-09-02-LLM-비용-산정.md` 2절과 같아야 합니다.
    expect(priceFor("gemini-3.5-flash-lite")).toEqual({
      input: 0.3,
      output: 2.5,
      cachedInput: 0.03,
    });
    expect(priceFor("gemini-3.1-flash-lite")).toEqual({
      input: 0.25,
      output: 1.5,
      cachedInput: 0.025,
    });
    expect(priceFor("gemini-3.5-flash-lite")).not.toEqual(priceFor("gemini-3.1-flash-lite"));
  });

  it("모르는 모델은 기본값으로 대신하지 않고 던진다", () => {
    // 기본값을 두면 새 모델의 비용이 다른 모델 단가로 계산되고 표는 정상으로 보입니다.
    expect(() => priceFor("gemini-3.6-flash")).toThrow(UnknownModelPriceError);
    expect(MODEL_PRICES["gemini-3.6-flash"]).toBeUndefined();
  });

  it("같은 usage에서 3.5가 3.1보다 비싸다", () => {
    const totals = { inputTokens: 100_000, cacheReadTokens: 0, outputTokens: 2_000 };

    const cheap = questionGenerationCost(totals, priceFor("gemini-3.1-flash-lite"));
    const expensive = questionGenerationCost(totals, priceFor("gemini-3.5-flash-lite"));

    expect(expensive).toBeGreaterThan(cheap);
  });
});

describe("캐시 읽기 몫", () => {
  it("캐시로 읽힌 입력은 입력 단가에서 빼고 캐시 단가로 센다", () => {
    // 캐시 읽기 토큰은 입력 토큰 안에 포함되어 옵니다. 빼지 않으면 두 번 셉니다.
    const price = priceFor("gemini-3.1-flash-lite");
    const withCache = questionGenerationCost(
      { inputTokens: 10_000, cacheReadTokens: 8_000, outputTokens: 0 },
      price
    );
    const withoutCache = questionGenerationCost(
      { inputTokens: 10_000, cacheReadTokens: 0, outputTokens: 0 },
      price
    );

    expect(withCache).toBeLessThan(withoutCache);
    expect(withCache).toBeCloseTo((2_000 * 0.25 + 8_000 * 0.025) / 1_000_000, 12);
  });
});

describe("온전하지 않은 회차", () => {
  it("턴이 빠진 회차는 비용 표에 들어가지 않는다", () => {
    // 중간에 끊긴 회차를 평균에 넣으면 빠진 턴이 0비용으로 세어져 회당 비용이 낮게 나옵니다.
    const rows = [
      ...[1, 2, 3].map((turn) => row(1, turn)),
      ...[1, 2].map((turn) => row(2, turn)),
    ];

    const selection = completeRounds(rows, 3);

    expect(selection.complete).toHaveLength(1);
    expect(selection.skipped).toEqual([2]);
  });

  it("usage가 없는 호출이 섞인 회차도 버린다", () => {
    // 실패한 호출의 토큰은 0이 아니라 모르는 값입니다. 0으로 두면 그 회차가 유난히 싸집니다.
    const rows = [
      ...[1, 2, 3].map((turn) => row(1, turn)),
      row(2, 1),
      row(2, 2, { inputTokens: null }),
      row(2, 3),
    ];

    const selection = completeRounds(rows, 3);

    expect(selection.complete).toHaveLength(1);
    expect(selection.skipped).toEqual([2]);
  });

  it("끊긴 회차를 버리면 남은 회차의 평균이 그대로 나온다", () => {
    const rows = [
      ...[1, 2, 3].map((turn) => row(1, turn)),
      ...[1, 2].map((turn) => row(2, turn)),
    ];

    const totals = averageUsagePerRound(completeRounds(rows, 3));

    // 온전한 회차 하나의 합입니다. 두 회차로 나누면 절반이 되어 조용히 낮아집니다.
    expect(totals).toEqual({ inputTokens: 3_000, cacheReadTokens: 0, outputTokens: 300 });
  });

  it("온전한 회차가 하나도 없으면 비용을 내지 않는다", () => {
    expect(averageUsagePerRound(completeRounds([row(1, 1)], 3))).toBeNull();
  });
});

describe("인터뷰 한 번", () => {
  it("Stage A·B 몫을 더한다", () => {
    const totals = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0 };

    expect(interviewCost(totals, priceFor("gemini-3.1-flash-lite"))).toBeCloseTo(0.02025, 12);
  });
});

describe("이력에 쌓을 질문 고르기", () => {
  it("첫 조각이 온 뒤 실패한 호출의 잘린 본문은 쓰지 않는다", () => {
    // 본문이 비었는지로 판정하면 이 경우가 성공으로 취급되어, 잘린 질문 위에 다음 턴을 쌓게
    // 됩니다. 그 뒤의 측정이 전부 망가진 이력 위에서 나옵니다.
    expect(
      canonicalQuestionOf({ failure: "총 시한에서 끊겼습니다.", text: "질문 앞부분만 도착" })
    ).toBeNull();
  });

  it("첫 조각 전에 실패한 호출도 쓰지 않는다", () => {
    expect(canonicalQuestionOf({ failure: "network error", text: "" })).toBeNull();
  });

  it("실패 없이 아무것도 내지 않은 응답도 쓰지 않는다", () => {
    expect(canonicalQuestionOf({ failure: null, text: "   " })).toBeNull();
  });

  it("성공한 호출의 본문은 그대로 쓴다", () => {
    expect(canonicalQuestionOf({ failure: null, text: "왜 이 구조를 골랐나요?" })).toBe(
      "왜 이 구조를 골랐나요?"
    );
  });
});

describe("표본 수 확인", () => {
  it("기대와 같으면 아무 말도 하지 않는다", () => {
    expect(datasetShortfall(120, 120)).toBeNull();
  });

  it("모자라면 문장을 돌려주되 던지지 않는다", () => {
    // 던지면 뒤에 있는 회차 제외와 비용 표와 질문 원문 저장이 모두 도달 불가능해집니다.
    // 온전하지 않은 회차를 걸러 내려고 만든 경로가 정작 그 상황에서 실행되지 않습니다.
    const message = datasetShortfall(120, 114);

    expect(message).toContain("120");
    expect(message).toContain("114");
  });
});

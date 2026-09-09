/**
 * 측정이 낸 usage를 회당 비용으로 바꾸는 순수 함수들입니다.
 *
 * 계산을 측정 스크립트 안에 두지 않고 떼어 낸 이유는 이 계산이 틀리면 조용히 틀리기 때문입니다.
 * 스크립트는 네트워크를 쓰므로 vitest 스위트에 넣지 않지만, 이 모듈은 입력과 출력이 값뿐이라
 * 회귀 테스트가 붙습니다.
 *
 * 1차 리뷰에서 두 가지가 지적됐습니다. 단가가 모델 하나 것만 있었고, 중간에 끊긴 회차가 결측 턴을
 * 0으로 세면서 비용 표에 들어갔습니다. 둘 다 표가 정상으로 보이면서 값만 틀리는 종류입니다.
 */

/** 백만 토큰당 달러입니다. `llm-wiki/wiki/2026-09-02-LLM-비용-산정.md` 2절과 같아야 합니다. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cachedInput: number;
}

/**
 * 모델마다 단가가 다릅니다. 하나를 모든 모델에 쓰면 비교가 조용히 틀립니다.
 *
 * `gemini-3.5-flash-lite`는 입력이 1.2배, 출력이 1.67배입니다. 이 차이를 무시하면 그 모델의 비용이
 * 낮게 나오고, 비용으로 모델을 고르는 이 측정의 결론이 근거를 잃습니다.
 */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5, cachedInput: 0.025 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, cachedInput: 0.03 },
};

/**
 * 단가를 모르는 모델이면 던집니다. 기본값으로 대신하지 않습니다.
 *
 * 기본값을 두면 `--models`에 새 모델을 넣었을 때 그 모델의 비용이 다른 모델 단가로 계산되고, 표는
 * 정상으로 보입니다. 이 측정이 지금 고치고 있는 결함이 정확히 그것입니다.
 */
export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    super(
      `${model}의 단가를 모릅니다. llm-wiki/wiki/2026-09-02-LLM-비용-산정.md 2절에서 확인해 MODEL_PRICES에 넣어 주세요.`
    );
    this.name = "UnknownModelPriceError";
  }
}

export function priceFor(model: string): ModelPrice {
  const price = MODEL_PRICES[model];
  if (price === undefined) throw new UnknownModelPriceError(model);
  return price;
}

/**
 * 질문 생성을 뺀 인터뷰 한 번의 LLM 비용입니다. Stage A와 Stage B 몫입니다.
 *
 * `wiki/2026-09-01-네-경로-LLM-모델-확정.md`의 전체 분석 + 첫 질문 0.02182달러에서 첫 질문 회당
 * 0.00157달러를 뺀 값입니다. 첫 질문은 측정이 턴 1로 직접 재므로 두 번 세지 않습니다.
 */
export const STAGE_COST_PER_INTERVIEW = 0.02182 - 0.00157;

export interface UsageRow {
  readonly round: number;
  readonly turn: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
}

export interface RoundSelection {
  /** 턴이 모두 있고 usage가 모두 잡힌 회차입니다. */
  readonly complete: readonly (readonly UsageRow[])[];
  /** 버린 회차 번호입니다. 표에 그 사실을 함께 적기 위해 들고 다닙니다. */
  readonly skipped: readonly number[];
}

/**
 * 온전한 회차만 고릅니다.
 *
 * 중간에 끊긴 회차를 평균에 넣으면 빠진 턴이 0비용으로 세어져 회당 비용이 낮게 나옵니다. 표는
 * 정상으로 보이는데 값만 틀리므로, 회차를 통째로 버리고 몇 회차를 버렸는지 함께 냅니다.
 *
 * `usage`가 null인 호출도 온전하지 않은 것으로 봅니다. 실패한 호출의 토큰은 0이 아니라 모르는
 * 값입니다. 0으로 두면 그 회차가 유난히 싼 회차가 됩니다.
 */
export function completeRounds(
  rows: readonly UsageRow[],
  expectedTurns: number
): RoundSelection {
  const byRound = new Map<number, UsageRow[]>();
  for (const row of rows) {
    const bucket = byRound.get(row.round);
    if (bucket === undefined) byRound.set(row.round, [row]);
    else bucket.push(row);
  }

  const complete: UsageRow[][] = [];
  const skipped: number[] = [];
  for (const round of [...byRound.keys()].sort((left, right) => left - right)) {
    const bucket = byRound.get(round)!;
    const turns = new Set(bucket.map((row) => row.turn));
    const measured = bucket.every(
      (row) =>
        row.inputTokens !== null && row.outputTokens !== null && row.cacheReadTokens !== null
    );
    if (turns.size === expectedTurns && bucket.length === expectedTurns && measured) {
      complete.push(bucket);
      continue;
    }
    skipped.push(round);
  }
  return { complete, skipped };
}

export interface UsageTotals {
  readonly inputTokens: number;
  readonly cacheReadTokens: number;
  readonly outputTokens: number;
}

/** 온전한 회차들의 회차당 평균입니다. 회차가 없으면 null입니다. */
export function averageUsagePerRound(selection: RoundSelection): UsageTotals | null {
  if (selection.complete.length === 0) return null;
  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  for (const round of selection.complete) {
    for (const row of round) {
      inputTokens += row.inputTokens ?? 0;
      cacheReadTokens += row.cacheReadTokens ?? 0;
      outputTokens += row.outputTokens ?? 0;
    }
  }
  const rounds = selection.complete.length;
  return {
    inputTokens: inputTokens / rounds,
    cacheReadTokens: cacheReadTokens / rounds,
    outputTokens: outputTokens / rounds,
  };
}

/**
 * 질문 생성 몫입니다. 캐시로 읽힌 입력은 캐시 단가로 셉니다.
 *
 * 캐시 읽기 토큰은 입력 토큰 안에 포함되어 오므로 빼고 계산합니다. 빼지 않으면 그 몫을 두 번
 * 세게 됩니다.
 */
export function questionGenerationCost(totals: UsageTotals, price: ModelPrice): number {
  const uncached = Math.max(0, totals.inputTokens - totals.cacheReadTokens);
  return (
    (uncached * price.input +
      totals.cacheReadTokens * price.cachedInput +
      totals.outputTokens * price.output) /
    1_000_000
  );
}

/** 인터뷰 한 번의 LLM 비용입니다. Stage A·B 몫을 더합니다. */
export function interviewCost(totals: UsageTotals, price: ModelPrice): number {
  return STAGE_COST_PER_INTERVIEW + questionGenerationCost(totals, price);
}

/**
 * 이력에 쌓을 질문을 고릅니다. 쌓을 수 없으면 null입니다.
 *
 * **본문이 비었는지로 판정하지 않습니다.** 재검증 라운드에서 나온 지적입니다. 첫 조각이 도착한 뒤
 * 오류나 중단이 나면 본문은 남아 있는데 질문은 완성되지 않았습니다. 빈 문자열을 실패의 대리 지표로
 * 쓰면 그 잘린 본문이 성공으로 취급되어 다음 턴부터 망가진 이력 위에서 측정하게 됩니다.
 *
 * 실패 여부는 직접 나타내는 값인 `failure`로 봅니다. 본문이 비어 있는 경우도 함께 걸러 냅니다.
 * 실패 없이 아무것도 내지 않은 응답으로는 다음 턴을 만들 수 없기 때문입니다.
 */
export function canonicalQuestionOf(measurement: {
  readonly failure: string | null;
  readonly text: string;
}): string | null {
  if (measurement.failure !== null) return null;
  if (measurement.text.trim() === "") return null;
  return measurement.text;
}

/**
 * 표본 수가 기대와 다른지 봅니다. 다르면 사람이 읽을 문장을, 같으면 null을 돌려줍니다.
 *
 * **던지지 않습니다.** 재검증 라운드에서 나온 지적입니다. 앞 단계에서 던지면 뒤에 있는 회차 제외와
 * 비용 표와 질문 원문 저장이 모두 도달 불가능해집니다. 온전하지 않은 회차를 걸러 내려고 만든 경로가
 * 정작 그 상황에서 실행되지 않았습니다.
 *
 * 대신 실행이 끝날 때 종료 코드로 알립니다. 값을 감추지 않으면서도 온전하지 않은 실행을 온전한
 * 실행과 구별할 수 있습니다.
 */
export function datasetShortfall(expected: number, actual: number): string | null {
  if (expected === actual) return null;
  return (
    `표본 수가 기대와 다릅니다. 기대 ${expected}건, 실제 ${actual}건. ` +
    `중간에 끊긴 회차가 있습니다. 아래 표는 온전한 회차만으로 낸 값이고, 문서에는 이 실행의 값을 ` +
    `온전한 실행의 값으로 옮기지 마세요.`
  );
}

export const ANALYSIS_USAGE_PATH = "/api/usage/analysis";

/** 오늘 쓴 분석 횟수와 상한, 그리고 풀리는 시각입니다. */
export interface AnalysisUsage {
  readonly used: number;
  readonly limit: number;
  /** ISO 8601 문자열입니다. 서버가 한국 날짜 기준으로 계산해 실어 보냅니다. */
  readonly resetAt: string;
}

/**
 * 오늘 쓴 분석 횟수를 읽습니다(이슈 #142).
 *
 * 실패를 종류로 가르지 않고 `null`을 돌려줍니다. 이 값은 화면 아래의 안내 한 줄이고, 읽지 못했다고
 * 해서 사용자가 할 수 있는 일이 달라지지 않기 때문입니다. 상한은 어차피 Stage A 라우트가 집행하므로
 * 읽기 실패를 오류 화면으로 올리면 분석을 시작할 수 있는 사용자까지 막게 됩니다.
 *
 * 같은 이유로 모양이 어긋난 응답도 `null`입니다. 숫자가 아닌 값을 그대로 그리면 `NaN/3회 사용` 같은
 * 문구가 나갑니다.
 */
export async function fetchAnalysisUsage(): Promise<AnalysisUsage | null> {
  let response: Response;
  try {
    response = await fetch(ANALYSIS_USAGE_PATH);
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  return isAnalysisUsage(payload) ? payload : null;
}

function isAnalysisUsage(value: unknown): value is AnalysisUsage {
  if (typeof value !== "object" || value === null) return false;
  const usage = value as Partial<AnalysisUsage>;
  return (
    Number.isInteger(usage.used) &&
    (usage.used as number) >= 0 &&
    Number.isInteger(usage.limit) &&
    (usage.limit as number) > 0 &&
    typeof usage.resetAt === "string"
  );
}

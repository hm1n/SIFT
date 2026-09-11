/**
 * 디자인의 `Candidate.period`·`commitCount`에 대응하는 값을 스키마 변경 없이 화면에서 유도합니다.
 * 대표 커밋과 관련 커밋의 `date`(둘 다 `ReadonlyCommitDetail`에 이미 있음) 최소~최대로 기간을 잡습니다.
 * 목록 행과 상세 양쪽이 같은 값을 써야 해서 여기 하나로 모읍니다.
 */
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short" });
const MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric" });

export interface CandidatePeriod {
  readonly start: string;
  readonly end: string;
}

export function formatCommitDate(dateIso: string): string {
  return MONTH_DAY_YEAR_FORMAT.format(new Date(dateIso));
}

/** `dates`는 대표 커밋과 관련 커밋의 `date`를 모은 값입니다. 하나도 없으면(색인 실패 등) null입니다. */
export function deriveCandidatePeriod(dates: readonly string[]): CandidatePeriod | null {
  if (dates.length === 0) return null;
  const sorted = [...dates].sort();
  return {
    start: MONTH_YEAR_FORMAT.format(new Date(sorted[0])),
    end: MONTH_YEAR_FORMAT.format(new Date(sorted[sorted.length - 1])),
  };
}

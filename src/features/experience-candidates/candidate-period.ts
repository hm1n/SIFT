import type { ReadonlyCommitDetail } from "@/lib/github/types";

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

/** 화면 문구는 디자인대로 영어라 단수·복수를 구분합니다. `count`가 1이면 단수형을 씁니다. */
export function pluralCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** 목록 행·상세가 공통으로 쓰는 표시용 제목입니다. 색인에서 커밋을 못 찾으면 SHA 7자리로 대신합니다. */
export function commitTitle(commit: ReadonlyCommitDetail | null, sha: string): string {
  return commit?.title ?? `Commit not indexed · ${sha.slice(0, 7)}`;
}

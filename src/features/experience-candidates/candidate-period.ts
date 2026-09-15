import type { ReadonlyCommitDetail } from "@/lib/github/types";
import type { ExperienceCandidate } from "./types";

/**
 * 디자인의 `Candidate.period`·`commitCount`에 대응하는 값을 스키마 변경 없이 화면에서 유도합니다.
 * 대표 커밋과 관련 커밋의 `date`(둘 다 `ReadonlyCommitDetail`에 이미 있음) 최소~최대로 기간을 잡습니다.
 * 목록 행과 상세 양쪽이 같은 값을 써야 해서 여기 하나로 모읍니다.
 */
const MONTH_YEAR_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short" });
const MONTH_DAY_YEAR_FORMAT = new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" });

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

/**
 * `3 commits`처럼 수량을 세는 문구는 영어로 남깁니다(이슈 #128 사용자 결정). 세는 단위가 mono로
 * 그려지는 developer metadata 쪽 표기라 한국어 문장과 섞여도 시각 언어가 갈리지 않습니다.
 * `count`가 1이면 단수형을 씁니다.
 */
export function pluralCount(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** 근거 목록의 커밋 한 줄에 쓰는 제목입니다. 색인에서 커밋을 못 찾으면 SHA 7자리로 대신합니다. */
export function commitTitle(commit: ReadonlyCommitDetail | null, sha: string): string {
  return commit?.title ?? `색인되지 않은 커밋 · ${sha.slice(0, 7)}`;
}

/**
 * 목록 행과 상세 `h2`가 공통으로 쓰는 후보 제목입니다.
 *
 * 대표 커밋 제목을 그대로 쓰면 conventional commit의 type prefix가 드러나 후보가 어떤 경험인지
 * 알기 어려워 `summary`로 바꿨습니다(이슈 #110). 스키마가 빈 `summary`를 허용하므로 비었을 때는
 * 이전대로 대표 커밋 제목을 씁니다. 목록과 상세가 서로 다른 제목을 보이지 않도록 한 곳에 둡니다.
 */
export function candidateTitle(
  candidate: Pick<ExperienceCandidate, "sha" | "summary">,
  commit: ReadonlyCommitDetail | null
): string {
  return candidate.summary.trim() || commitTitle(commit, candidate.sha);
}

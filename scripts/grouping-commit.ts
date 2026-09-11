import type { CommitDetail } from "../src/lib/github/types";

/** 묶기에 쓰는 필드만 고릅니다. patch는 쓰지 않습니다. */
export interface GroupingCommit {
  readonly sha: string;
  readonly title: string;
  readonly message: string;
  readonly time: number;
  readonly paths: readonly string[];
  readonly dirs: readonly string[];
  readonly pullRequestNumber: number | null;
}

function dirOf(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/**
 * 작성자 날짜가 없으면(`commits.ts`·`contributions.ts`가 `date: ""`로 채웁니다) `null`을
 * 돌려줍니다. 시간 없이 억지로 정렬·묶기에 넣으면 정렬 순서가 무너지고, session-gap류 규칙은
 * 시간 간격을 잴 수 없어 무관한 커밋을 하나로 묶을 수 있고, `--dump`의 `toISOString()`은 던집니다
 * (Codex 리뷰, 이슈 #101). 이 스크립트는 시간축이 전제이므로 정규화 대신 대상에서 뺍니다.
 *
 * `measure-grouping.mts`에서 이 함수만 떼어 둔 이유는, 그 파일이 top-level에서 `process.argv`를
 * 읽고 `process.exit`하는 CLI라 가져오는 것만으로 테스트 러너가 죽기 때문입니다. 이 파일은 부작용이
 * 없는 순수 함수만 두어 회귀 테스트가 CLI 실행 없이 바로 이 함수를 확인할 수 있게 합니다.
 */
export function toGroupingCommit(detail: CommitDetail): GroupingCommit | null {
  const time = new Date(detail.date).getTime();
  if (Number.isNaN(time)) return null;
  const paths = detail.files.map(({ path }) => path);
  return {
    sha: detail.sha,
    title: detail.title,
    message: detail.message,
    time,
    paths,
    dirs: [...new Set(paths.map(dirOf))],
    pullRequestNumber: detail.pullRequests.reduce<number | null>(
      (min, { number }) => (min === null || number < min ? number : min),
      null
    ),
  };
}

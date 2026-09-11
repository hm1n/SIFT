/**
 * PR 없는 저장소의 커밋 묶음 방식 측정 (층 0: 구조 지표, LLM 없음)
 *
 * 사용법:
 *   npx tsx scripts/measure-grouping.mts <cache.json> [--rules=a,b] [--dump=<rule>]
 *
 * 입력은 `measure-pipeline.ts <owner> <repo> details --cache=<경로>`가 만든 CommitDetail[] 캐시입니다.
 * 캐시는 블랙리스트 통과분만 담고 있으므로 모든 방식이 같은 커밋 집합을 받습니다.
 *
 * measure-pipeline.ts에 phase를 추가하지 않은 이유는 입력이 캐시 파일이고 GitHub 토큰이 필요
 * 없어 실행 조건이 다르기 때문입니다. 배경과 판정 기준은
 * `llm-wiki/wiki/2026-09-10-PR-없는-저장소-커밋-묶음-방식-실험.md`에 있습니다.
 *
 * 각 묶음 방식은 같은 입력을 받는 순수 함수이며 `RULES`에 등록합니다. 스크립트는 목록을 순회해
 * 방식별 구조 지표 표 하나를 냅니다. 층 0의 목적은 붕괴 감지입니다. 저장소 대부분이 한 묶음이
 * 되는 방식과 1개짜리가 대부분인 방식을 떨어뜨립니다.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import type { CommitDetail } from "../src/lib/github/types";

const [cachePath, ...rest] = process.argv.slice(2);
if (!cachePath) {
  console.log("사용법: npx tsx scripts/measure-grouping.mts <cache.json> [--rules=a,b] [--dump=<rule>]");
  process.exit(1);
}

const option = (name: string) =>
  rest.find((item) => item.startsWith(`--${name}=`))?.slice(`--${name}=`.length);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** 묶기에 쓰는 필드만 고릅니다. patch는 쓰지 않습니다. */
interface GroupingCommit {
  readonly sha: string;
  readonly title: string;
  readonly message: string;
  readonly time: number;
  readonly paths: readonly string[];
  readonly dirs: readonly string[];
  readonly pullRequestNumber: number | null;
}

/** 묶음은 SHA 배열입니다. 방식은 입력 순서(시간 오름차순)를 바꾸지 않습니다. */
type GroupingRule = (commits: readonly GroupingCommit[]) => readonly string[][];

function toGroupingCommit(detail: CommitDetail): GroupingCommit {
  const paths = detail.files.map(({ path }) => path);
  return {
    sha: detail.sha,
    title: detail.title,
    message: detail.message,
    time: new Date(detail.date).getTime(),
    paths,
    dirs: [...new Set(paths.map(dirOf))],
    pullRequestNumber: detail.pullRequests.reduce<number | null>(
      (min, { number }) => (min === null || number < min ? number : min),
      null
    ),
  };
}

function dirOf(path: string) {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

function overlaps(a: readonly string[], b: readonly string[]) {
  const set = new Set(a);
  return b.some((item) => set.has(item));
}

/** 서로소 집합. 전이 병합을 그대로 재현하기 위해 씁니다. */
class UnionFind {
  private readonly parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }
  find(index: number): number {
    while (this.parent[index] !== index) {
      this.parent[index] = this.parent[this.parent[index]];
      index = this.parent[index];
    }
    return index;
  }
  union(a: number, b: number) {
    this.parent[this.find(a)] = this.find(b);
  }
  groups(commits: readonly GroupingCommit[]): string[][] {
    const byRoot = new Map<number, string[]>();
    commits.forEach((commit, index) => {
      const root = this.find(index);
      const group = byRoot.get(root);
      if (group === undefined) byRoot.set(root, [commit.sha]);
      else group.push(commit.sha);
    });
    return [...byRoot.values()];
  }
}

// ── 축 0. 기준선 ────────────────────────────────────────────────────────────

/**
 * 2026-09-11 이전 프로덕션 규칙을 그대로 재현한 기준선입니다. PR 없는 커밋은 묶지 않고
 * 버리므로 PR 저장소에서만 뜻이 있습니다.
 *
 * 프로덕션의 `groupCommitsIntoWorkUnits`를 그대로 불러 쓰지 않고 여기서 직접 재현합니다.
 * 이슈 #101로 그 함수가 PR 없는 커밋도 커밋 하나짜리 단위로 포함하도록 바뀌어, 그대로 부르면
 * 이 기준선이 정의한 "PR 없으면 제외"라는 층 0 실험 설계와 달라집니다(Codex 리뷰). 이 기준선은
 * 비교 대상이 되는 고정값이므로 프로덕션 규칙이 바뀌어도 값이 바뀌면 안 됩니다.
 */
const prBaseline: GroupingRule = (commits) => {
  const groups = new Map<number, string[]>();
  const order: number[] = [];
  for (const commit of commits) {
    if (commit.pullRequestNumber === null) continue;
    const existing = groups.get(commit.pullRequestNumber);
    if (existing === undefined) {
      groups.set(commit.pullRequestNumber, [commit.sha]);
      order.push(commit.pullRequestNumber);
      continue;
    }
    existing.push(commit.sha);
  }
  return order.map((number) => groups.get(number)!);
};

// ── 축 1-c. 세션 경계 ───────────────────────────────────────────────────────

/** 시간 오름차순에서 인접 커밋 간격이 N시간 이상이면 새 묶음. 파일 신호를 쓰지 않습니다. */
const sessionGap =
  (hours: number): GroupingRule =>
  (commits) => {
    const groups: string[][] = [];
    commits.forEach((commit, index) => {
      const previous = commits[index - 1];
      if (previous === undefined || commit.time - previous.time >= hours * HOUR_MS) {
        groups.push([commit.sha]);
        return;
      }
      groups.at(-1)!.push(commit.sha);
    });
    return groups;
  };

// ── 4-2절 다섯 규칙 재현 ────────────────────────────────────────────────────

/**
 * 경로(또는 디렉터리) 겹침이 있는 모든 쌍을 잇고 전이 폐쇄를 취합니다. `withinHours`가 있으면
 * 두 커밋 시각 차이가 그 안일 때만 잇습니다.
 */
const overlapClosure =
  (key: "paths" | "dirs", withinHours?: number): GroupingRule =>
  (commits) => {
    const uf = new UnionFind(commits.length);
    for (let i = 0; i < commits.length; i += 1) {
      for (let j = i + 1; j < commits.length; j += 1) {
        if (withinHours !== undefined && commits[j].time - commits[i].time > withinHours * HOUR_MS) break;
        if (overlaps(commits[i][key], commits[j][key])) uf.union(i, j);
      }
    }
    return uf.groups(commits);
  };

/**
 * 정확 경로 겹침에 묶음 크기 상한을 둔 탐욕 규칙. 시간 순으로 보면서 겹치는 기존 묶음 중 상한
 * 미만인 가장 최근 묶음에 붙입니다. 4-2절의 원본 구현은 남아 있지 않아 근사 재현입니다.
 */
const pathOverlapCapped =
  (maxSize: number): GroupingRule =>
  (commits) => {
    const groups: { shas: string[]; paths: Set<string> }[] = [];
    for (const commit of commits) {
      const target = [...groups]
        .reverse()
        .find((group) => group.shas.length < maxSize && commit.paths.some((path) => group.paths.has(path)));
      if (target === undefined) {
        groups.push({ shas: [commit.sha], paths: new Set(commit.paths) });
        continue;
      }
      target.shas.push(commit.sha);
      commit.paths.forEach((path) => target.paths.add(path));
    }
    return groups.map(({ shas }) => shas);
  };

// ── 축 1-a. 다중 신호 점수화 ────────────────────────────────────────────────

const CONVENTIONAL_PREFIX = /^([a-z]+)(?:\([^)]*\))?!?:/i;
const ISSUE_NUMBER = /#(\d+)/g;

function prefixOf(title: string) {
  return CONVENTIONAL_PREFIX.exec(title)?.[1]?.toLowerCase() ?? null;
}

function issuesOf(message: string) {
  return new Set([...message.matchAll(ISSUE_NUMBER)].map((match) => match[1]));
}

/** 인접 커밋 쌍의 연결 점수. 시간·경로·접두어·이슈 번호를 함께 봅니다. */
function adjacencyScore(a: GroupingCommit, b: GroupingCommit) {
  let score = 0;
  const gap = b.time - a.time;
  if (gap <= 2 * HOUR_MS) score += 2;
  else if (gap <= 24 * HOUR_MS) score += 1;
  if (overlaps(a.paths, b.paths)) score += 2;
  else if (overlaps(a.dirs, b.dirs)) score += 1;
  const prefixA = prefixOf(a.title);
  if (prefixA !== null && prefixA === prefixOf(b.title)) score += 1;
  const issuesA = issuesOf(a.message);
  if ([...issuesOf(b.message)].some((issue) => issuesA.has(issue))) score += 2;
  return score;
}

/**
 * 시간 순 인접 쌍만 잇습니다. 전이 병합은 인접 사슬로만 일어나므로 경로 겹침 전이 폐쇄처럼
 * 멀리 떨어진 커밋을 끌어오지 않습니다.
 */
const adjacentScore =
  (threshold: number): GroupingRule =>
  (commits) => {
    const groups: string[][] = [];
    commits.forEach((commit, index) => {
      const previous = commits[index - 1];
      if (previous === undefined || adjacencyScore(previous, commit) < threshold) {
        groups.push([commit.sha]);
        return;
      }
      groups.at(-1)!.push(commit.sha);
    });
    return groups;
  };

const RULES: Record<string, GroupingRule> = {
  "pr-baseline": prBaseline,
  "session-2h": sessionGap(2),
  "session-6h": sessionGap(6),
  "session-12h": sessionGap(12),
  "session-24h": sessionGap(24),
  "session-72h": sessionGap(72),
  "path-exact": overlapClosure("paths"),
  "path-exact-max8": pathOverlapCapped(8),
  "path-exact-72h": overlapClosure("paths", 72),
  "dir-overlap": overlapClosure("dirs"),
  "dir-overlap-24h": overlapClosure("dirs", 24),
  "dir-overlap-6h": overlapClosure("dirs", 6),
  "score-t2": adjacentScore(2),
  "score-t3": adjacentScore(3),
  "score-t4": adjacentScore(4),
};

// ── 지표 ────────────────────────────────────────────────────────────────────

function percentile(sorted: readonly number[], fraction: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

interface RuleMetrics {
  rule: string;
  groups: number;
  covered: number;
  singletonRatio: number;
  medianSize: number;
  p90Size: number;
  maxSize: number;
  medianSpanDays: number;
  maxSpanDays: number;
  /** PR 소속을 정답으로 둔 커밋 가중 순도. PR 저장소에서만 참고 지표로 봅니다. */
  purity: number | null;
}

function measure(rule: string, groups: readonly string[][], bySha: Map<string, GroupingCommit>, hasPr: boolean): RuleMetrics {
  const sizes = groups.map((group) => group.length).sort((a, b) => a - b);
  const spans = groups
    .map((group) => {
      const times = group.map((sha) => bySha.get(sha)!.time);
      return Math.max(1, Math.ceil((Math.max(...times) - Math.min(...times)) / DAY_MS));
    })
    .sort((a, b) => a - b);
  const covered = sizes.reduce((sum, size) => sum + size, 0);
  let purity: number | null = null;
  if (hasPr) {
    let majority = 0;
    for (const group of groups) {
      const counts = new Map<string, number>();
      for (const sha of group) {
        const label = String(bySha.get(sha)!.pullRequestNumber ?? `none:${sha}`);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      majority += Math.max(...counts.values());
    }
    purity = covered === 0 ? 0 : majority / covered;
  }
  return {
    rule,
    groups: groups.length,
    covered,
    singletonRatio: groups.length === 0 ? 0 : sizes.filter((size) => size === 1).length / groups.length,
    medianSize: percentile(sizes, 0.5),
    p90Size: percentile(sizes, 0.9),
    maxSize: sizes.at(-1) ?? 0,
    medianSpanDays: percentile(spans, 0.5),
    maxSpanDays: spans.at(-1) ?? 0,
    purity,
  };
}

const pct = (value: number) => `${Math.round(value * 100)}%`;

function printTable(rows: readonly RuleMetrics[], hasPr: boolean) {
  const header = ["방식", "묶음", "포함 커밋", "1개짜리", "크기 중앙", "크기 p90", "최대", "기간 중앙(일)", "기간 최대(일)"];
  if (hasPr) header.push("PR 순도");
  const lines = rows.map((row) => {
    const cells = [
      row.rule,
      row.groups,
      row.covered,
      pct(row.singletonRatio),
      row.medianSize,
      row.p90Size,
      row.maxSize,
      row.medianSpanDays,
      row.maxSpanDays,
    ];
    if (hasPr) cells.push(row.purity === null ? "-" : pct(row.purity));
    return `| ${cells.join(" | ")} |`;
  });
  console.log(`| ${header.join(" | ")} |`);
  console.log(`| ${header.map(() => "---").join(" | ")} |`);
  lines.forEach((line) => console.log(line));
}

function dumpGroups(groups: readonly string[][], bySha: Map<string, GroupingCommit>) {
  groups.forEach((group, index) => {
    const commits = group.map((sha) => bySha.get(sha)!);
    const first = new Date(Math.min(...commits.map((c) => c.time))).toISOString().slice(0, 16);
    const last = new Date(Math.max(...commits.map((c) => c.time))).toISOString().slice(0, 16);
    console.log(`\n#${index + 1} (${group.length}커밋, ${first} ~ ${last})`);
    commits.forEach((commit) =>
      console.log(
        `  ${commit.sha.slice(0, 7)} ${new Date(commit.time).toISOString().slice(0, 16)} ` +
          `${commit.pullRequestNumber === null ? "  -  " : `PR#${commit.pullRequestNumber}`} ${commit.title}`
      )
    );
  });
}

// ── 실행 ────────────────────────────────────────────────────────────────────

const details = JSON.parse(readFileSync(cachePath, "utf8")) as CommitDetail[];
const commits = details.map(toGroupingCommit).sort((a, b) => a.time - b.time);
const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
const withPr = commits.filter((commit) => commit.pullRequestNumber !== null).length;
const hasPr = withPr > 0;
const prCount = new Set(commits.map((commit) => commit.pullRequestNumber).filter((n) => n !== null)).size;
const spanDays = commits.length === 0 ? 0 : Math.ceil((commits.at(-1)!.time - commits[0].time) / DAY_MS);

console.log(`## ${basename(cachePath, ".json")}`);
console.log(
  `커밋 ${commits.length}개(블랙리스트 통과분), PR 소속 ${withPr}개, PR ${prCount}개, 기간 ${spanDays}일`
);
console.log("");

const selected = option("rules")?.split(",") ?? Object.keys(RULES);
const rows = selected.map((rule) => {
  const fn = RULES[rule];
  if (fn === undefined) {
    console.log(`알 수 없는 방식: ${rule}. 사용 가능: ${Object.keys(RULES).join(", ")}`);
    process.exit(1);
  }
  return measure(rule, fn(commits), bySha, hasPr);
});
printTable(rows, hasPr);

const dump = option("dump");
if (dump !== undefined) {
  const fn = RULES[dump];
  if (fn === undefined) {
    console.log(`알 수 없는 방식: ${dump}`);
    process.exit(1);
  }
  console.log(`\n### ${dump} 묶음 목록`);
  dumpGroups(fn(commits), bySha);
}

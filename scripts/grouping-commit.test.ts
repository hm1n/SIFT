import { describe, expect, it } from "vitest";
import { toGroupingCommit } from "./grouping-commit";
import type { CommitDetail } from "../src/lib/github/types";

function detail(overrides: Partial<CommitDetail> = {}): CommitDetail {
  return {
    sha: "a".repeat(40),
    title: "제목",
    author: "user",
    parentCount: 1,
    message: "제목\n\n본문",
    date: "2026-09-01T00:00:00Z",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "diff" }],
    pullRequests: [],
    ...overrides,
  };
}

describe("toGroupingCommit", () => {
  it("정상 날짜는 그룹핑 커밋으로 바꾼다", () => {
    const result = toGroupingCommit(detail());
    expect(result).not.toBeNull();
    expect(result!.time).toBe(new Date("2026-09-01T00:00:00Z").getTime());
  });

  it("작성자 날짜가 빈 문자열이면 null을 돌려준다", () => {
    expect(toGroupingCommit(detail({ date: "" }))).toBeNull();
  });
});

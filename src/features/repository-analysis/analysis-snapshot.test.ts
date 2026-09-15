import { describe, expect, it } from "vitest";
import type { StageBCandidateResult } from "@/features/experience-candidates/types";
import { toExcludedUnitSummary } from "@/features/experience-candidates/work-unit-selection";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import { buildStoredAnalysis } from "./analysis-snapshot";
import type { StageASelectionState } from "./repository-analysis";

function commit(sha: string, patch: string | undefined = "@@ -1 +1 @@"): ReadonlyCommitDetail {
  return {
    sha,
    title: `${sha} 제목`,
    author: "hm1n",
    date: "2026-09-01T00:00:00Z",
    parentCount: 1,
    message: `${sha} 본문`,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch }],
    pullRequests: [],
  };
}

function data(...shas: string[]): CandidateDataOutput {
  return {
    allCommits: shas.map((sha) => ({ sha, title: "", author: "hm1n", date: "", parentCount: 1 })),
    includedCommits: shas.map((sha) => commit(sha)),
    repository: { fileTree: [{ path: "src/a.ts", type: "blob", sha: "tree-1" }], treeTruncated: false, languages: { TypeScript: 100 } },
  };
}

const CANDIDATES: StageBCandidateResult = {
  candidates: [
    {
      sha: "c1",
      relatedShas: ["c2"],
      summary: "스트리밍 렌더링 최적화",
      evidence: "근거",
      technicalTopics: ["React"],
      citedFilePaths: ["src/a.ts"],
      source: "contribution_match",
    },
  ],
  insufficientCandidatesReason: null,
  diffs: [{ sha: "c1", files: [{ path: "src/a.ts", status: "modified", additions: 1, deletions: 0, changes: 1, patch: "@@ diff @@" }] }],
};

/**
 * 제외된 묶음은 Stage A가 낼 때 `unit.commits`에 커밋 상세를 통째로 들고 있습니다. 그것을 버리는 일은
 * 분석 상태를 만드는 자리(`repository-analysis.ts`)가 하므로, 이 fixture도 같은 변환을 지나온 값으로
 * 만듭니다. 손으로 줄인 모양을 적으면 변환이 깨져도 이 테스트는 통과합니다.
 */
const STAGE_A: StageASelectionState = {
  excludedUnits: [
    toExcludedUnitSummary({
      unit: {
        kind: "pull_request",
        unitId: "pr:42",
        title: "배포 실패 대응",
        pullRequest: { number: 42, title: "배포 실패 대응", state: "closed", baseBranch: "main", headBranch: "fix" },
        commits: [commit("c9")],
      },
      score: 7,
      reason: "over_input_budget",
      signals: ["many_files"],
    }),
    toExcludedUnitSummary({
      unit: { kind: "commit", unitId: "commit:c8", title: "잡무", commits: [commit("c8")] },
      score: 1,
      reason: "over_byte_budget",
      signals: [],
    }),
  ],
  selectedUnitCount: 3,
  thresholdScore: 5,
  unjudgedShas: ["c7"],
};

const INPUT = {
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: ["성능 개선"],
  data: data("c1", "c2", "c3"),
  candidates: CANDIDATES,
  stageASelection: STAGE_A,
};

describe("분석 저장 축약본", () => {
  it("최종 후보가 가리키는 커밋만 남긴다", () => {
    const stored = buildStoredAnalysis(INPUT);
    expect(stored.candidates.includedCommits.map((c) => c.sha)).toEqual(["c1", "c2"]);
  });

  /**
   * patch 본문을 두 곳에 두면 Stage B가 묶어 둔 총량 상한이 두 배가 됩니다. 본문은 `diffs`에만
   * 남기고 커밋 쪽에서는 지웁니다.
   */
  it("남긴 커밋에서 patch 본문을 지우고 파일 목록은 남긴다", () => {
    const stored = buildStoredAnalysis(INPUT);
    const files = stored.candidates.includedCommits.flatMap((c) => c.files);

    expect(files).not.toHaveLength(0);
    for (const file of files) expect(file).not.toHaveProperty("patch");
    expect(files[0]).toMatchObject({ path: "src/a.ts", additions: 1, deletions: 0 });
  });

  it("근거 diff의 patch 본문은 그대로 둔다", () => {
    const stored = buildStoredAnalysis(INPUT);
    expect(stored.candidates.candidates.diffs[0].files[0].patch).toBe("@@ diff @@");
  });

  // 사용자 커밋 전량과 파일 트리는 Stage B 입력으로만 쓰이고 그 뒤로 읽히지 않습니다.
  it("전체 커밋 목록과 저장소 트리는 담지 않는다", () => {
    const stored = buildStoredAnalysis(INPUT);
    expect(stored).not.toHaveProperty("allCommits");
    expect(JSON.stringify(stored)).not.toContain("treeTruncated");
  });

  it("저장소 이름과 기여 항목을 그대로 담는다", () => {
    const stored = buildStoredAnalysis(INPUT);
    expect(stored).toMatchObject({ repoOwner: "hm1n", repoName: "SIFT", contributionItems: ["성능 개선"] });
  });

  /**
   * 제외 목록 화면이 그리는 필드만 저장합니다. 묶음이 들고 있는 커밋 상세까지 저장하면 후보 밖
   * 커밋을 전량 저장하는 것이 되어 이슈의 제약을 깹니다.
   */
  it("Stage A 제외 묶음을 화면이 쓰는 모양 그대로 싣는다", () => {
    const stored = buildStoredAnalysis(INPUT);

    expect(stored.stageASummary).toEqual({
      excludedUnits: [
        {
          unitId: "pr:42",
          kind: "pull_request",
          title: "배포 실패 대응",
          pullRequestNumber: 42,
          score: 7,
          reason: "over_input_budget",
          signals: ["many_files"],
        },
        {
          unitId: "commit:c8",
          kind: "commit",
          title: "잡무",
          pullRequestNumber: null,
          score: 1,
          reason: "over_byte_budget",
          signals: [],
        },
      ],
      selectedUnitCount: 3,
      thresholdScore: 5,
      unjudgedShas: ["c7"],
    });
    expect(JSON.stringify(stored.stageASummary)).not.toContain("c9 본문");
  });

  // jsonb 칸으로 그대로 가는 값입니다. 직렬화가 되지 않으면 저장 시점에야 드러납니다.
  it("JSON으로 직렬화된다", () => {
    expect(() => JSON.stringify(buildStoredAnalysis(INPUT))).not.toThrow();
  });
});

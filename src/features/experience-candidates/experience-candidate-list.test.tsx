// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import type { ExperienceCandidate, StageBCandidateResult } from "./types";
import {
  createExperienceCandidateListItems,
  ExperienceCandidateList,
  type StageASelectionDisplay,
} from "./experience-candidate-list";
import type { ExcludedWorkUnit } from "./work-unit-selection";
import type { WorkUnit } from "./work-unit";

const commit = (
  sha: string,
  title: string,
  pullRequests: ReadonlyCommitDetail["pullRequests"] = [],
  date = "2026-08-24T00:00:00Z"
): ReadonlyCommitDetail => ({
  sha,
  title,
  author: "octocat",
  date,
  parentCount: 1,
  message: title,
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  files: [],
  pullRequests,
});

const candidate = (sha: string, overrides: Partial<ExperienceCandidate> = {}): ExperienceCandidate => ({
  sha,
  relatedShas: [],
  evidence: `${sha}의 Repository 근거입니다.`,
  citedFilePaths: [],
  source: "automatic_recommendation",
  ...overrides,
});

function workUnit(number: number): WorkUnit<ReadonlyCommitDetail> {
  return {
    kind: "pull_request",
    unitId: `pr:${number}`,
    title: `묶음 제목 ${number}`,
    pullRequest: { number, title: `묶음 제목 ${number}`, state: "closed", baseBranch: "develop", headBranch: `f-${number}` },
    commits: [commit(`sha-unit-${number}`, `묶음 제목 ${number}`)],
  };
}

/** PR에 속하지 않은 커밋 하나짜리 단위입니다. */
function commitWorkUnit(sha: string, title: string): WorkUnit<ReadonlyCommitDetail> {
  return {
    kind: "commit",
    unitId: `commit:${sha}`,
    title,
    commits: [commit(sha, title)],
  };
}

function excludedUnit(
  number: number,
  score: number,
  reason: ExcludedWorkUnit<ReadonlyCommitDetail>["reason"],
  signals: ExcludedWorkUnit<ReadonlyCommitDetail>["signals"] = []
): ExcludedWorkUnit<ReadonlyCommitDetail> {
  return { unit: workUnit(number), score, reason, signals };
}

function renderList(candidateItems: readonly ExperienceCandidate[], commits: readonly ReadonlyCommitDetail[], reason: string | null) {
  const data: CandidateDataOutput = {
    allCommits: commits,
    includedCommits: commits,
    repository: { fileTree: [], treeTruncated: false, languages: {} },
  };
  const candidates: StageBCandidateResult = { candidates: candidateItems, insufficientCandidatesReason: reason, diffs: [] };
  render(<ExperienceCandidateList repository={{ owner: "hm1n", repo: "demian" }} data={data} candidates={candidates} onSelectRepository={vi.fn()} />);
}

afterEach(cleanup);

describe("ExperienceCandidateList", () => {
  it("화면 표시 모델의 각 후보에 Repository 출처를 담는다", () => {
    const commits = [commit("a", "상태 머신 구현")];
    const data: CandidateDataOutput = {
      allCommits: commits,
      includedCommits: commits,
      repository: { fileTree: [], treeTruncated: false, languages: {} },
    };
    const candidates: StageBCandidateResult = {
      candidates: [candidate("a")],
      insufficientCandidatesReason: "하나뿐입니다.",
      diffs: [],
    };

    // 디자인의 목록 행에는 출처 표시가 없습니다(제목·커밋 수·기간만). origin은 화면에 그리지
    // 않아도 소비자(evidence-snapshot.ts 등)가 쓰는 데이터 모양에는 여전히 실립니다.
    expect(createExperienceCandidateListItems(data, candidates)[0]).toMatchObject({ origin: "repository" });
  });

  it("목록 행은 디자인대로 제목·커밋 수·기간만 보여준다", () => {
    const commits = [
      commit("representative", "재시도 큐 도입", [], "2026-07-01T00:00:00Z"),
      commit("related", "지연 백오프 조정", [], "2026-08-01T00:00:00Z"),
    ];
    renderList(
      [candidate("representative", { relatedShas: ["related"], source: "contribution_match" })],
      commits,
      "하나뿐입니다."
    );
    const row = within(screen.getByRole("button", { name: "재시도 큐 도입" }));

    expect(row.getByText("2 commits")).toBeInTheDocument();
    expect(row.getByText("Jul 2026")).toBeInTheDocument();
    // 출처·기여 항목 일치·evidence 문장·확인 가능/불가 지표는 디자인에 없어 행에서 뺐습니다.
    // 상세 패널(항상 함께 보임)이 이 정보를 전부 보여줍니다.
    expect(row.queryByText(/출처/)).not.toBeInTheDocument();
    expect(row.queryByText(/기여 항목 일치/)).not.toBeInTheDocument();
  });

  it("후보 3개의 제목을 표시하고 부족 사유는 숨긴다", () => {
    const commits = [commit("a", "상태 머신 구현"), commit("b", "오류 계약 정의"), commit("c", "응답 검증 추가")];
    renderList(commits.map(({ sha }) => candidate(sha)), commits, null);

    expect(screen.getByText("3 experiences found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "상태 머신 구현" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "오류 계약 정의" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "응답 검증 추가" })).toBeInTheDocument();
    expect(screen.queryByText("후보를 3개 채우지 않은 이유")).not.toBeInTheDocument();
  });

  it("후보가 부족한 이유를 목록 패널에 표시한다", () => {
    const commits = [commit("representative", "후보 목록 구현")];
    renderList([candidate("representative", { source: "contribution_match" })], commits, "독립적인 근거가 하나뿐입니다.");

    expect(screen.getByRole("button", { name: "후보 목록 구현" })).toBeInTheDocument();
    expect(screen.getByText(/독립적인 근거가 하나뿐입니다/)).toBeInTheDocument();
  });

  it("관련 SHA와 인용 파일을 원본 순서대로 중복 제거하고 대표 SHA는 관련 커밋에서 제외한다", () => {
    const commits = [commit("representative", "근거 정규화")];
    const candidateItem = candidate("representative", {
      relatedShas: ["related-b", "representative", "related-a", "related-b"],
      citedFilePaths: ["src/b.ts", "src/a.ts", "src/b.ts"],
    });
    const data: CandidateDataOutput = {
      allCommits: commits,
      includedCommits: commits,
      repository: { fileTree: [], treeTruncated: false, languages: {} },
    };
    const candidates: StageBCandidateResult = {
      candidates: [candidateItem],
      insufficientCandidatesReason: "하나뿐입니다.",
      diffs: [],
    };

    expect(createExperienceCandidateListItems(data, candidates)[0]).toMatchObject({
      candidate: candidateItem,
      normalizedRelatedShas: ["related-b", "related-a"],
      normalizedCitedFilePaths: ["src/b.ts", "src/a.ts"],
    });
  });

  it("대표 SHA를 커밋 색인에서 찾지 못하면 목록과 상세에서 계약 파손을 드러낸다", () => {
    renderList([candidate("abcdef123456")], [], "하나뿐입니다.");
    const row = within(screen.getByRole("button", { name: "커밋 색인 실패 · abcdef1" }));

    expect(row.getByText("커밋 색인 실패 · abcdef1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "커밋 색인 실패 · abcdef1" }));
    expect(screen.getByRole("heading", { name: "커밋 색인 실패 · abcdef1" })).toBeInTheDocument();
    expect(screen.getByText("Representative commit not found in the commit index.")).toBeInTheDocument();
  });

  it("행의 접근성 이름은 보이는 제목과 같다", () => {
    renderList([candidate("a")], [commit("a", "접근성 이름 검증")], "하나뿐입니다.");

    expect(screen.getByRole("button", { name: "접근성 이름 검증" })).toBeInTheDocument();
  });

  it("선택한 행에 aria-current를 표시하고 다른 후보를 고르면 옮겨간다", () => {
    renderList(
      [candidate("a"), candidate("b")],
      [commit("a", "선택 표시 A"), commit("b", "선택 표시 B")],
      "두 개뿐입니다."
    );

    expect(screen.getByRole("button", { name: "선택 표시 A" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "선택 표시 B" })).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "선택 표시 B" }));
    expect(screen.getByRole("button", { name: "선택 표시 B" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "선택 표시 A" })).not.toHaveAttribute("aria-current");
  });

  it("목록에서 다른 후보를 선택하면 상세가 함께 바뀐다", () => {
    renderList(
      [candidate("a"), candidate("b")],
      [commit("a", "상세 전환 A"), commit("b", "상세 전환 B")],
      "두 개뿐입니다."
    );

    expect(screen.getByRole("heading", { name: "상세 전환 A" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /상세 전환 B/ }));
    expect(screen.getByRole("heading", { name: "상세 전환 B" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "상세 전환 A" })).not.toBeInTheDocument();
  });
});

const EMPTY_SELECTION: StageASelectionDisplay = {
  excludedUnits: [],
  thresholdScore: 0,
  selectedUnitCount: 0,
  unjudgedShas: [],
};

function renderListWithSelection(stageASelection: StageASelectionDisplay) {
  const commits = [commit("a", "선별 화면 검증")];
  const data: CandidateDataOutput = {
    allCommits: commits,
    includedCommits: commits,
    repository: { fileTree: [], treeTruncated: false, languages: {} },
  };
  const candidates: StageBCandidateResult = {
    candidates: [candidate("a")],
    insufficientCandidatesReason: "하나뿐입니다.",
    diffs: [],
  };
  render(
    <ExperienceCandidateList
      repository={{ owner: "hm1n", repo: "demian" }}
      data={data}
      candidates={candidates}
      stageASelection={stageASelection}
      onSelectRepository={vi.fn()}
    />
  );
}

describe("ExperienceCandidateList의 Stage A 제외 표시(이슈 #58 Task 8·9)", () => {
  it("제외된 값이 전부 비어 있으면 제외 구획을 렌더하지 않는다", () => {
    renderListWithSelection(EMPTY_SELECTION);

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외된 항목" })).not.toBeInTheDocument();
  });

  it("stageASelection을 넘기지 않아도 목록이 정상 렌더된다", () => {
    renderList([candidate("a")], [commit("a", "선택 없이 렌더")], "하나뿐입니다.");

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외된 항목" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "선택 없이 렌더" })).toBeInTheDocument();
  });

  it("단일 커밋 단위는 PR 번호 대신 SHA 7자리로 라벨을 표시한다", () => {
    const sha = "abcdef1234567890abcdef1234567890abcdef12";
    renderListWithSelection({
      ...EMPTY_SELECTION,
      thresholdScore: 1,
      selectedUnitCount: 0,
      excludedUnits: [{
        unit: commitWorkUnit(sha, "직접 푸시한 변경"),
        score: 1,
        reason: "over_input_budget",
        signals: [],
      }],
    });

    expect(screen.getByText("커밋 abcdef1")).toBeInTheDocument();
    expect(screen.getByText("직접 푸시한 변경")).toBeInTheDocument();
    expect(screen.queryByText(/PR #/)).not.toBeInTheDocument();
  });

  it("점수 컷에서 밀린 묶음을 점수 내림차순으로 보여주고 PR·제목·점수·신호를 표시한다", () => {
    renderListWithSelection({
      ...EMPTY_SELECTION,
      thresholdScore: 3,
      selectedUnitCount: 10,
      excludedUnits: [
        excludedUnit(1, 1, "over_input_budget", ["many_commits"]),
        excludedUnit(2, 2, "over_input_budget", ["many_files", "long_span"]),
      ],
    });

    // 점수에 합격선이 있다는 뜻으로 읽히던 문구를 고쳤습니다. 실제 방아쇠는 입력 상한이므로
    // 전체 대비 몇 묶음을 판단했는지만 말하고, 선별 방식은 별도 문장으로 설명합니다. 선택이
    // 개별 항목 단위 예산 검사로 바뀌면서(2026-09-11) 단일 점수 경계로는 더 이상 설명하지
    // 않습니다.
    expect(
      screen.getByText("저장소가 커서 전체 12묶음 중 10묶음만 판단했습니다")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/분석 가능한 분량 안에서 점수순으로 선택했고, 같은 점수에서는 최신 커밋을 우선했습니다\./)
    ).toBeInTheDocument();
    expect(screen.getByText("PR #2")).toBeInTheDocument();
    expect(screen.getByText("PR #1")).toBeInTheDocument();
    expect(screen.getByText("2점 · 휴리스틱")).toBeInTheDocument();
    expect(screen.getByText("고친 파일이 많습니다")).toBeInTheDocument();
    expect(screen.getByText("여러 날에 걸쳐 작업했습니다")).toBeInTheDocument();

    // 컷 바로 아래(점수가 더 높은) 묶음이 먼저 나옵니다.
    const items = screen.getAllByText(/^PR #\d+$/);
    expect(items.map((el) => el.textContent)).toEqual(["PR #2", "PR #1"]);
  });

  it("분량 상한 제외와 점수 컷 제외를 서로 다른 구획으로 나눠 보여준다", () => {
    renderListWithSelection({
      ...EMPTY_SELECTION,
      thresholdScore: 2,
      selectedUnitCount: 10,
      excludedUnits: [
        excludedUnit(1, 2, "over_input_budget"),
        excludedUnit(2, 5, "over_byte_budget"),
      ],
    });

    expect(
      screen.getByText("저장소가 커서 전체 12묶음 중 10묶음만 판단했습니다")
    ).toBeInTheDocument();
    expect(screen.getByText("한 번에 보낼 수 있는 분량을 넘어 1묶음을 제외했습니다")).toBeInTheDocument();
  });

  it("모델이 판단하지 못한 묶음 건수를 표시한다", () => {
    renderListWithSelection({ ...EMPTY_SELECTION, unjudgedShas: ["deadbeef00112233"] });

    expect(screen.getByText("모델이 판단하지 못한 묶음 1건")).toBeInTheDocument();
    expect(screen.getByText(/제외한 것이 아니라 판단이 없는 상태입니다/)).toBeInTheDocument();
    expect(screen.getByText("deadbee")).toBeInTheDocument();
  });

  it("점수는 확인 가능 태그를 쓰지 않고 PR 정보는 확인 가능 태그로 표시한다", () => {
    renderListWithSelection({
      ...EMPTY_SELECTION,
      thresholdScore: 1,
      selectedUnitCount: 0,
      excludedUnits: [excludedUnit(1, 1, "over_input_budget")],
    });

    const scoreEl = screen.getByText("1점 · 휴리스틱");
    expect(scoreEl).not.toHaveTextContent("Verified");
    const prEl = screen.getByText("PR #1");
    expect(prEl.previousElementSibling).toHaveTextContent("Verified");
  });

  it("제외 구획은 키보드로 펼치고 접을 수 있고 펼침 상태가 details의 open 속성으로 드러난다", () => {
    renderListWithSelection({
      ...EMPTY_SELECTION,
      unjudgedShas: ["deadbeef00112233"],
    });

    const details = screen.getByText("모델이 판단하지 못한 묶음 1건").closest("details");
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("모델이 판단하지 못한 묶음 1건"));
    expect(details).toHaveAttribute("open");

    fireEvent.click(screen.getByText("모델이 판단하지 못한 묶음 1건"));
    expect(details).not.toHaveAttribute("open");
  });

  it("andbread처럼 제외 묶음이 많아도 목록이 스크롤 영역에 담겨 후보 목록을 밀어내지 않는다", () => {
    const many = Array.from({ length: 56 }, (_, index) => excludedUnit(index + 1, 1, "over_input_budget"));
    renderListWithSelection({
      ...EMPTY_SELECTION,
      thresholdScore: 2,
      selectedUnitCount: 10,
      excludedUnits: many,
    });

    const summaryText = "저장소가 커서 전체 66묶음 중 10묶음만 판단했습니다";
    expect(screen.getByText(summaryText)).toBeInTheDocument();
    const details = screen.getByText(summaryText).closest("details");
    const list = details?.querySelector("ul");
    expect(list?.className).toMatch(/scrollableList/);
  });
});

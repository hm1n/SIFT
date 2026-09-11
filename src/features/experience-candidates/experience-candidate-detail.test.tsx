// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import type { ExperienceCandidate } from "./types";
import { ExperienceCandidateDetail } from "./experience-candidate-detail";

const commit = (
  sha: string,
  title: string,
  date: string,
  pullRequests: ReadonlyCommitDetail["pullRequests"] = []
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
  files: [{ path: "src/detail.tsx", status: "modified", additions: 10, deletions: 2, changes: 12 }],
  pullRequests,
});

const representative = commit("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "후보 상세 구현", "2026-08-01T00:00:00Z", [
  { number: 46, title: "후보 상세", state: "open", url: "https://example.com/pr/46", baseBranch: "develop", headBranch: "feature" },
]);

const related = commit("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "관련 근거 추가", "2026-09-01T00:00:00Z");

const candidate: ExperienceCandidate = {
  sha: representative.sha,
  relatedShas: [related.sha],
  evidence: "상세 근거를 표시합니다.",
  citedFilePaths: ["src/detail.tsx"],
  source: "automatic_recommendation",
};

const data: CandidateDataOutput = {
  allCommits: [representative, related],
  includedCommits: [representative, related],
  repository: { fileTree: [], treeTruncated: false, languages: {} },
};

function renderDetail(
  candidateOverride: ExperienceCandidate = candidate,
  commitOverride: ReadonlyCommitDetail | null = representative,
  dataOverride: CandidateDataOutput = data,
  selectionError?: Parameters<typeof ExperienceCandidateDetail>[0]["selectionError"]
) {
  render(
    <ExperienceCandidateDetail
      repository={{ owner: "hm1n", repo: "demian" }}
      data={dataOverride}
      item={{
        candidate: candidateOverride,
        commit: commitOverride,
        origin: "repository",
        normalizedRelatedShas: [...new Set(candidateOverride.relatedShas.filter((sha) => sha !== candidateOverride.sha))],
        normalizedCitedFilePaths: [...new Set(candidateOverride.citedFilePaths)],
      }}
      onBack={vi.fn()}
      onConfirm={vi.fn()}
      onSelectRepository={vi.fn()}
      selectionError={selectionError}
    />
  );
}

afterEach(cleanup);

describe("ExperienceCandidateDetail", () => {
  it("제목과 유도한 커밋 수·기간을 메타데이터로 표시한다", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: "후보 상세 구현" })).toBeInTheDocument();
    expect(screen.getAllByText("2 commits").length).toBeGreaterThan(0);
    expect(screen.getByText("Aug 2026 – Sep 2026")).toBeInTheDocument();
  });

  it("관련 커밋이 없으면 기간을 대표 커밋 한 달로 표시한다", () => {
    renderDetail({ ...candidate, relatedShas: [] });

    expect(screen.getAllByText("1 commits").length).toBeGreaterThan(0);
    expect(screen.getByText("Aug 2026")).toBeInTheDocument();
  });

  it("Why worth discussing에 evidence 문장과 확인 불가 안내, 스키마 공백 안내를 함께 둔다", () => {
    renderDetail();

    expect(screen.getByText("Why worth discussing")).toBeInTheDocument();
    expect(screen.getByText("상세 근거를 표시합니다.")).toBeInTheDocument();
    expect(screen.getByText("Unverifiable · AI-written interpretation")).toBeInTheDocument();
    expect(screen.getAllByText("No corresponding data in the Repository schema to display this.").length).toBeGreaterThan(0);
  });

  it("Technical topics는 스키마에 대응 값이 없어 스키마 공백 안내만 표시한다", () => {
    renderDetail();

    expect(screen.getByText("Technical topics")).toBeInTheDocument();
  });

  it("Repository evidence 목록에 대표 커밋은 Verified로, 관련 커밋은 AI-selected로 표시한다", () => {
    renderDetail();

    expect(screen.getByText("Repository evidence")).toBeInTheDocument();
    expect(screen.getByText("VERIFIED FROM REPOSITORY")).toBeInTheDocument();

    const representativeRow = screen.getByRole("link", { name: "후보 상세 구현" }).closest("li");
    expect(representativeRow).toHaveTextContent("Verified");
    expect(representativeRow).toHaveTextContent("PR #46");

    const relatedRow = screen.getByRole("link", { name: "관련 근거 추가" }).closest("li");
    expect(relatedRow).toHaveTextContent("AI-selected");
  });

  it("관련 커밋이 있으면 AI 선택 안내를 표시하고 없으면 표시하지 않는다", () => {
    renderDetail();
    expect(
      screen.getByText(/Confirmed only as belonging to the same PR as the representative commit/)
    ).toBeInTheDocument();

    cleanup();
    renderDetail({ ...candidate, relatedShas: [] });
    expect(
      screen.queryByText(/Confirmed only as belonging to the same PR as the representative commit/)
    ).not.toBeInTheDocument();
  });

  it("근거 항목이 3개를 넘으면 접어 두고 View all로 펼친다", () => {
    const relatedShas = ["1", "2", "3"].map((suffix) => suffix.padStart(40, "c"));
    const manyData: CandidateDataOutput = {
      allCommits: [representative, related, ...relatedShas.map((sha, index) => commit(sha, `관련 커밋 ${index}`, "2026-08-05T00:00:00Z"))],
      includedCommits: [representative, related, ...relatedShas.map((sha, index) => commit(sha, `관련 커밋 ${index}`, "2026-08-05T00:00:00Z"))],
      repository: { fileTree: [], treeTruncated: false, languages: {} },
    };
    renderDetail({ ...candidate, relatedShas: [related.sha, ...relatedShas] }, representative, manyData);

    expect(screen.queryByText("관련 커밋 2")).not.toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: /View all 5 commits/ });
    fireEvent.click(toggle);
    expect(screen.getByText("관련 커밋 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });

  it("footer 왼쪽에 다른 Repository 선택 버튼을 표시하고 클릭하면 onSelectRepository를 부른다", () => {
    const onSelectRepository = vi.fn();
    render(
      <ExperienceCandidateDetail
        repository={{ owner: "hm1n", repo: "demian" }}
        data={data}
        item={{
          candidate,
          commit: representative,
          origin: "repository",
          normalizedRelatedShas: [related.sha],
          normalizedCitedFilePaths: candidate.citedFilePaths,
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onSelectRepository={onSelectRepository}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Choose a different repository" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });

  it("대표 커밋을 커밋 색인에서 찾지 못하면 계약 파손을 드러내고 커밋 수만 유도한다", () => {
    renderDetail(candidate, null);

    expect(screen.getByRole("heading", { name: `커밋 색인 실패 · ${candidate.sha.slice(0, 7)}` })).toBeInTheDocument();
    expect(screen.getByText("Representative commit not found in the commit index.")).toBeInTheDocument();
    expect(screen.getAllByText("2 commits").length).toBeGreaterThan(0);
  });

  it("확정 실패 안내가 있으면 인터뷰 시작 대신 실패 이유를 보여주고 뒤로가기로 onBack을 부른다", () => {
    const onBack = vi.fn();
    render(
      <ExperienceCandidateDetail
        repository={{ owner: "hm1n", repo: "demian" }}
        data={data}
        item={{
          candidate,
          commit: representative,
          origin: "repository",
          normalizedRelatedShas: [related.sha],
          normalizedCitedFilePaths: candidate.citedFilePaths,
        }}
        onBack={onBack}
        onConfirm={vi.fn()}
        onSelectRepository={vi.fn()}
        selectionError="no_repository_evidence"
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-selection-error", "no_repository_evidence");
    expect(screen.getByRole("button", { name: /Start interview/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Back to candidates" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

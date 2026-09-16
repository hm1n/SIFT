// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import type { ExperienceCandidate } from "./types";
import { RETENTION_DAYS } from "@/features/saved-interviews/retention";
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
  summary: "후보 상세 화면 구현",
  evidence: "상세 근거를 표시합니다.",
  technicalTopics: ["React", "CSS Modules"],
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
      commitsBySha={new Map(dataOverride.includedCommits.map((entry) => [entry.sha, entry]))}
      item={{
        candidate: candidateOverride,
        commit: commitOverride,
        origin: "repository",
        normalizedRelatedShas: [...new Set(candidateOverride.relatedShas.filter((sha) => sha !== candidateOverride.sha))],
        normalizedCitedFilePaths: [...new Set(candidateOverride.citedFilePaths)],
        normalizedTechnicalTopics: [...new Set(candidateOverride.technicalTopics)],
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
  // 제목은 대표 커밋 제목이 아니라 `summary`입니다(이슈 #110). 대표 커밋 제목("후보 상세 구현")은
  // 아래 Repository evidence 목록의 커밋 한 줄에만 남습니다.
  it("제목과 유도한 커밋 수·기간을 메타데이터로 표시한다", () => {
    renderDetail();

    expect(screen.getByRole("heading", { name: candidate.summary })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "후보 상세 구현" })).not.toBeInTheDocument();
    expect(screen.getAllByText("2 commits").length).toBeGreaterThan(0);
    expect(screen.getByText("2026년 8월 – 2026년 9월")).toBeInTheDocument();
  });

  it("관련 커밋이 없으면 기간을 대표 커밋 한 달로 표시한다", () => {
    renderDetail({ ...candidate, relatedShas: [] });

    expect(screen.getAllByText("1 commit").length).toBeGreaterThan(0);
    expect(screen.getByText("2026년 8월")).toBeInTheDocument();
  });

  it("Why worth discussing에 evidence 문장과 확인 불가 안내를 함께 둔다", () => {
    renderDetail();

    expect(screen.getByText("Why worth discussing")).toBeInTheDocument();
    expect(screen.getByText("상세 근거를 표시합니다.")).toBeInTheDocument();
    expect(screen.getAllByText("Unverifiable · AI가 해석한 내용입니다").length).toBeGreaterThan(0);
  });

  /**
   * 이슈 #110 회귀입니다. #97은 이 자리에 스키마 공백 안내
   * ("No corresponding data in the Repository schema to display this.")를 뒀습니다. 필드가
   * 생겼으므로 그 문구가 남아 있으면 안 됩니다.
   */
  it("Technical topics를 칩으로 표시하고 확인 불가 안내를 함께 둔다", () => {
    renderDetail();

    expect(screen.getByText("Technical topics")).toBeInTheDocument();
    expect(screen.getByText("React")).toBeInTheDocument();
    expect(screen.getByText("CSS Modules")).toBeInTheDocument();
    expect(screen.queryByText(/No corresponding data in the Repository schema/)).not.toBeInTheDocument();
    // 토픽은 LLM 해석이므로 Why worth discussing과 같은 안내가 하나 더 붙습니다.
    expect(screen.getAllByText("Unverifiable · AI가 해석한 내용입니다")).toHaveLength(2);
  });

  /** 토픽이 빈 배열로 와도 화면이 정상 동작하고, 없다는 사실을 문장으로 알립니다. */
  it("토픽이 없으면 칩 대신 Empty 문구를 표시한다", () => {
    renderDetail({ ...candidate, technicalTopics: [] });

    expect(screen.getByText("Technical topics")).toBeInTheDocument();
    expect(
      screen.getByText(
        "이 후보의 diff와 커밋 메시지에서는 기술 토픽을 찾지 못했습니다."
      )
    ).toBeInTheDocument();
  });

  /**
   * 이슈 #110 폴백 회귀입니다. 스키마가 빈 `summary`를 허용하므로(후보를 버리지 않으려고)
   * 비었을 때 제목이 사라지지 않고 대표 커밋 제목으로 떨어져야 합니다.
   */
  it("summary가 비어 있으면 제목을 대표 커밋 제목으로 대신한다", () => {
    renderDetail({ ...candidate, summary: "" });

    expect(screen.getByRole("heading", { name: "후보 상세 구현" })).toBeInTheDocument();
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
      screen.getByText(/실제로 이 경험과 관련 있는지는 AI가 판단했습니다/)
    ).toBeInTheDocument();

    cleanup();
    renderDetail({ ...candidate, relatedShas: [] });
    expect(
      screen.queryByText(/실제로 이 경험과 관련 있는지는 AI가 판단했습니다/)
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
    const toggle = screen.getByRole("button", { name: /전체 5 commits 보기/ });
    fireEvent.click(toggle);
    expect(screen.getByText("관련 커밋 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "간단히 보기" })).toBeInTheDocument();
  });

  it("footer 왼쪽에 다른 Repository 선택 버튼을 표시하고 클릭하면 onSelectRepository를 부른다", () => {
    const onSelectRepository = vi.fn();
    render(
      <ExperienceCandidateDetail
        repository={{ owner: "hm1n", repo: "demian" }}
        commitsBySha={new Map(data.includedCommits.map((entry) => [entry.sha, entry]))}
        item={{
          candidate,
          commit: representative,
          origin: "repository",
          normalizedRelatedShas: [related.sha],
          normalizedCitedFilePaths: candidate.citedFilePaths,
          normalizedTechnicalTopics: candidate.technicalTopics,
        }}
        onBack={vi.fn()}
        onConfirm={vi.fn()}
        onSelectRepository={onSelectRepository}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "다른 Repository 선택" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });

  it("대표 커밋을 커밋 색인에서 찾지 못하면 계약 파손을 드러내고 커밋 수만 유도한다", () => {
    renderDetail(candidate, null);

    expect(screen.getByRole("heading", { name: candidate.summary })).toBeInTheDocument();
    expect(screen.getByText("대표 커밋을 불러온 커밋 목록에서 찾지 못했습니다.")).toBeInTheDocument();
    expect(screen.getAllByText("2 commits").length).toBeGreaterThan(0);

    const failedRow = screen.getByRole("link", { name: `목록에 없는 커밋 · ${candidate.sha.slice(0, 7)}` }).closest("li");
    expect(failedRow).not.toHaveTextContent("Verified");
  });

  it("확정 실패 안내가 있으면 인터뷰 시작 대신 실패 이유를 보여주고 뒤로가기로 onBack을 부른다", () => {
    const onBack = vi.fn();
    render(
      <ExperienceCandidateDetail
        repository={{ owner: "hm1n", repo: "demian" }}
        commitsBySha={new Map(data.includedCommits.map((entry) => [entry.sha, entry]))}
        item={{
          candidate,
          commit: representative,
          origin: "repository",
          normalizedRelatedShas: [related.sha],
          normalizedCitedFilePaths: candidate.citedFilePaths,
          normalizedTechnicalTopics: candidate.technicalTopics,
        }}
        onBack={onBack}
        onConfirm={vi.fn()}
        onSelectRepository={vi.fn()}
        selectionError="no_repository_evidence"
      />
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-selection-error", "no_repository_evidence");
    expect(screen.getByRole("button", { name: /인터뷰 시작/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← 후보 목록으로" }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  /**
   * 근거 스냅샷에는 비공개 저장소의 커밋 메시지와 파일 경로와 코드 변경이 들어갑니다. 저장되는 시점에
   * 그 사실을 알리지 않으면 사용자는 코드가 서버에 남는다는 것을 모른 채 인터뷰를 시작합니다.
   */
  it("인터뷰를 시작하면 코드가 서버에 저장된다는 것과 보관 기간을 함께 알린다", () => {
    renderDetail();

    const notice = screen.getByText(/이 근거를 서버에 저장합니다/);
    expect(notice).toHaveTextContent("비공개 Repository의 코드도 포함됩니다");
    expect(notice).toHaveTextContent(`${RETENTION_DAYS}일`);
    expect(screen.getByRole("button", { name: /인터뷰 시작/ })).toHaveAccessibleDescription(
      /비공개 Repository/
    );
  });
});

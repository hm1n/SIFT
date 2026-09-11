// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRepository } from "@/features/repository-analysis/repository-analysis";
import { RepositoryFlow } from "./repository-flow";

vi.mock("@/features/repository-analysis/repository-analysis", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/repository-analysis/repository-analysis")>();
  return { ...original, analyzeRepository: vi.fn(), generateCandidates: vi.fn() };
});

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const analyzeMock = vi.mocked(analyzeRepository);

const LIST = {
  repositories: [
    { id: 1, owner: "octocat", name: "hello-world", visibility: "public", language: "TypeScript", pushedAt: "2026-09-10T00:00:00Z" },
  ],
};

beforeEach(() => {
  analyzeMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(Response.json(LIST))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RepositoryFlow", () => {
  it("선택 화면에서 Analyze를 누르면 그 Repository와 기여 항목으로 분석 화면을 시작한다", async () => {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your Contribution" }), { target: { value: "푸시 알림 구현" } });
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    await waitFor(() => expect(analyzeMock).toHaveBeenCalledWith({ owner: "octocat", repo: "hello-world" }, ["푸시 알림 구현"], expect.any(Function)));
    expect(screen.queryByRole("heading", { name: "Choose a repository to analyze." })).not.toBeInTheDocument();
    expect(screen.getByText("No commits found to analyze.")).toBeInTheDocument();
  });

  it("다른 Repository 선택은 목록을 다시 조회해 선택 화면으로 돌아간다", async () => {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose a different repository" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
  });
});

// PR #105 Codex 리뷰 P1: AppShell 사이드바의 Change repository는 RepositoryAnalysisView 밖에 있어
// InterviewScreen의 이탈 확인을 그대로 건너뛰고 대화를 잃었습니다. 사이드바도 같은 확인을 거쳐야 합니다.
describe("RepositoryFlow 인터뷰 중 이탈 확인", () => {
  const COMMIT = {
    sha: "aaa",
    title: "재시도 큐 도입",
    author: "octocat",
    date: "2026-08-24T00:00:00Z",
    parentCount: 1,
    message: "재시도 큐 도입",
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    files: [{ path: "src/aaa.ts", status: "modified", additions: 10, deletions: 2, changes: 12 }],
    pullRequests: [],
  } as const;
  const CANDIDATE = {
    sha: "aaa",
    relatedShas: [],
    evidence: "aaa의 Repository 근거입니다.",
    citedFilePaths: [],
    source: "automatic_recommendation",
  } as const;

  /** 목록 선택부터 인터뷰 확정까지 실제 UI로 진행합니다. 인터뷰 스트림 fetch는 응답하지 않습니다. */
  async function renderWithConfirmedInterview() {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => {
      onStateChange({
        status: "success",
        data: { allCommits: [COMMIT], includedCommits: [COMMIT], repository: { fileTree: [], treeTruncated: false, languages: {} } },
        candidates: { candidates: [CANDIDATE], insufficientCandidatesReason: null, diffs: [] },
        stageASelection: { excludedCommits: [], excludedUnits: [], thresholdScore: 0, selectedUnitCount: 1, unjudgedShas: [] },
      });
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/api/interview/stream")) return new Promise<Response>(() => {});
        return Promise.resolve(Response.json(LIST));
      })
    );

    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    fireEvent.click(await screen.findByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: "이 경험으로 인터뷰 시작" }));
    await screen.findByText("AI 인터뷰");
  }

  it("사이드바 Change repository는 바로 나가지 않고 확인을 먼저 받는다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("AI 인터뷰")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 계속하기" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText("AI 인터뷰")).toBeInTheDocument();
  });

  it("확인 뒤 Repository 바꾸기를 누르면 선택 화면으로 돌아간다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Repository 바꾸기" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(screen.queryByText("AI 인터뷰")).not.toBeInTheDocument();
  });
});

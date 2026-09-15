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

const trackEvent = vi.fn();
const startAnalysisFlow = vi.fn();
const clearAnalysisFlow = vi.fn();
vi.mock("@/features/analytics/events", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/analytics/events")>();
  return {
    ...original,
    trackEvent: (...args: unknown[]) => trackEvent(...args),
    startAnalysisFlow: (...args: unknown[]) => startAnalysisFlow(...args),
    clearAnalysisFlow: (...args: unknown[]) => clearAnalysisFlow(...args),
  };
});

/** 상태 전이 판정입니다. 기본값은 아무 이벤트도 만들지 않는 것이고, 예외 격리 테스트만 던지게 바꿉니다. */
const advanceAnalysisTracker = vi.fn((tracker: unknown) => ({ tracker, events: [] }));
vi.mock("@/features/analytics/analysis-events", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/analytics/analysis-events")>();
  return { ...original, advanceAnalysisTracker: (tracker: unknown) => advanceAnalysisTracker(tracker) };
});

const analyzeMock = vi.mocked(analyzeRepository);

const LIST = {
  repositories: [
    { id: 1, owner: "octocat", name: "hello-world", visibility: "public", language: "TypeScript", pushedAt: "2026-09-10T00:00:00Z" },
  ],
};

beforeEach(() => {
  analyzeMock.mockReset();
  trackEvent.mockReset();
  startAnalysisFlow.mockReset();
  clearAnalysisFlow.mockReset();
  advanceAnalysisTracker.mockReset();
  advanceAnalysisTracker.mockImplementation((tracker: unknown) => ({ tracker, events: [] }));
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

  /**
   * `flow_id`를 분석 시작 시점에 발급합니다. 저장소를 고른 순간이 아니라 분석을 시작하는 순간이고,
   * 저장소 이름은 어떤 파라미터로도 나가지 않습니다(이슈 #125).
   */
  it("분석을 시작하면 flow_id와 저장소 맥락을 세우고 analysis_requested를 남긴다", async () => {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your Contribution" }), { target: { value: "푸시 알림 구현\n스크롤 복원" } });
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    await waitFor(() => expect(startAnalysisFlow).toHaveBeenCalledTimes(1));
    expect(startAnalysisFlow).toHaveBeenCalledWith({ repoVisibility: "public", repoLanguage: "TypeScript" });
    expect(trackEvent).toHaveBeenCalledWith({ name: "analysis_requested", contribution_item_count: 2 });
    expect(JSON.stringify(trackEvent.mock.calls)).not.toContain("hello-world");
  });

  /**
   * `flow_id`를 만드는 `crypto.randomUUID`는 보안 컨텍스트에만 있어서, LAN 주소로 띄운 개발
   * 서버에서는 없습니다. 이 화면이 그 값을 직접 만들면 예외가 계측 밖으로 나와 `setSelection`에
   * 닿지 못하고 Analyze 버튼이 죽습니다. 값을 만드는 일은 계측 쪽에 있어야 합니다.
   */
  it("flow_id를 만들 수 없어도 분석을 시작한다", async () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    expect(await screen.findByText("No commits found to analyze.")).toBeInTheDocument();
    randomUUID.mockRestore();
  });

  /**
   * 계측 실패가 서비스 오류로 보이면 안 됩니다(이슈 #125 제약). 분석 상태를 화면에 반영하기 직전에
   * 계측이 실행되므로, 여기서 던지면 화면이 로딩에 멈춥니다.
   */
  it("계측이 예외를 던져도 분석 결과를 그대로 그린다", async () => {
    advanceAnalysisTracker.mockImplementation(() => {
      throw new Error("analytics is broken");
    });
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    expect(await screen.findByText("No commits found to analyze.")).toBeInTheDocument();
  });

  /** 비우지 않으면 다음 분석 전에 일어나는 목록 조회가 지난 분석의 `flow_id`를 달고 나갑니다. */
  it("저장소를 바꾸면 분석 묶음을 비운다", async () => {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose a different repository" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(clearAnalysisFlow).toHaveBeenCalledTimes(1);
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
    summary: "재시도 큐 도입",
    evidence: "aaa의 Repository 근거입니다.",
    technicalTopics: [],
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
        stageASelection: { excludedUnits: [], thresholdScore: 0, selectedUnitCount: 1, unjudgedShas: [] },
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
    fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));
    // 인터뷰 화면이 떴는지는 3열 워크스페이스의 코드 패널로 봅니다.
    await screen.findByRole("region", { name: "Code / Evidence" });
  }

  it("사이드바 Change repository는 바로 나가지 않고 확인을 먼저 받는다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue the interview" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
  });

  it("확인 뒤 Repository 바꾸기를 누르면 선택 화면으로 돌아간다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Change repository" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRepository } from "@/features/repository-analysis/repository-analysis";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { encodeSseEvent } from "@/features/interview/sse";
import { RepositoryFlow } from "./repository-flow";

/**
 * 기다리는 시간을 늘립니다. 이 파일은 화면과 라우트와 저장 계층을 한 번에 지나고, 이슈 #116부터
 * 분석 화면이 저장된 분석을 먼저 찾는 단계가 하나 더 붙었습니다. 기본값 1초로는 전체 스위트를 함께
 * 돌릴 때 간헐적으로 넘습니다(2026-09-15에 서로 다른 테스트가 두 번 흔들렸습니다).
 */
configure({ asyncUtilTimeout: 5_000 });

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

/** 요청을 URL로 갈라 응답합니다. 사이드바 목록 조회가 마운트마다 함께 나갑니다(이슈 #115). */
function stubFetch(handlers: Record<string, () => Promise<Response> | Response> = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (url.includes(prefix)) return Promise.resolve(handler());
    }
    // 저장된 분석이 없는 것이 기본입니다(이슈 #116). 분석 화면은 저장된 것을 먼저 찾아보고 없을
    // 때만 분석합니다.
    if (url.includes("/api/analyses")) {
      return Promise.resolve(
        Response.json({ error: { kind: "not_found", message: "저장된 분석이 없습니다." } }, { status: 404 })
      );
    }
    if (url.includes("/api/interviews")) return Promise.resolve(Response.json({ interviews: [] }));
    return Promise.resolve(Response.json(LIST));
  });
  vi.stubGlobal("fetch", fetchImpl);
  return { calls, fetchImpl };
}

function repositoryListCalls(calls: readonly string[]): number {
  return calls.filter((url) => url.includes("/api/github/repositories")).length;
}

beforeEach(() => {
  analyzeMock.mockReset();
  trackEvent.mockReset();
  startAnalysisFlow.mockReset();
  clearAnalysisFlow.mockReset();
  advanceAnalysisTracker.mockReset();
  advanceAnalysisTracker.mockImplementation((tracker: unknown) => ({ tracker, events: [] }));
  stubFetch();
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
    const { calls } = stubFetch();
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Choose a different repository" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(repositoryListCalls(calls)).toBe(2);
    // 고른 Repository가 없어도 사이드바는 그대로 있습니다(이슈 #115).
    expect(within(screen.getByRole("region", { name: "Repository" })).getByText("No repository selected")).toBeInTheDocument();
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

/**
 * 이슈 #115로 계약이 바뀌었습니다. 저장이 붙기 전에는 인터뷰 화면을 떠나는 것이 곧 대화를 잃는
 * 것이라 언제나 확인했지만, 이제 저장된 대화는 사이드바에서 다시 이어갈 수 있습니다. 그래서 잃을
 * 것이 있을 때, 즉 저장되지 않은 턴이 남아 있을 때만 확인합니다.
 *
 * 확인을 거는 자리는 그대로 흐름 컴포넌트입니다. 사이드바의 Change repository와 새 경험 찾기는
 * 인터뷰 화면 밖에 있어서, 화면이 스스로 확인을 걸면 그 두 경로가 빠져나갑니다(PR #105 Codex 리뷰 P1).
 */
describe("RepositoryFlow 인터뷰 중 이탈", () => {
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

  /** 질문 하나를 끝까지 보내는 스트림 응답입니다. */
  function questionResponse(text: string): Response {
    return new Response(
      encodeSseEvent({ type: "chunk", seq: 1, text }) + encodeSseEvent({ type: "done", seq: 1 }),
      { status: 200 }
    );
  }

  /** 목록 선택부터 인터뷰 확정까지 실제 UI로 진행합니다. */
  async function renderWithConfirmedInterview(handlers: Record<string, () => Promise<Response> | Response> = {}) {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => {
      onStateChange({
        status: "success",
        data: { includedCommits: [COMMIT] },
        candidates: { candidates: [CANDIDATE], insufficientCandidatesReason: null, diffs: [] },
        stageASelection: { excludedUnits: [], thresholdScore: 0, selectedUnitCount: 1, unjudgedShas: [] },
      });
    });
    stubFetch({
      "/api/interview/stream": () => questionResponse("문제 상황을 알려주세요"),
      ...handlers,
    });

    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));
    fireEvent.click(await screen.findByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));
    // 인터뷰 화면이 떴는지는 3열 워크스페이스의 코드 패널로 봅니다.
    await screen.findByRole("region", { name: "Code / Evidence" });
  }

  // 저장된 대화는 다시 이어갈 수 있으므로 잃을 것이 없습니다. 묻지 않고 나갑니다.
  it("저장되지 않은 답변이 없으면 확인 없이 나간다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  /**
   * 블록 갱신이 실패하면 그 턴은 반영도 저장도 되지 않은 채 화면에만 남습니다. 그대로 나가면 그
   * 답변을 잃습니다.
   */
  it("저장되지 않은 답변이 있으면 확인을 먼저 받는다", async () => {
    await renderWithConfirmedInterview({
      "/api/interview/experience-block": () =>
        Response.json({ error: { kind: "storage_failed", message: "끊김" } }, { status: 503 }),
    });
    const answer = await screen.findByRole("textbox", { name: /Answer/ });
    fireEvent.change(answer, { target: { value: "화면이 비어 있었습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Your last answer wasn't saved.");

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Continue the interview" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
  });

  it("확인 뒤 나가기를 누르면 선택 화면으로 돌아간다", async () => {
    await renderWithConfirmedInterview({
      "/api/interview/experience-block": () =>
        Response.json({ error: { kind: "storage_failed", message: "끊김" } }, { status: 503 }),
    });
    const answer = await screen.findByRole("textbox", { name: /Answer/ });
    fireEvent.change(answer, { target: { value: "화면이 비어 있었습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Your last answer wasn't saved.");

    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave" }));

    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
  });
});

/**
 * 사이드바에서 저장된 인터뷰를 골라 이어가는 경로입니다(이슈 #115). 분석을 다시 돌리지 않고 곧바로
 * 그 인터뷰로 들어갑니다.
 */
describe("RepositoryFlow 이어가기", () => {
  const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";
  const LIST_ITEM = {
    id: INTERVIEW_ID,
    repoOwner: "octocat",
    repoName: "hello-world",
    title: "재시도 큐 도입",
    status: "in_progress",
    completedBlockCount: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    openedAt: new Date().toISOString(),
  };
  const STORED = {
    ...LIST_ITEM,
    analysisId: "22222222-2222-4222-8222-222222222222",
    candidateKey: "aaa",
    evidence: evidenceSnapshotFixture(),
    history: [
      { role: "question", text: "문제 상황을 알려주세요" },
      { role: "answer", text: "화면이 비어 있었습니다." },
    ],
    blockState: emptyExperienceBlockState(),
    blockVersion: 0,
    progress: emptyInterviewProgress(),
    candidate: { sha: "aaa", evidence: "재시도 큐를 도입했습니다.", technicalTopics: ["Redis"] },
  };

  function stubWithSavedInterview(detail: () => Response) {
    return stubFetch({
      [`/api/interviews/${INTERVIEW_ID}`]: detail,
      "/api/interviews": () => Response.json({ interviews: [LIST_ITEM] }),
      "/api/interview/stream": () => new Response(new ReadableStream(), { status: 200 }),
    });
  }

  it("사이드바에서 고르면 저장된 내용을 먼저 보이고, 이어가기를 누르면 대화를 연다", async () => {
    stubWithSavedInterview(() => Response.json({ interview: STORED }));
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));

    // 대화로 곧바로 들어가지 않고 무엇을 이야기하던 중이었는지를 먼저 보입니다.
    expect(await screen.findByRole("heading", { level: 1, name: "재시도 큐 도입" })).toBeInTheDocument();
    expect(screen.getByText("재시도 큐를 도입했습니다.")).toBeInTheDocument();
    // 이어가기 화면에서도 사이드바는 그 인터뷰의 저장소를 보입니다.
    expect(within(screen.getByRole("region", { name: "Repository" })).getByText("hello-world")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Continue interview/ }));

    expect(await screen.findByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
    // 저장된 대화를 들고 시작합니다.
    expect(screen.getByText("화면이 비어 있었습니다.")).toBeInTheDocument();
  });

  it("지워진 인터뷰를 고르면 그 사실을 알리고 다시 시도할 수 있다", async () => {
    stubWithSavedInterview(() =>
      Response.json({ error: { kind: "not_found", message: "없음" } }, { status: 404 })
    );
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));

    expect(await screen.findByText("This interview is no longer available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  /**
   * 끝낸 뒤에 읽기 전용 대화 앞에 남겨 두면 사용자가 무엇을 해야 하는지 알 수 없습니다. 방금 끝낸
   * 인터뷰의 요약으로 돌아가 무엇이 채워졌는지 보이게 합니다.
   */
  it("인터뷰를 끝내면 그 인터뷰의 요약 화면으로 돌아간다", async () => {
    let completed = false;
    stubFetch({
      [`/api/interviews/${INTERVIEW_ID}`]: () => {
        // 끝내면 상태가 바뀝니다. 요약은 서버에서 다시 읽은 값을 그립니다.
        if (!completed) return Response.json({ interview: STORED });
        return Response.json({ interview: { ...STORED, status: "completed", completedBlockCount: 2 } });
      },
      "/api/interviews": () => Response.json({ interviews: [LIST_ITEM] }),
      "/api/interview/stream": () => new Response(new ReadableStream(), { status: 200 }),
    });
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Continue interview/ }));
    await screen.findByRole("region", { name: "Code / Evidence" });

    completed = true;
    fireEvent.click(screen.getByRole("button", { name: "End interview" }));
    fireEvent.click(screen.getByRole("button", { name: "End the interview" }));

    // 끝난 인터뷰라 버튼 문구가 이어가기가 아니라 다시 보기입니다.
    expect(await screen.findByRole("button", { name: /Review interview/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
  });

  // 끝난 인터뷰를 다시 열면 대화가 다시 자라나면 안 됩니다.
  it("끝난 인터뷰를 다시 열면 질문을 요청하지 않는다", async () => {
    const { calls } = stubFetch({
      [`/api/interviews/${INTERVIEW_ID}`]: () =>
        Response.json({ interview: { ...STORED, status: "completed" } }),
      "/api/interviews": () =>
        Response.json({ interviews: [{ ...LIST_ITEM, status: "completed" }] }),
      "/api/interview/stream": () => new Response(new ReadableStream(), { status: 200 }),
    });
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));

    fireEvent.click(await screen.findByRole("button", { name: /Review interview/ }));

    await screen.findByRole("region", { name: "Code / Evidence" });
    expect(calls.filter((url) => url.includes("/api/interview/stream"))).toHaveLength(0);
  });

  it("새 경험 찾기는 Repository 선택으로 돌아간다", async () => {
    stubWithSavedInterview(() => Response.json({ interview: STORED }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    await screen.findByRole("heading", { level: 1, name: "재시도 큐 도입" });

    fireEvent.click(screen.getByRole("button", { name: "Find new experience" }));

    expect(await screen.findByRole("heading", { name: "Choose a repository to analyze." })).toBeInTheDocument();
  });

  /**
   * "최신 내용 불러오기"는 이동입니다. 저장되지 않은 답변이 있으면 먼저 확인을 받고, 사용자가
   * 이동을 취소하면 아무것도 다시 읽지 않아야 합니다. 예전에는 확인 대화를 띄우기 전에 다시 읽기를
   * 걸어, 취소해도 인터뷰 화면이 내려가고 쓰던 답변이 사라졌습니다(PR #127 리뷰).
   */
  it("최신 내용 불러오기를 취소하면 다시 읽지 않고 인터뷰에 남는다", async () => {
    const { calls } = stubFetch({
      [`/api/interviews/${INTERVIEW_ID}`]: () => Response.json({ interview: STORED }),
      "/api/interviews": () => Response.json({ interviews: [LIST_ITEM] }),
      "/api/interview/stream": () =>
        new Response(
          encodeSseEvent({ type: "chunk", seq: 1, text: "무엇을 해결하려고 했나요?" }) +
            encodeSseEvent({ type: "done", seq: 1 }),
          { status: 200 }
        ),
      // 다른 곳이 먼저 저장한 경우입니다. 저장되지 않은 턴이 남고 "Load latest"가 뜹니다.
      "/api/interview/experience-block": () =>
        Response.json({
          state: { ...emptyExperienceBlockState(), version: 1 },
          affectedBlocks: [],
          targetResponse: "provided",
          save: "version_conflict",
        }),
    });
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Continue interview/ }));
    await screen.findByRole("region", { name: "Code / Evidence" });
    const detailCallsBefore = calls.filter((url) => url.includes(`/api/interviews/${INTERVIEW_ID}`)).length;

    const answer = await screen.findByRole("textbox", { name: /Answer/ });
    fireEvent.change(answer, { target: { value: "재시도 큐를 붙였습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load latest" }));

    fireEvent.click(screen.getByRole("button", { name: "Continue the interview" }));

    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
    expect(calls.filter((url) => url.includes(`/api/interviews/${INTERVIEW_ID}`))).toHaveLength(detailCallsBefore);
  });

  /**
   * 저장된 근거의 모양이 어긋나면 인터뷰 화면을 열지 않습니다(PR #127 리뷰). 예전에는 `null`과 객체
   * 여부만 봐서, 칸이 빠진 값이면 인터뷰 화면이 대표 커밋을 읽다 렌더 도중 멈췄습니다.
   */
  it("근거의 칸이 빠져 있으면 인터뷰를 열지 않고 그 사실을 알린다", async () => {
    const snapshot = evidenceSnapshotFixture();
    stubWithSavedInterview(() =>
      Response.json({
        interview: {
          ...STORED,
          // 대표 커밋에서 화면이 읽는 `files`를 지웁니다. 겉보기에는 스냅샷 모양입니다.
          evidence: { ...snapshot, representativeCommit: { ...snapshot.representativeCommit, files: undefined } },
        },
      })
    );
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Continue interview/ }));

    expect(await screen.findByText("Couldn't open this interview.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
  });

  it("저장된 블록 상태를 읽을 수 없으면 인터뷰를 열지 않는다", async () => {
    stubWithSavedInterview(() =>
      Response.json({ interview: { ...STORED, blockState: { version: 1 } } })
    );
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Continue interview/ }));

    expect(await screen.findByText("Couldn't open this interview.")).toBeInTheDocument();
  });

  /**
   * 한 분석에서 경험을 여러 개 고를 수 있습니다(이슈 #116). 저장된 인터뷰에서 그 분석으로 돌아가는
   * 길이 없으면 사용자는 같은 저장소를 다시 분석해야 하는데, Stage B가 쓰는 모델은 하루 요청 수가
   * 프로젝트 전체에서 20회라 그 길이 사실상 막혀 있습니다.
   */
  it("이어가기 화면에서 그 인터뷰가 나온 분석의 후보 목록으로 간다", async () => {
    const savedAnalysis = {
      id: STORED.analysisId,
      createdAt: "2026-09-10T00:00:00.000Z",
      repoOwner: "octocat",
      repoName: "hello-world",
      contributionItems: [],
      candidates: {
        candidates: {
          candidates: [
            {
              sha: "bbb",
              relatedShas: [],
              summary: "다른 경험 후보입니다.",
              evidence: "근거입니다.",
              technicalTopics: [],
              citedFilePaths: [],
              source: "automatic_recommendation",
            },
          ],
          insufficientCandidatesReason: null,
          diffs: [],
        },
        includedCommits: [
          {
            sha: "bbb",
            title: "다른 커밋",
            author: "octocat",
            date: "2026-08-25T00:00:00Z",
            parentCount: 1,
            message: "다른 커밋",
            additions: 3,
            deletions: 1,
            changedFiles: 1,
            files: [{ path: "src/bbb.ts", status: "modified", additions: 3, deletions: 1, changes: 4 }],
            pullRequests: [],
          },
        ],
      },
      stageASummary: { excludedUnits: [], selectedUnitCount: 1, thresholdScore: 0, unjudgedShas: [] },
    };
    const { calls } = stubFetch({
      [`/api/interviews/${INTERVIEW_ID}`]: () => Response.json({ interview: STORED }),
      "/api/interviews": () => Response.json({ interviews: [LIST_ITEM] }),
      [`/api/analyses/${STORED.analysisId}`]: () => Response.json({ analysis: savedAnalysis }),
    });
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Other experiences from this analysis" }));

    expect((await screen.findAllByText("다른 경험 후보입니다."))[0]).toBeInTheDocument();
    // 저장된 분석을 그대로 그립니다. 다시 분석하지 않습니다.
    expect(analyzeMock).not.toHaveBeenCalled();
    // 저장소 이름이 아니라 그 인터뷰가 가리키는 분석 식별자로 엽니다.
    expect(calls.some((url) => url.includes(`/api/analyses/${STORED.analysisId}`))).toBe(true);
  });
});

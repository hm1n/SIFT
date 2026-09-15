// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeRepository } from "@/features/repository-analysis/repository-analysis";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { encodeSseEvent } from "@/features/interview/sse";
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

/** 요청을 URL로 갈라 응답합니다. 사이드바 목록 조회가 마운트마다 함께 나갑니다(이슈 #115). */
function stubFetch(handlers: Record<string, () => Promise<Response> | Response> = {}) {
  const calls: string[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    for (const [prefix, handler] of Object.entries(handlers)) {
      if (url.includes(prefix)) return Promise.resolve(handler());
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
    fireEvent.click(screen.getByRole("button", { name: /분석하기/ }));

    await waitFor(() => expect(analyzeMock).toHaveBeenCalledWith({ owner: "octocat", repo: "hello-world" }, ["푸시 알림 구현"], expect.any(Function)));
    expect(screen.queryByRole("heading", { name: "분석할 Repository를 선택하세요." })).not.toBeInTheDocument();
    expect(screen.getByText("분석할 커밋이 없습니다.")).toBeInTheDocument();
  });

  it("다른 Repository 선택은 목록을 다시 조회해 선택 화면으로 돌아간다", async () => {
    analyzeMock.mockImplementation(async (_repo, _items, onStateChange) => onStateChange({ status: "empty", kind: "no_commits" }));
    const { calls } = stubFetch();
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("radio", { name: /hello-world/ }));
    fireEvent.click(screen.getByRole("button", { name: /분석하기/ }));
    fireEvent.click(await screen.findByRole("button", { name: "다른 Repository 선택" }));

    await screen.findByRole("heading", { name: "분석할 Repository를 선택하세요." });
    expect(repositoryListCalls(calls)).toBe(2);
    // 고른 Repository가 없어도 사이드바는 그대로 있습니다(이슈 #115).
    expect(within(screen.getByRole("region", { name: "Repository" })).getByText("선택된 Repository 없음")).toBeInTheDocument();
  });
});

/**
 * 이슈 #115로 계약이 바뀌었습니다. 저장이 붙기 전에는 인터뷰 화면을 떠나는 것이 곧 대화를 잃는
 * 것이라 언제나 확인했지만, 이제 저장된 대화는 사이드바에서 다시 이어갈 수 있습니다. 그래서 잃을
 * 것이 있을 때, 즉 저장되지 않은 턴이 남아 있을 때만 확인합니다.
 *
 * 확인을 거는 자리는 그대로 흐름 컴포넌트입니다. 사이드바의 Repository 변경와 새 경험 찾기는
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
        data: { allCommits: [COMMIT], includedCommits: [COMMIT], repository: { fileTree: [], treeTruncated: false, languages: {} } },
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
    fireEvent.click(screen.getByRole("button", { name: /분석하기/ }));
    fireEvent.click(await screen.findByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: /인터뷰 시작/ }));
    // 인터뷰 화면이 떴는지는 3열 워크스페이스의 코드 패널로 봅니다.
    await screen.findByRole("region", { name: "Code / Evidence" });
  }

  // 저장된 대화는 다시 이어갈 수 있으므로 잃을 것이 없습니다. 묻지 않고 나갑니다.
  it("저장되지 않은 답변이 없으면 확인 없이 나간다", async () => {
    await renderWithConfirmedInterview();

    fireEvent.click(screen.getByRole("button", { name: "← Repository 변경" }));

    await screen.findByRole("heading", { name: "분석할 Repository를 선택하세요." });
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
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: "화면이 비어 있었습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await screen.findByText("마지막 답변이 저장되지 않았습니다.");

    fireEvent.click(screen.getByRole("button", { name: "← Repository 변경" }));

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 계속하기" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
  });

  it("확인 뒤 나가기를 누르면 선택 화면으로 돌아간다", async () => {
    await renderWithConfirmedInterview({
      "/api/interview/experience-block": () =>
        Response.json({ error: { kind: "storage_failed", message: "끊김" } }, { status: 503 }),
    });
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: "화면이 비어 있었습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await screen.findByText("마지막 답변이 저장되지 않았습니다.");

    fireEvent.click(screen.getByRole("button", { name: "← Repository 변경" }));
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));

    await screen.findByRole("heading", { name: "분석할 Repository를 선택하세요." });
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

    fireEvent.click(screen.getByRole("button", { name: /인터뷰 계속하기/ }));

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

    expect(await screen.findByText("이 인터뷰를 찾을 수 없습니다.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /인터뷰 계속하기/ }));
    await screen.findByRole("region", { name: "Code / Evidence" });

    completed = true;
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));

    // 끝난 인터뷰라 버튼 문구가 이어가기가 아니라 다시 보기입니다.
    expect(await screen.findByRole("button", { name: /인터뷰 다시 보기/ })).toBeInTheDocument();
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

    fireEvent.click(await screen.findByRole("button", { name: /인터뷰 다시 보기/ }));

    await screen.findByRole("region", { name: "Code / Evidence" });
    expect(calls.filter((url) => url.includes("/api/interview/stream"))).toHaveLength(0);
  });

  it("새 경험 찾기는 Repository 선택으로 돌아간다", async () => {
    stubWithSavedInterview(() => Response.json({ interview: STORED }));
    render(<RepositoryFlow />);
    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    await screen.findByRole("heading", { level: 1, name: "재시도 큐 도입" });

    fireEvent.click(screen.getByRole("button", { name: "새 경험 찾기" }));

    expect(await screen.findByRole("heading", { name: "분석할 Repository를 선택하세요." })).toBeInTheDocument();
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
      // 다른 곳이 먼저 저장한 경우입니다. 저장되지 않은 턴이 남고 "최신 내용 불러오기"가 뜹니다.
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
    fireEvent.click(await screen.findByRole("button", { name: /인터뷰 계속하기/ }));
    await screen.findByRole("region", { name: "Code / Evidence" });
    const detailCallsBefore = calls.filter((url) => url.includes(`/api/interviews/${INTERVIEW_ID}`)).length;

    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: "재시도 큐를 붙였습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    fireEvent.click(await screen.findByRole("button", { name: "최신 내용 불러오기" }));

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 계속하기" }));

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
    fireEvent.click(await screen.findByRole("button", { name: /인터뷰 계속하기/ }));

    expect(await screen.findByText("이 인터뷰를 열지 못했습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
  });

  it("저장된 블록 상태를 읽을 수 없으면 인터뷰를 열지 않는다", async () => {
    stubWithSavedInterview(() =>
      Response.json({ interview: { ...STORED, blockState: { version: 1 } } })
    );
    render(<RepositoryFlow />);

    fireEvent.click(await screen.findByRole("button", { name: /^재시도 큐 도입/ }));
    fireEvent.click(await screen.findByRole("button", { name: /인터뷰 계속하기/ }));

    expect(await screen.findByText("이 인터뷰를 열지 못했습니다.")).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { WorkUnit } from "@/features/experience-candidates/work-unit";
import { toExcludedUnitSummary, type ExcludedUnitSummary } from "@/features/experience-candidates/work-unit-selection";
import type { ReadonlyCommitDetail } from "@/lib/github/types";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import {
  ANALYSIS_STAGES,
  analyzeRepository,
  generateCandidates,
  type AnalysisError,
  type AnalysisState,
  type CandidateRetryPoint,
  type StageASelectionState,
} from "./repository-analysis";
import { SavedInterviewFetchError } from "@/features/saved-interviews/client";
import type {
  createSavedInterview,
  fetchAnalysisByRepository,
  fetchStoredAnalysis,
  saveRepositoryAnalysis,
} from "@/features/saved-interviews/client";
import { RepositoryAnalysisView } from "./repository-analysis-view";


function commit(sha: string, title: string): ReadonlyCommitDetail {
  return {
    sha, title, author: "octocat", date: "2026-08-24T00:00:00Z", parentCount: 1,
    message: title, additions: 1, deletions: 0, changedFiles: 1, files: [], pullRequests: [],
  };
}

/** 점수 컷에서 밀린 PR 묶음 하나입니다. 화면 배선만 확인하는 스위트라 세부 신호는 두지 않습니다. */
function excludedPullRequestUnit(number: number): ExcludedUnitSummary {
  const unit: WorkUnit<ReadonlyCommitDetail> = {
    kind: "pull_request",
    unitId: `pr:${number}`,
    title: "잡무 PR",
    pullRequest: { number, title: "잡무 PR", state: "closed", baseBranch: "develop", headBranch: "f" },
    commits: [commit(`sha-${number}`, "잡무 PR")],
  };
  return toExcludedUnitSummary({ unit, score: 1, reason: "over_input_budget", signals: [] });
}

vi.mock("./repository-analysis", async (importOriginal) => {
  const original = await importOriginal<typeof import("./repository-analysis")>();
  return { ...original, analyzeRepository: vi.fn(), generateCandidates: vi.fn() };
});

const routerMock = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const analyzeMock = vi.mocked(analyzeRepository);
const generateMock = vi.mocked(generateCandidates);

/** `RepositoryAnalysisView`는 #96부터 `RepositorySummary`를 받습니다. 분석 로직에는 owner·repo만 좁혀 넘깁니다. */
const REPOSITORY = { id: 1, owner: "octocat", name: "hello-world", visibility: "public", language: "TypeScript", pushedAt: null } as const;
const REPOSITORY_REF = { owner: REPOSITORY.owner, repo: REPOSITORY.name };
const onSelectRepository = vi.fn();

const RETRY_POINT: CandidateRetryPoint = {
  repository: REPOSITORY_REF,
  contributionItems: [],
  data: { allCommits: [], includedCommits: [], repository: { fileTree: [], treeTruncated: false, languages: {} } },
};
/** 이 화면 안내 스위트는 Stage A 선별 표시 자체가 아니라 후보 목록 표시를 검증하므로 빈 값을 씁니다. */
const EMPTY_STAGE_A_SELECTION: StageASelectionState = {
  excludedUnits: [],
  thresholdScore: 0,
  selectedUnitCount: 0,
  unjudgedShas: [],
};

/**
 * 저장된 분석이 없는 경우입니다(이슈 #116). 화면은 저장된 것을 먼저 찾아보고 없을 때만 분석하므로,
 * 분석 경로를 보는 테스트는 이 답을 씁니다.
 */
function noSavedAnalysis() {
  return vi
    .fn<typeof fetchAnalysisByRepository>()
    .mockRejectedValue(new SavedInterviewFetchError("not_found", "저장된 분석이 없습니다."));
}

/** Repository와 기여 항목은 선택 화면이 prop으로 넘기고, 화면은 마운트되자마자 분석을 시작합니다. */
function renderView(contributionItems: readonly string[] = []) {
  return render(
    <RepositoryAnalysisView
      repository={REPOSITORY}
      contributionItems={contributionItems}
      onSelectRepository={onSelectRepository}
      fetchAnalysis={noSavedAnalysis()}
    />
  );
}

async function renderAndAnalyze(contributionItems: readonly string[] = []) {
  const view = renderView(contributionItems);
  await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
  return view;
}

function mockState(state: AnalysisState) {
  analyzeMock.mockImplementation(async (_auth, _items, onStateChange) => onStateChange(state));
}

beforeEach(() => {
  analyzeMock.mockReset();
  generateMock.mockReset();
  routerMock.refresh.mockReset();
  onSelectRepository.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RepositoryAnalysisView 시작", () => {
  it("마운트되면 받은 Repository와 기여 항목으로 분석을 한 번 시작한다", async () => {
    await renderAndAnalyze(["푸시 알림 구현", "게시판 기능 구현"]);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(analyzeMock).toHaveBeenCalledWith(REPOSITORY_REF, ["푸시 알림 구현", "게시판 기능 구현"], expect.any(Function));
  });

  it("Owner·Repository 입력 폼과 기여 항목 입력을 그리지 않는다", async () => {
    await renderAndAnalyze();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("다시 그려도 분석을 다시 시작하지 않는다", async () => {
    const { rerender } = await renderAndAnalyze();
    rerender(<RepositoryAnalysisView repository={REPOSITORY} contributionItems={[]} onSelectRepository={onSelectRepository} />);
    await Promise.resolve();
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });
});

// Codex 리뷰 P1: AppShell 도입으로 공용 header·main이 사라지면서 네 상태 전부 랜드마크와 접근 가능한
// 제목을 잃었습니다. 상태마다 하나씩 회귀 테스트를 둡니다.
describe("RepositoryAnalysisView 시맨틱 구조", () => {
  it("Loading은 main 랜드마크 안에 보이는 h1을 둔다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });
    await renderAndAnalyze();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "octocat / hello-world" }));
  });

  it("Empty는 main 랜드마크 안에 스크린리더 전용 h1을 둔다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "octocat / hello-world" }));
  });

  it("Error는 main 랜드마크 안에 스크린리더 전용 h1을 둔다", async () => {
    mockState({ status: "error", error: { kind: "network", title: "네트워크 실패", message: "연결 확인", recovery: "retry" } });
    await renderAndAnalyze();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "octocat / hello-world" }));
  });

  it("Success는 main 랜드마크 안에 h1을 두어 후보 목록의 h2보다 앞선 제목을 보존한다", async () => {
    mockState({
      status: "success",
      data: RETRY_POINT.data,
      candidates: {
        candidates: [{ sha: "sha-a-40", relatedShas: [], summary: "경험 요약입니다.", evidence: "근거입니다.", technicalTopics: [], citedFilePaths: [], source: "automatic_recommendation" }],
        insufficientCandidatesReason: "하나뿐입니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "octocat / hello-world" }));
    // master-detail(#97)부터 목록과 상세가 함께 렌더돼 h2가 여럿입니다. 숨은 h1이 그보다 앞선다는
    // 것만 확인합니다.
    expect(screen.getAllByRole("heading", { level: 2 }).length).toBeGreaterThan(0);
  });
});

describe("RepositoryAnalysisView Loading", () => {
  it("헤더에 owner·name과 visibility·language를 표시한다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });
    await renderAndAnalyze();
    expect(screen.getByRole("heading", { name: "octocat / hello-world" })).toBeInTheDocument();
    expect(screen.getByText("PUBLIC · TypeScript")).toBeInTheDocument();
  });

  it.each([
    [{ step: "commits" }, ["active", "pending", "pending", "pending", "pending", "pending"]],
    [{ step: "details", completed: 2, total: 5, phase: "commit_details" }, ["done", "active", "pending", "pending", "pending", "pending"]],
    [{ step: "details", completed: 5, total: 5, phase: "repository_metadata" }, ["done", "done", "active", "pending", "pending", "pending"]],
    [{ step: "deriving" }, ["done", "done", "done", "active", "pending", "pending"]],
    [{ step: "stage_a", total: 5 }, ["done", "done", "done", "done", "active", "pending"]],
    [{ step: "stage_b" }, ["done", "done", "done", "done", "done", "active"]],
  ] as const)("단계 %o의 체크리스트 상태를 순서대로 표시한다", async (loading, states) => {
    mockState({ status: "loading", loading });
    await renderAndAnalyze();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("data-state"))).toEqual(states);
  });

  /**
   * 체크리스트를 `ANALYSIS_STAGES`에서 폅니다. 배열을 따로 들면 단계가 하나 늘 때 화면에서 조용히
   * 빠지고, `analysis_stage_done`은 나가는데 사용자는 그 단계를 못 보는 상태가 됩니다.
   */
  it("체크리스트 항목이 분석 단계 수와 같다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });
    await renderAndAnalyze();
    expect(screen.getAllByRole("listitem")).toHaveLength(ANALYSIS_STAGES.length);
  });

  // PR #105 Codex 리뷰 P1: 완료·진행·대기 구분이 aria-hidden 기호와 CSS에만 있으면 스크린리더는
  // 여섯 라벨을 구분 없이 나열합니다. 진행 중 항목에 aria-current를 두고 항목마다 상태 문구를 노출합니다.
  it("진행 중 항목에만 aria-current=\"step\"을 표시한다", async () => {
    mockState({ status: "loading", loading: { step: "deriving" } });
    await renderAndAnalyze();
    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, null, null, "step", null, null]);
  });

  it("항목마다 완료·진행·대기 상태를 텍스트로도 노출한다", async () => {
    mockState({ status: "loading", loading: { step: "deriving" } });
    await renderAndAnalyze();
    expect(screen.getAllByText("Completed:")).toHaveLength(3);
    expect(screen.getByText("In progress:")).toBeInTheDocument();
    expect(screen.getAllByText("Pending:")).toHaveLength(2);
  });

  it("상세 조회 단계는 n / total 진행률을 함께 표시한다", async () => {
    mockState({ status: "loading", loading: { step: "details", completed: 2, total: 5, phase: "commit_details" } });
    await renderAndAnalyze();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
  });

  // 요청이 하나가 되면서 중간 보고 지점이 사라졌습니다. 판단한 개수를 계속 세는 문구는 응답이 올
  // 때까지 0에 멈춰 있어 실제와 달랐습니다(2026-09-02 브라우저 실측에서 5~6초 동안 관측).
  it("Stage A는 진행률 없이 기호만 표시한다", async () => {
    mockState({ status: "loading", loading: { step: "stage_a", total: 67 } });
    await renderAndAnalyze();
    expect(screen.queryByText(/67/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ \/ \d+/)).not.toBeInTheDocument();
  });

  it("Change repository를 누르면 onSelectRepository를 부른다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "← Change repository" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });
});

describe("RepositoryAnalysisView Empty", () => {
  it.each([
    ["no_commits", "No commits found to analyze."],
    ["no_author_commits", "No commits authored by you were found."],
    ["no_analyzable_commits", "This repository is difficult to analyze."],
    ["no_stage_a_candidates", "No experience candidates worth explaining were found."],
  ] as const)("%s를 별도 안내로 표시한다", async (kind, label) => {
    mockState({ status: "empty", kind });
    await renderAndAnalyze();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a different repository" })).toBeInTheDocument();
  });

  it("다른 Repository 선택은 세션을 지우지 않고 onSelectRepository를 부른다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "Choose a different repository" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});

// 이슈 #58 Codex 리뷰 P1-2: 후보 0개 빈 상태가 Stage A 제외 정보를 버리면 기능의 목적이 무너집니다.
// 성공 상태와 같은 StageAExclusions를 재사용하므로 여기서는 배선(빈 상태에서도 렌더되는지, 빈 값이면
// 렌더하지 않는지, Stage A 전 빈 상태는 영향받지 않는지)만 확인합니다. 세부 렌더 규칙(정렬·구획 분리
// 등)은 experience-candidate-list.test.tsx가 이미 검증합니다.
describe("RepositoryAnalysisView 저장된 분석으로 열기", () => {
  const SAVED_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  function storedAnalysis(overrides: { id?: string; createdAt?: string } = {}) {
    return {
      id: overrides.id ?? "a1",
      createdAt: overrides.createdAt ?? "2026-09-10T00:00:00.000Z",
      repoOwner: REPOSITORY.owner,
      repoName: REPOSITORY.name,
      contributionItems: ["성능 개선"],
      candidates: {
        candidates: {
          candidates: [
            {
              sha: SAVED_SHA,
              relatedShas: [],
              summary: "저장된 경험 요약입니다.",
              evidence: "저장된 근거입니다.",
              technicalTopics: [],
              citedFilePaths: [],
              source: "automatic_recommendation",
            },
          ],
          insufficientCandidatesReason: null,
          diffs: [],
        },
        includedCommits: [commit(SAVED_SHA, "저장된 커밋")],
      },
      stageASummary: EMPTY_STAGE_A_SELECTION,
    } as unknown as Awaited<ReturnType<typeof fetchAnalysisByRepository>>;
  }

  function renderWithSaved(fetchAnalysis: Mock<typeof fetchAnalysisByRepository>) {
    return render(
      <RepositoryAnalysisView
        repository={REPOSITORY}
        contributionItems={["이번에 적은 기여"]}
        onSelectRepository={onSelectRepository}
        fetchAnalysis={fetchAnalysis}
        saveAnalysis={vi.fn<typeof saveRepositoryAnalysis>().mockResolvedValue("a-new")}
      />
    );
  }

  /**
   * Stage B가 쓰는 모델은 하루 요청 수가 프로젝트 전체에서 20회입니다. 저장된 결과가 있는데도 다시
   * 분석하면 사용자가 고르지 않은 요청이 그 한도를 씁니다.
   */
  it("저장된 분석이 있으면 다시 분석하지 않고 그 후보를 그린다", async () => {
    const fetchAnalysis = vi.fn<typeof fetchAnalysisByRepository>().mockResolvedValue(storedAnalysis());

    renderWithSaved(fetchAnalysis);

    // master-detail이라 목록 행과 상세가 같은 제목을 함께 그립니다.
    expect(await screen.findAllByText("저장된 경험 요약입니다.")).not.toHaveLength(0);
    expect(analyzeMock).not.toHaveBeenCalled();
    expect(fetchAnalysis).toHaveBeenCalledWith(REPOSITORY.owner, REPOSITORY.name);
  });

  // 저장된 값이라는 사실을 감추면 사용자는 지금 저장소 상태를 본다고 오해합니다.
  it("저장된 결과라는 것과 저장한 날짜를 알린다", async () => {
    renderWithSaved(vi.fn<typeof fetchAnalysisByRepository>().mockResolvedValue(storedAnalysis()));

    expect(await screen.findByText(/Showing the analysis saved on/)).toBeInTheDocument();
    expect(screen.getByText("Sep 10, 2026")).toBeInTheDocument();
  });

  /**
   * 선택 화면에서 기여 항목을 적고 들어와도 저장된 분석이 열리면 그 입력은 쓰이지 않습니다. 말하지
   * 않으면 사용자는 자기가 적은 것이 반영된 후보 목록을 본다고 여깁니다(자체 리뷰 P2-2).
   */
  it("적어 온 기여 항목이 저장된 분석에 반영되지 않았다고 알린다", async () => {
    renderWithSaved(vi.fn<typeof fetchAnalysisByRepository>().mockResolvedValue(storedAnalysis()));

    expect(await screen.findByText(/contributions you just described are not reflected/)).toBeInTheDocument();
  });

  it("적어 온 기여 항목이 없으면 그 안내를 하지 않는다", async () => {
    render(
      <RepositoryAnalysisView
        repository={REPOSITORY}
        contributionItems={[]}
        onSelectRepository={onSelectRepository}
        fetchAnalysis={vi.fn<typeof fetchAnalysisByRepository>().mockResolvedValue(storedAnalysis())}
        saveAnalysis={vi.fn<typeof saveRepositoryAnalysis>().mockResolvedValue("a-new")}
      />
    );

    await screen.findByText(/Showing the analysis saved on/);
    expect(screen.queryByText(/contributions you just described/)).not.toBeInTheDocument();
  });

  it("다시 분석하면 저장된 결과 안내가 사라지고 분석이 시작된다", async () => {
    renderWithSaved(vi.fn<typeof fetchAnalysisByRepository>().mockResolvedValue(storedAnalysis()));
    await screen.findByText(/Showing the analysis saved on/);
    mockState({ status: "loading", loading: { step: "commits" } });

    fireEvent.click(screen.getByRole("button", { name: "Analyze again" }));

    await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
    expect(screen.queryByText(/Showing the analysis saved on/)).not.toBeInTheDocument();
  });

  /**
   * 조회 실패를 "저장된 것이 없음"으로 접으면 저장 계층이 잠시 끊긴 동안 들어온 사용자마다 새 분석이
   * 돌아 하루치 한도를 씁니다.
   */
  it("조회가 실패하면 분석하지 않고 오류를 알린다", async () => {
    const fetchAnalysis = vi
      .fn<typeof fetchAnalysisByRepository>()
      .mockRejectedValue(new SavedInterviewFetchError("storage_failed", "저장소에 연결하지 못했습니다."));

    renderWithSaved(fetchAnalysis);

    expect(await screen.findByText("Couldn't check for a saved analysis.")).toBeInTheDocument();
    expect(analyzeMock).not.toHaveBeenCalled();
  });

  it("조회 실패를 다시 시도하면 저장된 분석을 다시 찾는다", async () => {
    const fetchAnalysis = vi
      .fn<typeof fetchAnalysisByRepository>()
      .mockRejectedValueOnce(new SavedInterviewFetchError("storage_failed", "끊겼습니다."))
      .mockResolvedValue(storedAnalysis());

    renderWithSaved(fetchAnalysis);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    // master-detail이라 목록 행과 상세가 같은 제목을 함께 그립니다.
    expect(await screen.findAllByText("저장된 경험 요약입니다.")).not.toHaveLength(0);
    expect(fetchAnalysis).toHaveBeenCalledTimes(2);
  });

  /**
   * 저장된 인터뷰에서 그 분석으로 들어오는 경로입니다. 저장소 이름으로 찾으면 그 사이에 다시 분석한
   * 결과가 있을 때 사용자가 보던 것과 다른 후보 목록이 열립니다.
   */
  it("분석 식별자를 받으면 저장소 이름으로 찾지 않는다", async () => {
    const fetchAnalysis = noSavedAnalysis();
    const fetchAnalysisById = vi
      .fn<typeof fetchStoredAnalysis>()
      .mockResolvedValue(storedAnalysis({ id: "a-old" }));

    render(
      <RepositoryAnalysisView
        repository={{ owner: REPOSITORY.owner, name: REPOSITORY.name }}
        contributionItems={[]}
        analysisId="a-old"
        onSelectRepository={onSelectRepository}
        fetchAnalysis={fetchAnalysis}
        fetchAnalysisById={fetchAnalysisById}
      />
    );

    expect((await screen.findAllByText("저장된 경험 요약입니다."))[0]).toBeInTheDocument();
    expect(fetchAnalysisById).toHaveBeenCalledWith("a-old");
    expect(fetchAnalysis).not.toHaveBeenCalled();
  });

  /** 90일이 지나 지워진 분석입니다. 저장소의 다른 분석을 말없이 열면 고른 것과 다른 목록이 보입니다. */
  it("가리킨 분석이 사라졌으면 다시 분석할지 묻는다", async () => {
    const fetchAnalysisById = vi
      .fn<typeof fetchStoredAnalysis>()
      .mockRejectedValue(new SavedInterviewFetchError("not_found", "없습니다."));
    mockState({ status: "loading", loading: { step: "commits" } });

    render(
      <RepositoryAnalysisView
        repository={{ owner: REPOSITORY.owner, name: REPOSITORY.name }}
        contributionItems={[]}
        analysisId="a-gone"
        onSelectRepository={onSelectRepository}
        fetchAnalysis={noSavedAnalysis()}
        fetchAnalysisById={fetchAnalysisById}
      />
    );

    expect(await screen.findByText("This saved analysis is no longer available.")).toBeInTheDocument();
    expect(analyzeMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Analyze this repository" }));
    await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
    // 안내가 남아 있으면 분석이 도는 동안에도 "사라졌다"는 말이 함께 보입니다(PR #130 리뷰).
    expect(screen.queryByText("This saved analysis is no longer available.")).not.toBeInTheDocument();
  });

  it("저장된 분석이 없으면 분석을 시작한다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });

    renderWithSaved(noSavedAnalysis());

    await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
  });
});

describe("RepositoryAnalysisView Empty의 Stage A 제외 표시", () => {
  it("no_stage_a_candidates에서도 제외 요약이 화면에 보인다", async () => {
    mockState({
      status: "empty",
      kind: "no_stage_a_candidates",
      stageASelection: {
        excludedUnits: [excludedPullRequestUnit(1)],
        thresholdScore: 3,
        selectedUnitCount: 0,
        unjudgedShas: [],
      },
    });
    await renderAndAnalyze();

    expect(screen.getByRole("heading", { name: "Excluded in the first pass" })).toBeInTheDocument();
    expect(screen.getByText("The repository is large, so only 0 of 1 work units were judged")).toBeInTheDocument();
  });

  it("제외 0건이면 제외 섹션이 렌더되지 않는다", async () => {
    mockState({ status: "empty", kind: "no_stage_a_candidates", stageASelection: EMPTY_STAGE_A_SELECTION });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "Excluded in the first pass" })).not.toBeInTheDocument();
  });

  it("Stage A 전에 나는 빈 상태는 stageASelection이 없어도 지금과 똑같이 동작한다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "Excluded in the first pass" })).not.toBeInTheDocument();
    expect(screen.getByText("No commits found to analyze.")).toBeInTheDocument();
  });

  it("unjudgedShas가 있으면 no_final_candidates에서도 판단 불가 표시가 보인다", async () => {
    mockState({
      status: "empty",
      kind: "no_final_candidates",
      reason: "실제 diff 근거로 설명할 수 있는 커밋이 없습니다.",
      stageASelection: { ...EMPTY_STAGE_A_SELECTION, unjudgedShas: ["deadbeef00112233"] },
    });
    await renderAndAnalyze();

    expect(screen.getByText("1 work unit the model did not judge")).toBeInTheDocument();
    expect(screen.getByText("deadbee")).toBeInTheDocument();
  });

  it("빈 상태 섹션의 aria-live=\"polite\"를 유지한다", async () => {
    mockState({
      status: "empty",
      kind: "no_stage_a_candidates",
      stageASelection: {
        excludedUnits: [excludedPullRequestUnit(1)],
        thresholdScore: 3,
        selectedUnitCount: 0,
        unjudgedShas: [],
      },
    });
    await renderAndAnalyze();

    const label = screen.getByText("No experience candidates worth explaining were found.");
    expect(label.closest("section")).toHaveAttribute("aria-live", "polite");
  });

  it("제외 구획은 빈 상태에서도 키보드로 펼치고 접을 수 있다", async () => {
    mockState({
      status: "empty",
      kind: "no_stage_a_candidates",
      stageASelection: {
        excludedUnits: [excludedPullRequestUnit(1)],
        thresholdScore: 3,
        selectedUnitCount: 0,
        unjudgedShas: [],
      },
    });
    await renderAndAnalyze();

    const summaryText = "The repository is large, so only 0 of 1 work units were judged";
    const details = screen.getByText(summaryText).closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText(summaryText));
    expect(details).toHaveAttribute("open");
    fireEvent.click(screen.getByText(summaryText));
    expect(details).not.toHaveAttribute("open");
  });
});

describe("RepositoryAnalysisView Error", () => {
  const errors: Array<[AnalysisError, string]> = [
    [{ kind: "rate_limit", title: "호출 한도", message: "잠시 후 재시도", recovery: "retry" }, "Retry full analysis"],
    [{ kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" }, "Log in to GitHub again"],
    [{ kind: "repo_not_found", title: "미존재", message: "이름 확인", recovery: "select_repository" }, "Choose a different repository"],
    [{ kind: "partial_failure", causeKind: "rate_limit", title: "일부 실패", message: "3개 중 1개 수집", recovery: "retry", completed: 1, total: 3 }, "Retry full analysis"],
    [{ kind: "network", title: "네트워크 실패", message: "연결 확인", recovery: "retry" }, "Retry full analysis"],
    [{ kind: "server_error", title: "서버 실패", message: "잠시 후", recovery: "retry" }, "Retry full analysis"],
  ];

  it.each(errors)("%s 오류에 맞는 안내와 복구 버튼을 표시한다", async (error, action) => {
    mockState({ status: "error", error });
    await renderAndAnalyze();
    expect(screen.getByRole("alert")).toHaveTextContent(error.message);
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });

  it("네트워크·서버 오류의 재시도 버튼은 같은 Repository와 기여 항목으로 전체 재조회한다", async () => {
    const error: AnalysisError = { kind: "network", title: "네트워크 실패", message: "연결 확인", recovery: "retry" };
    mockState({ status: "error", error });
    await renderAndAnalyze(["푸시 알림 구현"]);
    fireEvent.click(screen.getByRole("button", { name: "Retry full analysis" }));
    await waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(2));
    expect(analyzeMock.mock.calls[1][0]).toEqual(REPOSITORY_REF);
    expect(analyzeMock.mock.calls[1][1]).toEqual(["푸시 알림 구현"]);
  });

  it("Repository 다시 선택은 onSelectRepository를 부른다", async () => {
    mockState({ status: "error", error: { kind: "repo_not_found", title: "미존재", message: "이름 확인", recovery: "select_repository" } });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "Choose a different repository" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });

  it("인증 재진행을 선택하면 세션을 삭제하고 라우터를 갱신해 헤더와 화면이 함께 로그인 전 상태가 된다", async () => {
    const error: AnalysisError = { kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" };
    mockState({ status: "error", error });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "Log in to GitHub again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenLastCalledWith(SESSION_PATH, { method: "DELETE" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 쿠키를 지우지 못해도 오류 화면은 내리고 서버에 다시 묻습니다. 쿠키가 남았다면 서버가 로그인 상태로 다시 그려 사용자가 알 수 있습니다.
  it("세션 삭제 요청이 실패해도 분석 상태를 버리고 라우터를 갱신한다", async () => {
    const error: AnalysisError = { kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" };
    mockState({ status: "error", error });
    await renderAndAnalyze();
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Log in to GitHub again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // 세션이 사라지면 page.tsx가 이 화면을 통째로 내립니다. 그 뒤 도착하는 결과는 화면에 오르지 않아야 합니다.
  it("화면이 내려간 뒤 늦게 도착한 결과는 무시된다", async () => {
    let finish: ((state: AnalysisState) => void) | undefined;
    analyzeMock.mockImplementation((_repo, _items, onStateChange) => {
      onStateChange({ status: "loading", loading: { step: "commits" } });
      return new Promise<void>((resolve) => {
        finish = (state) => {
          onStateChange(state);
          resolve();
        };
      });
    });
    const { unmount } = await renderAndAnalyze();
    expect(screen.getByRole("status")).toBeInTheDocument();

    unmount();
    const error: AnalysisError = { kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" };
    finish!({ status: "error", error });
    await Promise.resolve();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // 다시 로그인을 누른 뒤 서버가 화면을 바꾸기 전에 도착한 결과도 실행 번호로 걸러냅니다.
  it("인증 재진행 뒤 늦게 도착한 결과는 화면에 올리지 않는다", async () => {
    let finish: ((state: AnalysisState) => void) | undefined;
    analyzeMock.mockImplementation((_repo, _items, onStateChange) => {
      onStateChange({ status: "error", error: { kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" } });
      return new Promise<void>((resolve) => {
        finish = (state) => {
          onStateChange(state);
          resolve();
        };
      });
    });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "Log in to GitHub again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));

    finish!({ status: "loading", loading: { step: "commits" } });
    await Promise.resolve();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("RepositoryAnalysisView 후보 생성 상태", () => {
  it("최종 후보 0개 Empty에 서버가 보낸 부족 사유와 기준 유지 안내를 함께 표시한다", async () => {
    mockState({ status: "empty", kind: "no_final_candidates", reason: "실제 diff 근거로 설명할 수 있는 커밋이 없습니다." });
    await renderAndAnalyze();

    expect(screen.getByText("Unable to produce final experience candidates.")).toBeInTheDocument();
    expect(screen.getByText(/실제 diff 근거로 설명할 수 있는 커밋이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/We don't lower the bar or fill in candidates artificially/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose a different repository" })).toBeInTheDocument();
    // 후보 0개는 이 Empty가 처리하므로 후보 목록과 선택 액션에 도달하지 않습니다(이슈 #55).
    expect(screen.queryByRole("button", { name: "이 경험으로 인터뷰 시작" })).not.toBeInTheDocument();
  });

  it("후보가 3개 미만인 성공 상태에 생성 개수와 부족 사유를 안내한다", async () => {
    mockState({
      status: "success",
      data: RETRY_POINT.data,
      candidates: {
        candidates: [
          { sha: "a1b2c3d4e5", relatedShas: [], summary: "분석 상태 머신 구현", evidence: "상태 머신을 구현했습니다.", technicalTopics: [], citedFilePaths: [], source: "contribution_match" },
          { sha: "f6e5d4c3b2", relatedShas: [], summary: "오류 계약 정의", evidence: "오류 계약을 정의했습니다.", technicalTopics: [], citedFilePaths: [], source: "automatic_recommendation" },
        ],
        insufficientCandidatesReason: "나머지 커밋은 diff 근거가 부족합니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();

    expect(screen.getByText("2 experiences found")).toBeInTheDocument();
    expect(screen.getByText(/나머지 커밋은 diff 근거가 부족합니다/)).toBeInTheDocument();
    expect(screen.getByText(/The bar is not lowered and candidates are not padded/)).toBeInTheDocument();
    // master-detail(#97)부터 기본 선택된 첫 후보의 evidence는 "Why worth discussing"에 나옵니다.
    expect(screen.getByText("상태 머신을 구현했습니다.")).toBeInTheDocument();
  });

  /**
   * 이슈 #115입니다. 경험을 확정할 때 인터뷰 한 줄과 그 시점의 분석 결과를 함께 저장합니다. 저장
   * 전용 요청을 만들지 않는 대신 이 시점에 줄을 만들어 두고, 이후 턴은 블록 갱신 요청에 얹습니다.
   */
  describe("경험 확정 시점의 저장", () => {
    const PATCH = ["@@ -1 +1 @@", "-old", "+new"].join(String.fromCharCode(10));
    const SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    /** 근거 스냅샷을 만들려면 대표 커밋이 색인에 있고 변경 파일이 있어야 합니다. */
    function successStateWithEvidence(): AnalysisState {
      const detail: ReadonlyCommitDetail = {
        ...commit(SHA, "스트리밍 렌더링 최적화"),
        files: [
          { path: "src/app.ts", status: "modified", additions: 3, deletions: 1, changes: 4, patch: PATCH },
        ],
      };
      return {
        status: "success",
        data: { includedCommits: [detail] },
        candidates: {
          candidates: [
            { sha: SHA, relatedShas: [], summary: "경험 요약입니다.", evidence: "근거입니다.", technicalTopics: [], citedFilePaths: [], source: "automatic_recommendation" },
          ],
          insufficientCandidatesReason: null,
          diffs: [],
        },
        stageASelection: EMPTY_STAGE_A_SELECTION,
      };
    }

    function createdInterview() {
      return vi.fn<typeof createSavedInterview>().mockResolvedValue({ interviewId: "i1", analysisId: "a1" });
    }

    function savedAnalysis() {
      return vi.fn<typeof saveRepositoryAnalysis>().mockResolvedValue("a1");
    }

    async function renderAnalyzed(
      createInterview: Mock<typeof createSavedInterview>,
      saveAnalysis: Mock<typeof saveRepositoryAnalysis> = savedAnalysis()
    ) {
      mockState(successStateWithEvidence());
      render(
        <RepositoryAnalysisView
          repository={REPOSITORY}
          contributionItems={["성능 개선"]}
          onSelectRepository={onSelectRepository}
          createInterview={createInterview}
          saveAnalysis={saveAnalysis}
          fetchAnalysis={noSavedAnalysis()}
        />
      );
      await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
      return saveAnalysis;
    }

    async function confirmExperience(
      createInterview: Mock<typeof createSavedInterview>,
      saveAnalysis: Mock<typeof saveRepositoryAnalysis> = savedAnalysis()
    ) {
      await renderAnalyzed(createInterview, saveAnalysis);
      fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));
      await waitFor(() => expect(createInterview).toHaveBeenCalled());
      return saveAnalysis;
    }

    /**
     * 정의서가 정한 저장 시점입니다(이슈 #116). 확정까지 미루면 경험을 하나도 고르지 않고 나간
     * 사용자가 다시 들어왔을 때 후보 목록이 없습니다.
     */
    it("분석이 끝나면 경험을 고르기 전에 축약본을 저장한다", async () => {
      const createInterview = createdInterview();

      const saveAnalysis = await renderAnalyzed(createInterview);

      await waitFor(() => expect(saveAnalysis).toHaveBeenCalledTimes(1));
      expect(saveAnalysis.mock.calls[0][0]).toMatchObject({
        repoOwner: "octocat",
        repoName: "hello-world",
        contributionItems: ["성능 개선"],
      });
      expect(createInterview).not.toHaveBeenCalled();
    });

    it("확정하면 저장한 분석에 후보와 근거를 붙인다", async () => {
      const createInterview = createdInterview();

      await confirmExperience(createInterview);

      const body = createInterview.mock.calls[0][0];
      expect(body).toMatchObject({
        analysisId: "a1",
        candidateKey: SHA,
        // 목록 화면이 그 후보에 붙인 제목 그대로입니다. 저장된 목록과 후보 목록이 같은 이름을 씁니다.
        title: "경험 요약입니다.",
      });
      expect(body.evidence.candidateSha).toBe(SHA);
      // 분석 축약본은 이제 이 요청에 실리지 않습니다. 저장은 앞선 요청이 이미 끝냈습니다.
      expect(body).not.toHaveProperty("analysis");
    });

    /**
     * 확정할 때마다 분석을 새로 저장하면 같은 분석이 여러 줄로 쌓이고 목록에 같은 저장소가 여러 번
     * 나옵니다. 한 분석에서 경험을 여러 개 골라도 저장은 한 번입니다.
     */
    it("두 번째 확정은 같은 분석 줄을 다시 쓴다", async () => {
      const createInterview = createdInterview();
      const saveAnalysis = await confirmExperience(createInterview);

      fireEvent.click(screen.getByRole("button", { name: "← Candidates" }));
      fireEvent.click(screen.getByRole("button", { name: "Back to candidates" }));
      fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));

      await waitFor(() => expect(createInterview).toHaveBeenCalledTimes(2));
      expect(createInterview.mock.calls[1][0].analysisId).toBe("a1");
      expect(saveAnalysis).toHaveBeenCalledTimes(1);
    });

    /**
     * 분석 저장이 실패하면 인터뷰를 붙일 자리가 없습니다. 확정 시점에 한 번 더 시도하지 않으면 그
     * 대화는 저장 대상이 없는 채로 진행되고 사용자는 나중에 아무것도 찾지 못합니다.
     */
    it("분석 저장이 실패했으면 확정 시점에 다시 저장한다", async () => {
      const createInterview = createdInterview();
      const saveAnalysis = vi
        .fn<typeof saveRepositoryAnalysis>()
        .mockRejectedValueOnce(new Error("저장 실패"))
        .mockResolvedValue("a2");

      await confirmExperience(createInterview, saveAnalysis);

      expect(saveAnalysis).toHaveBeenCalledTimes(2);
      expect(createInterview.mock.calls[0][0].analysisId).toBe("a2");
    });

    /** 가리킨 분석이 지워졌거나 남의 것이면 route가 `not_found`로 답합니다. */
    it("분석이 사라졌으면 다시 저장해 한 번만 더 붙인다", async () => {
      const createInterview = vi
        .fn<typeof createSavedInterview>()
        .mockRejectedValueOnce(new SavedInterviewFetchError("not_found", "없습니다"))
        .mockResolvedValue({ interviewId: "i2", analysisId: "a2" });
      const saveAnalysis = vi
        .fn<typeof saveRepositoryAnalysis>()
        .mockResolvedValueOnce("a1")
        .mockResolvedValue("a2");

      await confirmExperience(createInterview, saveAnalysis);

      await waitFor(() => expect(createInterview).toHaveBeenCalledTimes(2));
      expect(createInterview.mock.calls[1][0].analysisId).toBe("a2");
      expect(saveAnalysis).toHaveBeenCalledTimes(2);
    });

    /** 연결이 잠시 끊긴 경우입니다. 분석을 다시 저장하지 않고 같은 줄에 한 번 더 붙입니다(backlog 10번). */
    it("줄 만들기가 한 번 실패하면 같은 분석에 다시 시도한다", async () => {
      const createInterview = vi
        .fn<typeof createSavedInterview>()
        .mockRejectedValueOnce(new SavedInterviewFetchError("network", "끊겼습니다"))
        .mockResolvedValue({ interviewId: "i2", analysisId: "a1" });
      const saveAnalysis = savedAnalysis();

      await confirmExperience(createInterview, saveAnalysis);

      await waitFor(() => expect(createInterview).toHaveBeenCalledTimes(2));
      expect(createInterview.mock.calls[1][0].analysisId).toBe("a1");
      expect(saveAnalysis).toHaveBeenCalledTimes(1);
    });

    /** 두 번째도 실패하면 저장 계층이 응답하지 않는 것이므로 같은 요청을 계속 보내지 않습니다. */
    it("다시 붙이기도 실패하면 더 시도하지 않는다", async () => {
      const createInterview = vi
        .fn<typeof createSavedInterview>()
        .mockRejectedValue(new SavedInterviewFetchError("not_found", "없습니다"));

      await confirmExperience(createInterview);

      await waitFor(() => expect(createInterview).toHaveBeenCalledTimes(2));
      expect(createInterview).toHaveBeenCalledTimes(2);
    });

    // 저장 실패가 진행 중인 인터뷰를 중단시키지 않아야 합니다(이슈 Constraint).
    it("저장에 실패해도 인터뷰 화면은 그대로 열린다", async () => {
      const createInterview = vi.fn<typeof createSavedInterview>().mockRejectedValue(new Error("저장 실패"));

      await confirmExperience(createInterview);

      expect(await screen.findByRole("heading", { level: 2, name: "스트리밍 렌더링 최적화" })).toBeInTheDocument();
    });

    /** 분석 저장까지 실패한 경우입니다. 저장할 자리가 없어도 대화는 시작돼야 합니다. */
    it("분석 저장이 계속 실패해도 인터뷰 화면은 열린다", async () => {
      const createInterview = createdInterview();
      const saveAnalysis = vi.fn<typeof saveRepositoryAnalysis>().mockRejectedValue(new Error("저장 실패"));

      await renderAnalyzed(createInterview, saveAnalysis);
      fireEvent.click(screen.getByRole("button", { name: /Start interview/ }));

      expect(await screen.findByRole("heading", { level: 2, name: "스트리밍 렌더링 최적화" })).toBeInTheDocument();
      expect(createInterview).not.toHaveBeenCalled();
    });
  });

  it("상세 링크는 분석한 Repository를 가리킨다", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mockState({
      status: "success",
      data: RETRY_POINT.data,
      candidates: {
        candidates: [{ sha, relatedShas: [], summary: "경험 요약입니다.", evidence: "근거입니다.", technicalTopics: [], citedFilePaths: [], source: "automatic_recommendation" }],
        insufficientCandidatesReason: "하나뿐입니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();

    // master-detail(#97)부터 이 후보 하나뿐이면 처음부터 선택돼 있어 클릭이 필요 없습니다.
    expect(screen.getByRole("link", { name: "Commit not indexed · aaaaaaa" })).toHaveAttribute(
      "href",
      `https://github.com/octocat/hello-world/commit/${sha}`
    );
  });

  it("후보가 3개이면 부족 사유 안내 없이 후보 목록을 표시한다", async () => {
    const candidate = { relatedShas: [], summary: "경험 요약입니다.", evidence: "근거입니다.", technicalTopics: [], citedFilePaths: [], source: "automatic_recommendation" } as const;
    mockState({
      status: "success",
      data: RETRY_POINT.data,
      candidates: {
        candidates: [
          { ...candidate, sha: "sha-a-40" },
          { ...candidate, sha: "sha-b-40" },
          { ...candidate, sha: "sha-c-40" },
        ],
        insufficientCandidatesReason: null,
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();

    expect(screen.getByText("3 experiences found")).toBeInTheDocument();
    expect(screen.queryByText(/Why there are not more candidates/)).not.toBeInTheDocument();
  });

  it.each([
    [{ kind: "llm_call_failure", title: "LLM 호출에 실패했습니다", message: "잠시 후", recovery: "retry" }],
    [{ kind: "llm_schema_violation", title: "LLM 응답이 출력 계약을 지키지 않았습니다", message: "버림", recovery: "retry" }],
    [{ kind: "llm_hallucination_rejected", title: "실제 Repository 근거와 맞지 않는 판단을 거부했습니다", message: "버림", recovery: "retry" }],
  ] as AnalysisError[][])("후보 생성 오류 %s에 후보 생성 재시도 버튼을 표시한다", async (error) => {
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    expect(screen.getByRole("alert")).toHaveTextContent(error.message);
    expect(screen.getByRole("button", { name: "Retry candidate generation" })).toBeInTheDocument();
  });

  it("retryPoint가 있는 오류의 재시도는 전체 재조회 대신 실패한 단계부터 다시 시작한다", async () => {
    const error: AnalysisError = { kind: "llm_call_failure", title: "실패", message: "재시도", recovery: "retry" };
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: "Retry candidate generation" }));

    await waitFor(() => expect(generateMock).toHaveBeenCalledWith(RETRY_POINT, expect.any(Function)));
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it("diff 재조회 실패는 원인에 맞는 복구 동작을 표시한다", async () => {
    const error: AnalysisError = {
      kind: "diff_refetch_failure",
      causeKind: "auth_revoked",
      title: "후보의 diff·PR 근거를 다시 조회하지 못했습니다",
      message: "인증을 다시 진행해 주세요.",
      recovery: "reauthenticate",
    };
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    expect(screen.getByRole("alert")).toHaveTextContent(error.message);
    expect(screen.getByRole("button", { name: "Log in to GitHub again" })).toBeInTheDocument();
  });

  it("요청 크기 초과는 Repository 재선택으로 복구한다", async () => {
    const error: AnalysisError = {
      kind: "request_too_large",
      title: "분석 데이터가 요청 한도를 초과했습니다",
      message: "더 작은 Repository를 선택해 주세요.",
      recovery: "select_repository",
    };
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    expect(screen.getByRole("button", { name: "Choose a different repository" })).toBeInTheDocument();
  });

  it("계약 위반 오류는 retryPoint 없이 전체 조회 재시도로 처음부터 입력을 다시 구성한다", async () => {
    const error: AnalysisError = {
      kind: "contract_violation",
      title: "후보 생성 요청이 서버 계약과 맞지 않았습니다",
      message: "같은 입력을 그대로 다시 보내지 않고 Repository 조회부터 다시 구성해 재시도합니다.",
      recovery: "retry",
    };
    mockState({ status: "error", error });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: "Retry full analysis" }));

    await waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(2));
    expect(generateMock).not.toHaveBeenCalled();
  });

  it("인증 재진행 후에는 retryPoint를 버리고 다시 로그인을 요구한다", async () => {
    const error: AnalysisError = {
      kind: "diff_refetch_failure",
      causeKind: "auth_revoked",
      title: "후보의 diff·PR 근거를 다시 조회하지 못했습니다",
      message: "인증을 다시 진행해 주세요.",
      recovery: "reauthenticate",
    };
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: "Log in to GitHub again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

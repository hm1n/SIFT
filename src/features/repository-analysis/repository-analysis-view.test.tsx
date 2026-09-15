// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { WorkUnit } from "@/features/experience-candidates/work-unit";
import type { ExcludedWorkUnit } from "@/features/experience-candidates/work-unit-selection";
import type { ReadonlyCommitDetail } from "@/lib/github/types";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import {
  analyzeRepository,
  generateCandidates,
  type AnalysisError,
  type AnalysisState,
  type CandidateRetryPoint,
  type StageASelectionState,
} from "./repository-analysis";
import type { createSavedInterview } from "@/features/saved-interviews/client";
import { RepositoryAnalysisView } from "./repository-analysis-view";


function commit(sha: string, title: string): ReadonlyCommitDetail {
  return {
    sha, title, author: "octocat", date: "2026-08-24T00:00:00Z", parentCount: 1,
    message: title, additions: 1, deletions: 0, changedFiles: 1, files: [], pullRequests: [],
  };
}

/** 점수 컷에서 밀린 PR 묶음 하나입니다. 화면 배선만 확인하는 스위트라 세부 신호는 두지 않습니다. */
function excludedPullRequestUnit(number: number): ExcludedWorkUnit<ReadonlyCommitDetail> {
  const unit: WorkUnit<ReadonlyCommitDetail> = {
    kind: "pull_request",
    unitId: `pr:${number}`,
    title: "잡무 PR",
    pullRequest: { number, title: "잡무 PR", state: "closed", baseBranch: "develop", headBranch: "f" },
    commits: [commit(`sha-${number}`, "잡무 PR")],
  };
  return { unit, score: 1, reason: "over_input_budget", signals: [] };
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

/** Repository와 기여 항목은 선택 화면이 prop으로 넘기고, 화면은 마운트되자마자 분석을 시작합니다. */
function renderView(contributionItems: readonly string[] = []) {
  return render(
    <RepositoryAnalysisView repository={REPOSITORY} contributionItems={contributionItems} onSelectRepository={onSelectRepository} />
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
    expect(screen.getAllByText("완료:")).toHaveLength(3);
    expect(screen.getByText("진행 중:")).toBeInTheDocument();
    expect(screen.getAllByText("대기:")).toHaveLength(2);
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

  it("Repository 변경를 누르면 onSelectRepository를 부른다", async () => {
    mockState({ status: "loading", loading: { step: "commits" } });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "← Repository 변경" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });
});

describe("RepositoryAnalysisView Empty", () => {
  it.each([
    ["no_commits", "기본 브랜치에 커밋이 없습니다."],
    ["no_author_commits", "로그인한 GitHub 계정으로 작성한 커밋이 없습니다."],
    ["no_analyzable_commits", "분석할 커밋이 남지 않았습니다."],
    ["no_stage_a_candidates", "설명할 가치가 있는 경험 후보를 찾지 못했습니다."],
  ] as const)("%s를 별도 안내로 표시한다", async (kind, label) => {
    mockState({ status: "empty", kind });
    await renderAndAnalyze();
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다른 Repository 선택" })).toBeInTheDocument();
  });

  it("다른 Repository 선택은 세션을 지우지 않고 onSelectRepository를 부른다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "다른 Repository 선택" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
    expect(routerMock.refresh).not.toHaveBeenCalled();
  });
});

// 이슈 #58 Codex 리뷰 P1-2: 후보 0개 빈 상태가 Stage A 제외 정보를 버리면 기능의 목적이 무너집니다.
// 성공 상태와 같은 StageAExclusions를 재사용하므로 여기서는 배선(빈 상태에서도 렌더되는지, 빈 값이면
// 렌더하지 않는지, Stage A 전 빈 상태는 영향받지 않는지)만 확인합니다. 세부 렌더 규칙(정렬·구획 분리
// 등)은 experience-candidate-list.test.tsx가 이미 검증합니다.
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

    expect(screen.getByRole("heading", { name: "1차 선별에서 제외됨" })).toBeInTheDocument();
    expect(screen.getByText("Repository가 커서 전체 작업 묶음 1개 가운데 0개만 판단했습니다")).toBeInTheDocument();
  });

  it("제외 0건이면 제외 섹션이 렌더되지 않는다", async () => {
    mockState({ status: "empty", kind: "no_stage_a_candidates", stageASelection: EMPTY_STAGE_A_SELECTION });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외됨" })).not.toBeInTheDocument();
  });

  it("Stage A 전에 나는 빈 상태는 stageASelection이 없어도 지금과 똑같이 동작한다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외됨" })).not.toBeInTheDocument();
    expect(screen.getByText("기본 브랜치에 커밋이 없습니다.")).toBeInTheDocument();
  });

  it("unjudgedShas가 있으면 no_final_candidates에서도 판단 불가 표시가 보인다", async () => {
    mockState({
      status: "empty",
      kind: "no_final_candidates",
      reason: "실제 diff 근거로 설명할 수 있는 커밋이 없습니다.",
      stageASelection: { ...EMPTY_STAGE_A_SELECTION, unjudgedShas: ["deadbeef00112233"] },
    });
    await renderAndAnalyze();

    expect(screen.getByText("모델이 판단하지 않은 1 work unit")).toBeInTheDocument();
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

    const label = screen.getByText("설명할 가치가 있는 경험 후보를 찾지 못했습니다.");
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

    const summaryText = "Repository가 커서 전체 작업 묶음 1개 가운데 0개만 판단했습니다";
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
    [{ kind: "rate_limit", title: "호출 한도", message: "잠시 후 재시도", recovery: "retry" }, "분석 전체 다시 시도"],
    [{ kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" }, "GitHub에 다시 로그인"],
    [{ kind: "repo_not_found", title: "미존재", message: "이름 확인", recovery: "select_repository" }, "다른 Repository 선택"],
    [{ kind: "partial_failure", causeKind: "rate_limit", title: "일부 실패", message: "3개 중 1개 수집", recovery: "retry", completed: 1, total: 3 }, "분석 전체 다시 시도"],
    [{ kind: "network", title: "네트워크 실패", message: "연결 확인", recovery: "retry" }, "분석 전체 다시 시도"],
    [{ kind: "server_error", title: "서버 실패", message: "잠시 후", recovery: "retry" }, "분석 전체 다시 시도"],
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
    fireEvent.click(screen.getByRole("button", { name: "분석 전체 다시 시도" }));
    await waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(2));
    expect(analyzeMock.mock.calls[1][0]).toEqual(REPOSITORY_REF);
    expect(analyzeMock.mock.calls[1][1]).toEqual(["푸시 알림 구현"]);
  });

  it("Repository 다시 선택은 onSelectRepository를 부른다", async () => {
    mockState({ status: "error", error: { kind: "repo_not_found", title: "미존재", message: "이름 확인", recovery: "select_repository" } });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "다른 Repository 선택" }));
    expect(onSelectRepository).toHaveBeenCalledTimes(1);
  });

  it("인증 재진행을 선택하면 세션을 삭제하고 라우터를 갱신해 헤더와 화면이 함께 로그인 전 상태가 된다", async () => {
    const error: AnalysisError = { kind: "auth_revoked", title: "인증 취소", message: "인증 필요", recovery: "reauthenticate" };
    mockState({ status: "error", error });
    await renderAndAnalyze();
    fireEvent.click(screen.getByRole("button", { name: "GitHub에 다시 로그인" }));
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
    fireEvent.click(screen.getByRole("button", { name: "GitHub에 다시 로그인" }));
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
    fireEvent.click(screen.getByRole("button", { name: "GitHub에 다시 로그인" }));
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

    expect(screen.getByText("최종 경험 후보를 만들지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/실제 diff 근거로 설명할 수 있는 커밋이 없습니다/)).toBeInTheDocument();
    expect(screen.getByText(/기준을 낮추거나 후보를 임의로 채우지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "다른 Repository 선택" })).toBeInTheDocument();
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

    expect(screen.getByText("2 experiences 발견")).toBeInTheDocument();
    expect(screen.getByText(/나머지 커밋은 diff 근거가 부족합니다/)).toBeInTheDocument();
    expect(screen.getByText(/기준을 낮추거나 후보를 임의로 채우지 않습니다/)).toBeInTheDocument();
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
        data: { allCommits: [], includedCommits: [detail], repository: { fileTree: [], treeTruncated: false, languages: {} } },
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

    async function confirmExperience(createInterview: Mock<typeof createSavedInterview>) {
      mockState(successStateWithEvidence());
      render(
        <RepositoryAnalysisView
          repository={REPOSITORY}
          contributionItems={["성능 개선"]}
          onSelectRepository={onSelectRepository}
          createInterview={createInterview}
        />
      );
      await waitFor(() => expect(analyzeMock).toHaveBeenCalled());
      fireEvent.click(screen.getByRole("button", { name: /인터뷰 시작/ }));
      await waitFor(() => expect(createInterview).toHaveBeenCalled());
    }

    it("확정하면 분석 축약본과 후보와 근거를 함께 보낸다", async () => {
      const createInterview = vi.fn<typeof createSavedInterview>().mockResolvedValue({ interviewId: "i1", analysisId: "a1" });

      await confirmExperience(createInterview);

      const body = createInterview.mock.calls[0][0];
      expect(body).toMatchObject({
        candidateKey: SHA,
        // 목록 화면이 그 후보에 붙인 제목 그대로입니다. 저장된 목록과 후보 목록이 같은 이름을 씁니다.
        title: "경험 요약입니다.",
        analysis: { repoOwner: "octocat", repoName: "hello-world", contributionItems: ["성능 개선"] },
      });
      expect(body.evidence.candidateSha).toBe(SHA);
      // 첫 확정에는 다시 쓸 분석 줄이 없습니다.
      expect(body).not.toHaveProperty("analysisId");
    });

    /**
     * 확정할 때마다 분석을 새로 저장하면 같은 분석이 여러 줄로 쌓이고 목록에 같은 저장소가 여러 번
     * 나옵니다. 앞선 확정이 돌려준 식별자를 다시 씁니다.
     */
    it("두 번째 확정은 앞서 저장한 분석 줄을 다시 쓴다", async () => {
      const createInterview = vi.fn<typeof createSavedInterview>().mockResolvedValue({ interviewId: "i1", analysisId: "a1" });
      await confirmExperience(createInterview);

      fireEvent.click(screen.getByRole("button", { name: "← 뒤로" }));
      fireEvent.click(screen.getByRole("button", { name: "후보 목록으로" }));
      fireEvent.click(screen.getByRole("button", { name: /인터뷰 시작/ }));

      await waitFor(() => expect(createInterview).toHaveBeenCalledTimes(2));
      expect(createInterview.mock.calls[1][0].analysisId).toBe("a1");
    });

    // 저장 실패가 진행 중인 인터뷰를 중단시키지 않아야 합니다(이슈 Constraint).
    it("저장에 실패해도 인터뷰 화면은 그대로 열린다", async () => {
      const createInterview = vi.fn<typeof createSavedInterview>().mockRejectedValue(new Error("저장 실패"));

      await confirmExperience(createInterview);

      expect(await screen.findByRole("heading", { level: 2, name: "스트리밍 렌더링 최적화" })).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "색인되지 않은 커밋 · aaaaaaa" })).toHaveAttribute(
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

    expect(screen.getByText("3 experiences 발견")).toBeInTheDocument();
    expect(screen.queryByText(/후보가 더 없는 이유/)).not.toBeInTheDocument();
  });

  it.each([
    [{ kind: "llm_call_failure", title: "AI 호출에 실패했습니다", message: "잠시 후", recovery: "retry" }],
    [{ kind: "llm_schema_violation", title: "LLM 응답이 출력 계약을 지키지 않았습니다", message: "버림", recovery: "retry" }],
    [{ kind: "llm_hallucination_rejected", title: "실제 Repository 근거와 맞지 않는 판단을 거부했습니다", message: "버림", recovery: "retry" }],
  ] as AnalysisError[][])("후보 생성 오류 %s에 후보 생성 재시도 버튼을 표시한다", async (error) => {
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    expect(screen.getByRole("alert")).toHaveTextContent(error.message);
    expect(screen.getByRole("button", { name: "후보 생성 다시 시도" })).toBeInTheDocument();
  });

  it("retryPoint가 있는 오류의 재시도는 전체 재조회 대신 실패한 단계부터 다시 시작한다", async () => {
    const error: AnalysisError = { kind: "llm_call_failure", title: "실패", message: "재시도", recovery: "retry" };
    mockState({ status: "error", error, retryPoint: RETRY_POINT });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: "후보 생성 다시 시도" }));

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
    expect(screen.getByRole("button", { name: "GitHub에 다시 로그인" })).toBeInTheDocument();
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

    expect(screen.getByRole("button", { name: "다른 Repository 선택" })).toBeInTheDocument();
  });

  it("계약 위반 오류는 retryPoint 없이 전체 조회 재시도로 처음부터 입력을 다시 구성한다", async () => {
    const error: AnalysisError = {
      kind: "contract_violation",
      title: "후보 생성 요청을 처리할 수 없습니다",
      message: "같은 입력을 그대로 다시 보내지 않고 Repository 조회부터 다시 구성해 재시도합니다.",
      recovery: "retry",
    };
    mockState({ status: "error", error });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: "분석 전체 다시 시도" }));

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

    fireEvent.click(screen.getByRole("button", { name: "GitHub에 다시 로그인" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(generateMock).not.toHaveBeenCalled();
  });
});

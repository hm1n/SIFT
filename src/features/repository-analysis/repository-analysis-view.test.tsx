// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExcludedCommit } from "@/features/experience-candidates/work-unit";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import {
  analyzeRepository,
  generateCandidates,
  type AnalysisError,
  type AnalysisState,
  type CandidateRetryPoint,
  type StageASelectionState,
} from "./repository-analysis";
import { RepositoryAnalysisView } from "./repository-analysis-view";


const excludedCommit = (sha: string, title: string): ExcludedCommit => ({ sha, title, reason: "no_pull_request" });

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
  excludedCommits: [],
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
        candidates: [{ sha: "sha-a-40", relatedShas: [], evidence: "근거입니다.", citedFilePaths: [], source: "automatic_recommendation" }],
        insufficientCandidatesReason: "하나뿐입니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { level: 1, name: "octocat / hello-world" }));
    expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
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
describe("RepositoryAnalysisView Empty의 Stage A 제외 표시", () => {
  it("no_stage_a_candidates에서도 제외 요약이 화면에 보인다", async () => {
    mockState({
      status: "empty",
      kind: "no_stage_a_candidates",
      stageASelection: {
        excludedCommits: [excludedCommit("abcdef1234567", "잡무 커밋")],
        excludedUnits: [],
        thresholdScore: 3,
        selectedUnitCount: 0,
        unjudgedShas: [],
      },
    });
    await renderAndAnalyze();

    expect(screen.getByRole("heading", { name: "1차 선별에서 제외된 항목" })).toBeInTheDocument();
    expect(screen.getByText("Pull Request에 속하지 않아 제외한 커밋 1건")).toBeInTheDocument();
  });

  it("제외 0건이면 제외 섹션이 렌더되지 않는다", async () => {
    mockState({ status: "empty", kind: "no_stage_a_candidates", stageASelection: EMPTY_STAGE_A_SELECTION });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외된 항목" })).not.toBeInTheDocument();
  });

  it("Stage A 전에 나는 빈 상태는 stageASelection이 없어도 지금과 똑같이 동작한다", async () => {
    mockState({ status: "empty", kind: "no_commits" });
    await renderAndAnalyze();

    expect(screen.queryByRole("heading", { name: "1차 선별에서 제외된 항목" })).not.toBeInTheDocument();
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

    expect(screen.getByText("모델이 판단하지 못한 묶음 1건")).toBeInTheDocument();
    expect(screen.getByText("deadbee")).toBeInTheDocument();
  });

  it("빈 상태 섹션의 aria-live=\"polite\"를 유지한다", async () => {
    mockState({
      status: "empty",
      kind: "no_stage_a_candidates",
      stageASelection: {
        excludedCommits: [excludedCommit("abcdef1234567", "잡무 커밋")],
        excludedUnits: [],
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
        excludedCommits: [excludedCommit("abcdef1234567", "잡무 커밋")],
        excludedUnits: [],
        thresholdScore: 3,
        selectedUnitCount: 0,
        unjudgedShas: [],
      },
    });
    await renderAndAnalyze();

    const details = screen.getByText("Pull Request에 속하지 않아 제외한 커밋 1건").closest("details");
    expect(details).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Pull Request에 속하지 않아 제외한 커밋 1건"));
    expect(details).toHaveAttribute("open");
    fireEvent.click(screen.getByText("Pull Request에 속하지 않아 제외한 커밋 1건"));
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
          { sha: "a1b2c3d4e5", relatedShas: [], evidence: "상태 머신을 구현했습니다.", citedFilePaths: [], source: "contribution_match" },
          { sha: "f6e5d4c3b2", relatedShas: [], evidence: "오류 계약을 정의했습니다.", citedFilePaths: [], source: "automatic_recommendation" },
        ],
        insufficientCandidatesReason: "나머지 커밋은 diff 근거가 부족합니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();

    expect(screen.getByText(/경험 후보 2개를 선정했습니다/)).toBeInTheDocument();
    expect(screen.getByText(/나머지 커밋은 diff 근거가 부족합니다/)).toBeInTheDocument();
    expect(screen.getByText(/기준을 완화하거나 후보를\s*임의로 채우지 않습니다/)).toBeInTheDocument();
    expect(screen.getByText("기여 항목 일치")).toBeInTheDocument();
    expect(screen.getByText("자동 추천")).toBeInTheDocument();
    expect(screen.getByText("상태 머신을 구현했습니다.")).toBeInTheDocument();
  });

  it("상세 링크는 분석한 Repository를 가리킨다", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    mockState({
      status: "success",
      data: RETRY_POINT.data,
      candidates: {
        candidates: [{ sha, relatedShas: [], evidence: "근거입니다.", citedFilePaths: [], source: "automatic_recommendation" }],
        insufficientCandidatesReason: "하나뿐입니다.",
        diffs: [],
      },
      stageASelection: EMPTY_STAGE_A_SELECTION,
    });
    await renderAndAnalyze();

    fireEvent.click(screen.getByRole("button", { name: /커밋 색인 실패 · aaaaaaa/ }));

    expect(screen.getByRole("link", { name: "대표 커밋 aaaaaaa" })).toHaveAttribute(
      "href",
      `https://github.com/octocat/hello-world/commit/${sha}`
    );
  });

  it("후보가 3개이면 부족 사유 안내 없이 후보 목록을 표시한다", async () => {
    const candidate = { relatedShas: [], evidence: "근거입니다.", citedFilePaths: [], source: "automatic_recommendation" } as const;
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

    expect(screen.getByText(/경험 후보 3개를 선정했습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/후보를 3개 채우지 않은 이유/)).not.toBeInTheDocument();
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
      kind: "server_error",
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

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import { GitHubFetchError } from "@/lib/github/errors";
import type { RepositorySummary } from "@/lib/github/types";
import { RepositorySelectScreen } from "./repository-select-screen";

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const NOW = Date.parse("2026-09-11T12:00:00Z");

const REPOSITORIES: RepositorySummary[] = [
  { id: 1, owner: "andbread", name: "Andbread_Frontend", visibility: "public", language: "TypeScript", pushedAt: "2026-09-09T10:00:00Z" },
  { id: 2, owner: "shinhm1", name: "Kori_Front_MVP2", visibility: "private", language: "TypeScript", pushedAt: "2026-09-05T10:00:00Z" },
  { id: 3, owner: "shinhm1", name: "portfolio", visibility: "public", language: null, pushedAt: "2026-09-11T08:00:00Z" },
];

function renderScreen(fetchRepositories: () => Promise<RepositorySummary[]>, onAnalyze = vi.fn()) {
  const view = render(<RepositorySelectScreen onAnalyze={onAnalyze} fetchRepositories={fetchRepositories} now={() => NOW} />);
  return { ...view, onAnalyze };
}

async function renderReady(repositories = REPOSITORIES, onAnalyze = vi.fn()) {
  const view = renderScreen(() => Promise.resolve(repositories), onAnalyze);
  await screen.findByRole("heading", { name: "Choose a repository to analyze." });
  return view;
}

beforeEach(() => {
  routerMock.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RepositorySelectScreen 상태", () => {
  it("조회 중에는 LOADING REPOSITORIES 상태만 그린다", () => {
    renderScreen(() => new Promise(() => {}));
    expect(screen.getByRole("status")).toHaveAttribute("data-status-kind", "loading");
    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
    expect(screen.queryByRole("heading", { name: "Choose a repository to analyze." })).not.toBeInTheDocument();
  });

  it("Repository가 없으면 NO REPOSITORIES 상태를 그리고 목록 카드를 그리지 않는다", async () => {
    renderScreen(() => Promise.resolve([]));
    const status = await screen.findByRole("status");
    expect(status).toHaveAttribute("data-status-kind", "empty");
    expect(status).toHaveTextContent("No repositories available for analysis.");
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it.each([
    ["rate_limit", "GitHub rate limit reached."],
    ["network", "We couldn't reach the server."],
    ["server_error", "GitHub returned an error."],
  ] as const)("%s 실패는 ERROR / GITHUB와 Try again을 그린다", async (kind, sub) => {
    renderScreen(() => Promise.reject(new GitHubFetchError(kind, "실패")));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ERROR / GITHUB");
    expect(alert).toHaveTextContent("Unable to load repositories.");
    expect(alert).toHaveTextContent(sub);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("Try again은 목록을 다시 조회하고 성공하면 목록을 그린다", async () => {
    const fetchRepositories = vi.fn()
      .mockRejectedValueOnce(new GitHubFetchError("network", "실패"))
      .mockResolvedValueOnce(REPOSITORIES);
    renderScreen(fetchRepositories);
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
    await screen.findByRole("heading", { name: "Choose a repository to analyze." });
    expect(fetchRepositories).toHaveBeenCalledTimes(2);
  });

  it("GitHubFetchError가 아닌 실패도 서버 오류 안내로 그린다", async () => {
    renderScreen(() => Promise.reject(new Error("unexpected")));
    expect(await screen.findByRole("alert")).toHaveTextContent("GitHub returned an error.");
  });

  // 인증 취소는 다시 조회해도 풀리지 않습니다. 로그인 화면과 같은 ERROR / AUTH 형식으로 다시 로그인을 안내합니다.
  it("auth_revoked는 ERROR / AUTH를 그리고 다시 로그인이 세션을 지운 뒤 라우터를 갱신한다", async () => {
    renderScreen(() => Promise.reject(new GitHubFetchError("auth_revoked", "만료")));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("ERROR / AUTH");
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Log in again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith(SESSION_PATH, { method: "DELETE" });
  });

  it("세션 삭제 요청이 실패해도 라우터를 갱신한다", async () => {
    renderScreen(() => Promise.reject(new GitHubFetchError("auth_revoked", "만료")));
    await screen.findByRole("alert");
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Log in again" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
  });
});

describe("RepositorySelectScreen 목록", () => {
  it("헤더, 전체 개수, owner / name, language, PRIVATE, UPDATED 라벨을 그린다", async () => {
    await renderReady();

    expect(screen.getByText("Select Repository")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    const rows = screen.getAllByRole("radio");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent("andbread / Andbread_Frontend");
    expect(rows[0]).toHaveTextContent("TypeScript");
    expect(rows[0]).not.toHaveTextContent("PRIVATE");
    expect(rows[0]).toHaveTextContent("UPDATED 2D AGO");
    expect(rows[1]).toHaveTextContent("TypeScript · PRIVATE");
    expect(rows[1]).toHaveTextContent("UPDATED 6D AGO");
    expect(rows[2]).not.toHaveTextContent("TypeScript");
    expect(rows[2]).toHaveTextContent("UPDATED TODAY");
  });

  it("검색은 name과 owner를 대소문자 구분 없이 거르고 전체 개수는 그대로 둔다", async () => {
    await renderReady();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search repositories" }), { target: { value: "SHINHM" } });

    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search repositories" }), { target: { value: "portfolio" } });
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("검색 결과가 없으면 카드 안에 안내를 그리고 화면은 유지한다", async () => {
    await renderReady();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search repositories" }), { target: { value: "nothing-here" } });

    expect(screen.getByText("No repositories match your search.")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Choose a repository to analyze." })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("검색으로 가려진 선택은 유지되어 하단 바와 Analyze에 그대로 반영된다", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("radio", { name: /Kori_Front_MVP2/ }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search repositories" }), { target: { value: "portfolio" } });

    expect(screen.getByText("shinhm1 / Kori_Front_MVP2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze/ })).toBeEnabled();
  });
});

describe("RepositorySelectScreen 선택과 Analyze", () => {
  it("선택 전에는 No repository selected와 disabled Analyze를 그린다", async () => {
    await renderReady();
    expect(screen.getByText("No repository selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze/ })).toBeDisabled();
    expect(screen.getAllByRole("radio").every((row) => row.getAttribute("aria-checked") === "false")).toBe(true);
  });

  it("행을 누르면 그 행만 선택되고 하단 바가 owner / name을 보여준다", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("radio", { name: /Andbread_Frontend/ }));
    fireEvent.click(screen.getByRole("radio", { name: /Kori_Front_MVP2/ }));

    expect(screen.getByRole("radio", { name: /Kori_Front_MVP2/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: /Andbread_Frontend/ })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("shinhm1 / Kori_Front_MVP2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Analyze/ })).toBeEnabled();
  });

  it("Analyze는 선택한 Repository와 줄 단위 기여 항목을 넘긴다", async () => {
    const { onAnalyze } = await renderReady();
    fireEvent.click(screen.getByRole("radio", { name: /Kori_Front_MVP2/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Your Contribution" }), { target: { value: "푸시 알림 구현\n\n게시판 기능 구현  " } });
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    expect(onAnalyze).toHaveBeenCalledWith(REPOSITORIES[1], ["푸시 알림 구현", "게시판 기능 구현"]);
  });

  it("기여 항목은 선택 사항이라 비워도 Analyze가 빈 배열로 진행한다", async () => {
    const { onAnalyze } = await renderReady();
    fireEvent.click(screen.getByRole("radio", { name: /portfolio/ }));
    fireEvent.click(screen.getByRole("button", { name: /Analyze/ }));

    expect(onAnalyze).toHaveBeenCalledWith(REPOSITORIES[2], []);
  });

  it("기여 항목 섹션은 라벨, OPTIONAL, 한국어 안내와 placeholder를 갖고 목록 카드 밖에 있다", async () => {
    await renderReady();
    const textarea = screen.getByRole("textbox", { name: "Your Contribution" });
    expect(textarea).toHaveAttribute("placeholder", "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다.");
    expect(textarea).toHaveAccessibleDescription("프로젝트에서 주로 기여한 내용을 알려주세요.");
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup").contains(textarea)).toBe(false);
  });
});

// PR #102 Codex 재검증 P2. role="radio" 버튼만 있고 방향키 처리와 roving tabindex가 없어 모든 행이
// Tab 순서에 남고 방향키로는 선택이 바뀌지 않았습니다. 표준 라디오 그룹 키보드 패턴을 추가합니다.
describe("RepositorySelectScreen 라디오 그룹 키보드 동작", () => {
  it("선택 전에는 첫 행만 tab 순서에 남고 나머지는 tabIndex -1이다", async () => {
    await renderReady();
    const rows = screen.getAllByRole("radio");
    expect(rows[0]).toHaveAttribute("tabIndex", "0");
    expect(rows.slice(1).every((row) => row.getAttribute("tabIndex") === "-1")).toBe(true);
  });

  it("선택하면 선택된 행만 tab 순서에 남는다", async () => {
    await renderReady();
    fireEvent.click(screen.getByRole("radio", { name: /Kori_Front_MVP2/ }));
    const rows = screen.getAllByRole("radio");
    expect(screen.getByRole("radio", { name: /Kori_Front_MVP2/ })).toHaveAttribute("tabIndex", "0");
    expect(rows.filter((row) => row !== screen.getByRole("radio", { name: /Kori_Front_MVP2/ })).every((row) => row.getAttribute("tabIndex") === "-1")).toBe(true);
  });

  it("ArrowDown은 다음 행을 선택하고 그 행에 DOM 포커스를 옮긴다", async () => {
    await renderReady();
    const first = screen.getByRole("radio", { name: /Andbread_Frontend/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown" });

    const second = screen.getByRole("radio", { name: /Kori_Front_MVP2/ });
    expect(second).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(second);
  });

  it("ArrowUp은 이전 행을 선택하고, 첫 행에서는 마지막 행으로 순환한다", async () => {
    await renderReady();
    const first = screen.getByRole("radio", { name: /Andbread_Frontend/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowUp" });

    const last = screen.getByRole("radio", { name: /portfolio/ });
    expect(last).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(last);
  });

  it("ArrowRight와 ArrowLeft도 ArrowDown, ArrowUp과 같이 동작한다", async () => {
    await renderReady();
    const first = screen.getByRole("radio", { name: /Andbread_Frontend/ });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: /Kori_Front_MVP2/ })).toHaveAttribute("aria-checked", "true");

    fireEvent.keyDown(screen.getByRole("radio", { name: /Kori_Front_MVP2/ }), { key: "ArrowLeft" });
    expect(first).toHaveAttribute("aria-checked", "true");
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_PATH, SESSION_PATH } from "@/lib/github/auth-paths";
import { AuthTransitionProvider } from "./auth-transition";
import { TopHeader, type TopHeaderProps } from "./top-header";

const routerMock = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
});

/** 헤더는 layout의 `AuthTransitionProvider` 안에서만 그려집니다. */
function renderHeader(props: TopHeaderProps) {
  return render(<AuthTransitionProvider><TopHeader {...props} /></AuthTransitionProvider>);
}

/** jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다. React의 onClick은 그대로 실행됩니다. */
function clickLogin(init?: MouseEventInit) {
  const link = screen.getByRole("link", { name: "Log in with GitHub" });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
}

describe("TopHeader", () => {
  it("로그인 전에는 제품명과 GitHub 로그인 링크를 그린다", () => {
    renderHeader({ isAuthenticated: false });
    expect(screen.getByRole("banner")).toHaveTextContent("SIFT");
    expect(screen.getByRole("link", { name: "Log in with GitHub" })).toHaveAttribute("href", LOGIN_PATH);
    expect(screen.queryByRole("button", { name: /account/i })).not.toBeInTheDocument();
  });

  // PR #100 리뷰: 헤더 로그인도 로그인 화면 버튼과 같은 진입점이므로 인증 중 상태를 함께 보여야 합니다.
  it("헤더 로그인 링크를 누르면 브라우저가 이동하기 전까지 인증 중 표시로 바뀐다", () => {
    renderHeader({ isAuthenticated: false });
    clickLogin();
    const link = screen.getByRole("link", { name: "Connecting to GitHub…" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).toHaveAttribute("href", LOGIN_PATH);
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["가운데 버튼", { button: 1 }],
  ])("헤더 로그인의 %s 클릭은 새 탭으로 여는 것이므로 인증 중으로 바꾸지 않는다", (_name, init) => {
    renderHeader({ isAuthenticated: false });
    clickLogin(init);
    expect(screen.getByRole("link", { name: "Log in with GitHub" })).not.toHaveAttribute("aria-busy");
  });

  it("로그인 후에는 계정 메뉴를 그리고 Sign out이 세션을 지운 뒤 첫 화면으로 이동해 다시 그린다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    renderHeader({ isAuthenticated: true, fetchImpl });

    expect(screen.queryByRole("link", { name: "Log in with GitHub" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /account/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(fetchImpl).toHaveBeenCalledWith(SESSION_PATH, { method: "DELETE" });
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(routerMock.push).toHaveBeenCalledWith("/");
  });

  it("세션 삭제 요청이 실패해도 이동하고, 헤더가 남아 있으면 Sign out을 다시 누를 수 있다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network"));
    renderHeader({ isAuthenticated: true, fetchImpl });
    const trigger = screen.getByRole("button", { name: /account/i });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    // 쿠키가 남아 서버가 같은 헤더를 다시 그린 상황입니다. 메뉴가 닫히고 항목이 잠겨 있지 않아야 합니다.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Sign out" })).toBeEnabled();
  });

  it("Escape와 바깥 클릭으로 메뉴가 닫힌다", async () => {
    renderHeader({ isAuthenticated: true });
    const trigger = screen.getByRole("button", { name: /account/i });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

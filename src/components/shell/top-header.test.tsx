// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_PATH, SESSION_PATH, TopHeader } from "./top-header";

const routerMock = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
});

describe("TopHeader", () => {
  it("로그인 전에는 제품명과 GitHub 로그인 링크를 그린다", () => {
    render(<TopHeader isAuthenticated={false} />);
    expect(screen.getByRole("banner")).toHaveTextContent("SIFT");
    expect(screen.getByRole("link", { name: "Log in with GitHub" })).toHaveAttribute("href", LOGIN_PATH);
    expect(screen.queryByRole("button", { name: /account/i })).not.toBeInTheDocument();
  });

  it("로그인 후에는 계정 메뉴를 그리고 Sign out이 세션을 지운 뒤 이동한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    const onSignedOut = vi.fn();
    render(<TopHeader isAuthenticated={true} fetchImpl={fetchImpl} onSignedOut={onSignedOut} />);

    expect(screen.queryByRole("link", { name: "Log in with GitHub" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /account/i });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(fetchImpl).toHaveBeenCalledWith(SESSION_PATH, { method: "DELETE" });
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });

  it("세션 삭제 요청이 실패해도 로그아웃 이동은 진행한다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network"));
    const onSignedOut = vi.fn();
    render(<TopHeader isAuthenticated={true} fetchImpl={fetchImpl} onSignedOut={onSignedOut} />);
    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  });

  it("onSignedOut이 없으면 첫 화면으로 이동하고 서버 컴포넌트를 다시 그린다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    render(<TopHeader isAuthenticated={true} fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole("button", { name: /account/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(routerMock.push).toHaveBeenCalledWith("/");
  });

  it("Escape와 바깥 클릭으로 메뉴가 닫힌다", async () => {
    render(<TopHeader isAuthenticated={true} />);
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

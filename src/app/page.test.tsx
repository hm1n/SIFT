// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider } from "@/components/shell/auth-transition";
import { GITHUB_SESSION_COOKIE } from "@/lib/github/auth-session";
import Home from "./page";

/** 서버가 읽는 쿠키입니다. 테스트가 세션 유무를 여기로 정합니다. */
const cookieNames = new Set<string>();
vi.mock("next/headers", () => ({ cookies: async () => ({ has: (name: string) => cookieNames.has(name) }) }));

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

/** layout이 감싸는 provider를 함께 둡니다. 로그인 화면은 provider 밖에서 그릴 수 없습니다. */
async function renderHome(searchParams: { auth_error?: string | string[] } = {}) {
  return <AuthTransitionProvider>{await Home({ searchParams: Promise.resolve(searchParams) })}</AuthTransitionProvider>;
}

beforeEach(() => cookieNames.clear());
afterEach(cleanup);

describe("Home", () => {
  it("세션 쿠키가 없으면 로그인 화면만 그리고 분석 폼을 그리지 않는다", async () => {
    render(await renderHome());
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
  });

  it("세션 쿠키가 있으면 분석 폼을 그리고 로그인 화면을 그리지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome());
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Continue with GitHub" })).not.toBeInTheDocument();
  });

  it("세션 쿠키가 없고 auth_error가 있으면 ERROR / AUTH 상태를 그린다", async () => {
    render(await renderHome({ auth_error: "access_denied" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ERROR / AUTH");
  });

  it("auth_error가 여러 번 오면 첫 값만 쓴다", async () => {
    render(await renderHome({ auth_error: ["state_mismatch", "access_denied"] }));
    expect(screen.getByRole("alert")).toHaveTextContent("We couldn't verify the login request.");
  });

  // 로그인이 이미 끝난 뒤 남은 쿼리입니다. 세션이 있으면 오류가 아닙니다.
  it("세션 쿠키가 있으면 auth_error 쿼리가 있어도 오류를 그리지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome({ auth_error: "access_denied" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();
  });

  // 로그아웃은 세션 삭제 뒤 router.refresh()로 서버가 이 페이지를 다시 실행하는 방식입니다. 그 결과가 화면을 바꿔야 합니다.
  it("서버가 세션 없이 다시 그리면 분석 폼을 내리고 로그인 진입점을 표시한다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    const { rerender } = render(await renderHome());
    expect(screen.getByLabelText("Owner")).toBeInTheDocument();

    cookieNames.delete(GITHUB_SESSION_COOKIE);
    rerender(await renderHome());
    expect(screen.queryByLabelText("Owner")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
  });
});

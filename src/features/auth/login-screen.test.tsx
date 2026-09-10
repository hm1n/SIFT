// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LOGIN_PATH } from "@/lib/github/auth-paths";
import { LoginScreen } from "./login-screen";

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  routerMock.replace.mockClear();
});

/** jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다. React의 onClick은 그대로 실행됩니다. */
function clickLogin(init?: MouseEventInit) {
  const link = screen.getByRole("link", { name: "Continue with GitHub" });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
}

describe("LoginScreen", () => {
  it("세션이 없으면 로고 자리, 제목, 설명, GitHub 로그인 버튼, 약관 문구를 그린다", () => {
    render(<LoginScreen />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/Turn your code into experiences/);
    expect(screen.getByText(/Analyze your GitHub history/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toHaveAttribute("href", LOGIN_PATH);
    expect(screen.getByText("By continuing you agree to our terms")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("버튼을 누르면 브라우저가 이동하기 전까지 AUTHENTICATING 상태를 그린다", () => {
    render(<LoginScreen />);
    clickLogin();
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("data-status-kind", "loading");
    expect(status).toHaveTextContent("Authenticating");
    expect(status).toHaveTextContent("Connecting to GitHub...");
    expect(screen.queryByRole("link", { name: "Continue with GitHub" })).not.toBeInTheDocument();
  });

  // 새 탭으로 열면 이 화면은 그대로 남습니다. 인증 중으로 바꾸면 사용자가 돌아와도 버튼을 다시 누를 수 없습니다.
  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["가운데 버튼", { button: 1 }],
  ])("%s 클릭은 새 탭으로 여는 것이므로 로그인 화면을 유지한다", (_name, init) => {
    render(<LoginScreen />);
    clickLogin(init);
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("bfcache에서 복원되면 인증 중 상태를 풀고 로그인 화면으로 돌아간다", () => {
    render(<LoginScreen />);
    clickLogin();
    expect(screen.getByRole("status")).toBeInTheDocument();
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    fireEvent(window, pageshow);
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
  });

  it("bfcache가 아닌 pageshow는 상태를 바꾸지 않는다", () => {
    render(<LoginScreen />);
    clickLogin();
    fireEvent(window, new Event("pageshow"));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // 이슈 #94 Constraint: 오류 종류별 안내가 사라지지 않습니다. 종류를 합쳐 한 문구로 만들지 않습니다.
  it.each([
    ["access_denied", "You cancelled the GitHub authorization. You can log in again."],
    ["state_mismatch", "We couldn't verify the login request. Start the login again from the beginning."],
    ["exchange_failed", "GitHub authentication didn't complete. Try again in a moment."],
    ["config_missing", "The server has no GitHub login configuration. A server administrator needs to complete the setup."],
  ])("%s 는 ERROR / AUTH 상태와 종류별 안내를 그린다", (authError, message) => {
    render(<LoginScreen authError={authError} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-status-kind", "error");
    expect(alert).toHaveTextContent("ERROR / AUTH");
    expect(alert).toHaveTextContent("Unable to connect to GitHub.");
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole("link", { name: "Continue with GitHub" })).not.toBeInTheDocument();
  });

  it("Try again은 auth_error 쿼리를 지워 로그인 화면으로 돌아간다", () => {
    render(<LoginScreen authError="exchange_failed" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(routerMock.replace).toHaveBeenCalledWith("/");
  });

  // 프로토타입 키는 안내 표에 없는데도 조회를 통과해, 객체가 그대로 렌더되면 화면이 죽습니다.
  it.each(["__proto__", "constructor", "toString", "없는코드"])("%s 는 로그인 오류 안내로 취급하지 않는다", (authError) => {
    render(<LoginScreen authError={authError} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with GitHub" })).toBeInTheDocument();
  });
});

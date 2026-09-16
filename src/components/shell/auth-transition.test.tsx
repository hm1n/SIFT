// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider, LoginLink } from "./auth-transition";

const trackEvent = vi.fn();
vi.mock("@/features/analytics/events", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

afterEach(() => {
  cleanup();
  trackEvent.mockClear();
});

describe("AuthTransition", () => {
  // provider가 빠진 자리의 로그인 링크는 인증 중 상태를 아무 데도 보내지 못하므로 조용히 동작하면 안 됩니다.
  it("LoginLink는 AuthTransitionProvider 밖에서 그리면 예외를 던진다", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<LoginLink variant="secondary" iconSize={13}>GitHub으로 로그인</LoginLink>)).toThrow(/AuthTransitionProvider/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  /**
   * 로그인 진입점은 헤더와 로그인 화면 둘인데 둘 다 이 컴포넌트를 씁니다. 진입점이 늘어도 여기
   * 하나만 세면 됩니다(이슈 #125).
   */
  it("로그인 링크를 누르면 login_start를 보낸다", () => {
    render(<AuthTransitionProvider><LoginLink variant="primary" iconSize={16}>Continue with GitHub</LoginLink></AuthTransitionProvider>);
    // jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다.
    fireEvent(screen.getByRole("link"), new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(trackEvent).toHaveBeenCalledWith({ name: "login_start" });
  });

  /**
   * `<a href>`는 기본 이동을 막지 않아 떠나기 전에 여러 번 눌릴 수 있고, `isAuthenticating`은 다시
   * 그린 뒤에야 true라 두 번째 클릭을 막지 못합니다. 한 번의 시도가 두 번 세어집니다(PR #129 리뷰).
   */
  it("연속으로 눌러도 login_start는 한 번만 보낸다", () => {
    render(<AuthTransitionProvider><LoginLink variant="primary" iconSize={16}>Continue with GitHub</LoginLink></AuthTransitionProvider>);
    const link = screen.getByRole("link");
    fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true }));
    fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  /**
   * 진입점이 헤더와 로그인 화면 둘입니다. 둘을 잇달아 눌러도 로그인 시도는 한 번입니다. 링크마다
   * 세면 진입점 수만큼 부풀어 오릅니다.
   */
  it("두 진입점을 잇달아 눌러도 login_start는 한 번만 보낸다", () => {
    render(
      <AuthTransitionProvider>
        <LoginLink variant="secondary" iconSize={13}>Log in with GitHub</LoginLink>
        <LoginLink variant="primary" iconSize={16}>Continue with GitHub</LoginLink>
      </AuthTransitionProvider>
    );
    for (const link of screen.getAllByRole("link")) {
      fireEvent(link, new MouseEvent("click", { bubbles: true, cancelable: true }));
    }
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });

  /** 새 탭으로 여는 클릭은 현재 화면을 떠나지 않으므로 로그인 시작이 아닙니다. */
  it("새 탭으로 여는 클릭은 세지 않는다", () => {
    render(<AuthTransitionProvider><LoginLink variant="primary" iconSize={16}>Continue with GitHub</LoginLink></AuthTransitionProvider>);
    fireEvent(screen.getByRole("link"), new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

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
    expect(() => render(<LoginLink variant="secondary" iconSize={13}>Log in with GitHub</LoginLink>)).toThrow(/AuthTransitionProvider/);
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

  /** 새 탭으로 여는 클릭은 현재 화면을 떠나지 않으므로 로그인 시작이 아닙니다. */
  it("새 탭으로 여는 클릭은 세지 않는다", () => {
    render(<AuthTransitionProvider><LoginLink variant="primary" iconSize={16}>Continue with GitHub</LoginLink></AuthTransitionProvider>);
    fireEvent(screen.getByRole("link"), new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginLink } from "./auth-transition";

afterEach(cleanup);

describe("AuthTransition", () => {
  // provider가 빠진 자리의 로그인 링크는 인증 중 상태를 아무 데도 보내지 못하므로 조용히 동작하면 안 됩니다.
  it("LoginLink는 AuthTransitionProvider 밖에서 그리면 예외를 던진다", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<LoginLink variant="secondary" iconSize={13}>Log in with GitHub</LoginLink>)).toThrow(/AuthTransitionProvider/);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GLOBAL_ERROR_COPY } from "@/copy/shell";

/**
 * SDK를 mock합니다. 실제 전송을 일으키지 않고 무엇이 넘어가는지만 봅니다. mock하지 않으면 jsdom이
 * 서버 빌드를 로드하다 깨집니다(`src/lib/sentry/report.ts` 주석 참고).
 */
const captureException = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  captureException: (...args: unknown[]) => captureException(...args),
}));

const { default: GlobalError } = await import("./global-error");

afterEach(() => {
  cleanup();
  captureException.mockReset();
});

describe("global-error", () => {
  /**
   * 이슈 #136이 고치는 세 번째 구멍입니다. App Router 기본 바운더리가 렌더 오류를 잡으면
   * `window.onerror`가 일어나지 않아 Sentry 전역 핸들러가 보지 못합니다. 이 호출이 유일한 경로입니다.
   */
  it("잡힌 렌더 오류를 Sentry로 보낸다", () => {
    const error = Object.assign(new Error("렌더 실패"), { digest: "abc123" });
    render(<GlobalError error={error} reset={() => undefined} />);
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
  });

  /**
   * 오류 상태를 사용자에게도 남깁니다. AGENTS.md의 작업 원칙이 Error 상태를 요구하므로, 오류를
   * Sentry로 보내는 것으로 화면의 안내를 대신하지 않습니다.
   */
  it("무엇을 하면 되는지와 돌아갈 자리를 함께 보여 준다", () => {
    render(<GlobalError error={new Error("렌더 실패")} reset={() => undefined} />);
    expect(screen.getByRole("alert")).toHaveTextContent(GLOBAL_ERROR_COPY.label);
    expect(screen.getByRole("alert")).toHaveTextContent(GLOBAL_ERROR_COPY.sub);
    expect(screen.getByRole("link", { name: GLOBAL_ERROR_COPY.home })).toHaveAttribute("href", "/");
  });

  it("다시 시도를 누르면 바운더리를 되돌린다", () => {
    const reset = vi.fn();
    render(<GlobalError error={new Error("렌더 실패")} reset={reset} />);
    fireEvent.click(screen.getByRole("button", { name: GLOBAL_ERROR_COPY.retry }));
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

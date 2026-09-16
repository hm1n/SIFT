import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  reportServerError,
  SENTRY_SERVER_ERROR_MIN_STATUS,
  setServerErrorReporter,
} from "./report";

/**
 * 이 파일은 `@sentry/nextjs`를 mock하지 않습니다. `report.ts`가 SDK를 import하지 않기 때문입니다.
 * mock 없이 import되는 것 자체가 그 경계를 확인합니다.
 */
const report = vi.fn();

describe("reportServerError", () => {
  beforeEach(() => {
    report.mockReset();
    setServerErrorReporter(report);
  });

  afterEach(() => {
    setServerErrorReporter(null);
    vi.restoreAllMocks();
  });

  /**
   * 이슈 #136의 단일 규칙입니다. 실제 장애만 Issues에 담깁니다.
   *
   * 각 status는 이 앱이 실제로 내보내는 오류 응답에서 가져왔습니다. 500은 `server_error`, 502는 LLM
   * 실패와 GitHub network, 503은 `storage_failed`와 `llm_rate_limit`, 504는 `llm_timeout`입니다.
   */
  it.each([500, 502, 503, 504])("reports a %d response", (status) => {
    const error = new Error("server side failure");
    const response = Response.json({ error: { kind: "server_error" } }, { status });
    expect(reportServerError(error, response)).toBe(response);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(error);
  });

  /**
   * 사용자 입력 문제는 Sentry로 가지 않아야 합니다. 각 status는 이 앱의 오류 종류에 대응합니다.
   * 400은 `invalid_json`, 401은 `unauthorized`, 404는 `not_found`, 409는 `version_conflict`,
   * 413은 `body_too_large`, 422는 `invalid_request`, 429는 GitHub `rate_limit`입니다.
   */
  it.each([200, 204, 400, 401, 404, 409, 413, 422, 429])(
    "does not report a %d response",
    (status) => {
      const response =
        status === 204
          ? new Response(null, { status })
          : Response.json({ error: { kind: "invalid_request" } }, { status });
      expect(reportServerError(new Error("user side problem"), response)).toBe(response);
      expect(report).not.toHaveBeenCalled();
    }
  );

  /**
   * 2026-09-16 실측이 만든 회귀 테스트입니다. 전송 함수를 모듈 지역 변수에 두면 `next start`에서
   * 이벤트가 한 건도 나가지 않습니다. Next.js가 `instrumentation.ts`와 라우트를 다른 번들로 만들어
   * 같은 모듈의 인스턴스가 둘 생기고, `register()`가 등록한 값을 라우트 쪽 사본이 보지 못하기
   * 때문입니다. 등록 위치가 `globalThis`여야 두 번들이 같은 값을 봅니다.
   *
   * 이 테스트는 한 번들 안에서 도니 번들 분리 자체를 재현하지는 못합니다. 대신 분리를 견디게 하는
   * 조건인 등록 위치를 고정합니다. 실제 도달 확인은 `next start`로 한 절차이고
   * `llm-wiki/wiki/2026-09-16-sentry-서버-계측.md`에 있습니다.
   */
  it("전송 함수를 globalThis에 두어 번들이 갈려도 같은 값을 보게 한다", () => {
    const carrier = globalThis as { [key: symbol]: unknown };
    expect(carrier[Symbol.for("sift.sentry.serverErrorReporter")]).toBe(report);
  });

  it("uses 500 as the threshold", () => {
    expect(SENTRY_SERVER_ERROR_MIN_STATUS).toBe(500);
  });

  /**
   * 이슈 #136의 제약입니다. DSN이 없으면 `initSentryServer`가 전송 함수를 등록하지 않으므로, 등록되지
   * 않은 상태에서 5xx가 나도 아무것도 나가지 않아야 합니다.
   */
  it("stays silent when no reporter is registered", () => {
    setServerErrorReporter(null);
    const response = Response.json({ error: { kind: "server_error" } }, { status: 500 });
    expect(reportServerError(new Error("boom"), response)).toBe(response);
    expect(report).not.toHaveBeenCalled();
  });

  // 계측이 던지면 사용자가 받을 오류 응답까지 사라집니다.
  it("returns the response even when reporting throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    report.mockImplementation(() => {
      throw new Error("transport down");
    });
    const response = Response.json({ error: { kind: "server_error" } }, { status: 500 });
    expect(reportServerError(new Error("boom"), response)).toBe(response);
    expect(consoleError).toHaveBeenCalled();
  });
});

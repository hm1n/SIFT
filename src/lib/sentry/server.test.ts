import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK를 mock합니다. 실제 초기화와 전송을 일으키지 않고 무엇이 넘어가는지 봅니다.
const init = vi.fn();
const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  init: (...args: unknown[]) => init(...args),
  captureException: (...args: unknown[]) => captureException(...args),
}));

const { initSentryServer, reportServerError, resolveServerSentryDsn } = await import("./server");

const VALID_DSN = "https://public@o1.ingest.sentry.io/2";
const PUBLIC_DSN = "https://public@o1.ingest.sentry.io/3";

function clearDsnEnv(): void {
  delete process.env.SENTRY_DSN;
  delete process.env.NEXT_PUBLIC_SENTRY_DSN;
}

describe("initSentryServer", () => {
  beforeEach(() => {
    clearDsnEnv();
    init.mockReset();
    init.mockImplementation(() => undefined);
  });

  afterEach(() => {
    clearDsnEnv();
    vi.restoreAllMocks();
  });

  /**
   * 이슈 #136의 제약입니다. DSN이 없으면 초기화하지 않아 로컬 개발과 테스트에서 이벤트가 나가지
   * 않아야 합니다. 서버에서도 클라이언트와 같은 동작을 유지합니다.
   */
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("does not call Sentry.init when both DSN variables are %s", (_label, value) => {
    if (value !== undefined) {
      process.env.SENTRY_DSN = value;
      process.env.NEXT_PUBLIC_SENTRY_DSN = value;
    }
    expect(resolveServerSentryDsn()).toBeNull();
    expect(initSentryServer()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("calls Sentry.init once with the trimmed server DSN", () => {
    process.env.SENTRY_DSN = `  ${VALID_DSN}  `;
    expect(initSentryServer()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dsn: VALID_DSN });
  });

  // 공개 DSN 하나만 설정한 배포에서도 서버 이벤트가 나가야 합니다.
  it("falls back to the public DSN when the server DSN is absent", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = PUBLIC_DSN;
    expect(resolveServerSentryDsn()).toBe(PUBLIC_DSN);
    expect(initSentryServer()).toBe(true);
    expect(init.mock.calls[0]?.[0]).toMatchObject({ dsn: PUBLIC_DSN });
  });

  it("prefers the server DSN over the public DSN", () => {
    process.env.SENTRY_DSN = VALID_DSN;
    process.env.NEXT_PUBLIC_SENTRY_DSN = PUBLIC_DSN;
    expect(resolveServerSentryDsn()).toBe(VALID_DSN);
  });

  // 공백뿐인 서버 DSN은 설정하지 않은 것과 같이 다뤄 공개 DSN으로 내려가야 합니다.
  it("falls back to the public DSN when the server DSN is whitespace only", () => {
    process.env.SENTRY_DSN = "   ";
    process.env.NEXT_PUBLIC_SENTRY_DSN = PUBLIC_DSN;
    expect(resolveServerSentryDsn()).toBe(PUBLIC_DSN);
  });

  /**
   * 이슈 #136의 제약입니다. 이 값이 켜지면 SDK가 요청 헤더와 쿠키를 이벤트에 싣고, 세션 쿠키에는
   * 암호화된 GitHub 토큰이 들어 있습니다. 기본값이 꺼짐이지만 SDK 업그레이드로 기본값이 바뀌면
   * 조용히 토큰이 나가므로 값을 고정합니다.
   */
  it("disables sendDefaultPii so request headers and cookies never leave", () => {
    process.env.SENTRY_DSN = VALID_DSN;
    initSentryServer();
    expect(init.mock.calls[0]?.[0]).toMatchObject({ sendDefaultPii: false });
  });

  // 서버 트랜잭션 샘플링은 이슈 #136의 Non-goal입니다. 오류 수집만 켭니다.
  it("does not sample server transactions", () => {
    process.env.SENTRY_DSN = VALID_DSN;
    initSentryServer();
    expect(init.mock.calls[0]?.[0]).toMatchObject({ tracesSampleRate: 0 });
  });

  /**
   * `register()`는 서버가 요청을 받기 전에 실행되므로 여기서 던지면 앱이 기동하지 못합니다.
   * 계측 실패가 앱을 멈추게 하면 안 됩니다.
   */
  it("isolates an initialization failure instead of breaking server startup", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    process.env.SENTRY_DSN = VALID_DSN;
    init.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(initSentryServer()).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe("reportServerError", () => {
  beforeEach(() => {
    captureException.mockReset();
    captureException.mockImplementation(() => undefined);
  });

  afterEach(() => {
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
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(error);
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
      expect(captureException).not.toHaveBeenCalled();
    }
  );

  // 계측이 던지면 사용자가 받을 오류 응답까지 사라집니다.
  it("returns the response even when capturing throws", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureException.mockImplementation(() => {
      throw new Error("transport down");
    });
    const response = Response.json({ error: { kind: "server_error" } }, { status: 500 });
    expect(reportServerError(new Error("boom"), response)).toBe(response);
    expect(consoleError).toHaveBeenCalled();
  });
});

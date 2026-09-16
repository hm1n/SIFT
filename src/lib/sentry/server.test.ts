import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK를 mock합니다. 실제 초기화와 전송을 일으키지 않고 무엇이 넘어가는지 봅니다.
const init = vi.fn();
const captureException = vi.fn();

vi.mock("@sentry/nextjs", () => ({
  init: (...args: unknown[]) => init(...args),
  captureException: (...args: unknown[]) => captureException(...args),
}));

const { initSentryServer, resolveServerSentryDsn } = await import("./server");
const { reportServerError, setServerErrorReporter } = await import("./report");

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
    setServerErrorReporter(null);
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

  /**
   * 초기화에 성공해야만 전송 함수가 등록됩니다. 이 배선이 끊기면 라우트가 `reportServerError`를 불러도
   * 아무 데도 가지 않고, 그 사실이 화면에도 로그에도 드러나지 않습니다.
   */
  it("registers the reporter so route errors reach Sentry", () => {
    process.env.SENTRY_DSN = VALID_DSN;
    expect(initSentryServer()).toBe(true);
    const error = new Error("route failure");
    reportServerError(error, Response.json({}, { status: 500 }));
    expect(captureException).toHaveBeenCalledWith(error);
  });

  /**
   * 이슈 #136의 제약입니다. DSN이 없으면 전송 함수도 등록되지 않아야 합니다. 호출부가 조심하는 것이
   * 아니라 구조로 막힙니다.
   */
  it("does not register the reporter when the DSN is absent", () => {
    captureException.mockClear();
    expect(initSentryServer()).toBe(false);
    reportServerError(new Error("route failure"), Response.json({}, { status: 500 }));
    expect(captureException).not.toHaveBeenCalled();
  });

  // 초기화가 실패한 SDK로 전송을 시도하면 요청마다 예외가 납니다.
  it("does not register the reporter when initialization fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureException.mockClear();
    process.env.SENTRY_DSN = VALID_DSN;
    init.mockImplementation(() => {
      throw new Error("boom");
    });
    expect(initSentryServer()).toBe(false);
    reportServerError(new Error("route failure"), Response.json({}, { status: 500 }));
    expect(captureException).not.toHaveBeenCalled();
  });
});

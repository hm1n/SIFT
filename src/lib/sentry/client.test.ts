import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// SDK를 mock합니다. 실제 초기화를 일으키지 않고 `Sentry.init`에 무엇이 넘어가는지 봅니다.
const init = vi.fn();
const browserTracingIntegration = vi.fn((options?: unknown) => ({
  name: "BrowserTracing",
  options,
}));

vi.mock("@sentry/nextjs", () => ({
  init: (...args: unknown[]) => init(...args),
  browserTracingIntegration: (...args: unknown[]) => browserTracingIntegration(...args),
}));

const { initSentryClient, resolveSentryDsn, SENTRY_INITIAL_TRACES_SAMPLE_RATE } = await import(
  "./client"
);

const VALID_DSN = "https://public@o1.ingest.sentry.io/2";

describe("initSentryClient", () => {
  beforeEach(() => {
    init.mockReset();
    init.mockImplementation(() => undefined);
    browserTracingIntegration.mockClear();
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    vi.restoreAllMocks();
  });

  // 이슈 #81의 제약입니다. DSN이 없으면 초기화하지 않아 로컬 개발과 테스트에서 이벤트가 나가지
  // 않아야 합니다.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("does not call Sentry.init when the DSN is %s", (_label, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = value;
    expect(initSentryClient()).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it("calls Sentry.init once with the trimmed DSN and the initial traces sample rate", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = `  ${VALID_DSN}  `;
    expect(initSentryClient()).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(init.mock.calls[0]?.[0]).toMatchObject({
      dsn: VALID_DSN,
      tracesSampleRate: SENTRY_INITIAL_TRACES_SAMPLE_RATE,
    });
  });

  // 이 배선이 깨지면 CLS가 조용히 사라집니다. SDK가 실험 옵션으로 분류한 값이고,
  // `Sentry.init`이 아니라 통합 인자로 넘겨야 동작합니다.
  it("passes the standalone CLS experiment to browserTracingIntegration, not to init", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = VALID_DSN;
    initSentryClient();
    expect(browserTracingIntegration).toHaveBeenCalledWith({
      _experiments: { enableStandaloneClsSpans: true },
    });
    const options = init.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options._experiments).toBeUndefined();
    expect(options.integrations).toHaveLength(1);
  });

  // 이 코드는 hydration 전에 실행됩니다. 여기서 예외가 새 나가면 앱 초기화가 멈춥니다.
  it("does not rethrow when Sentry.init throws", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = VALID_DSN;
    init.mockImplementation(() => {
      throw new Error("boom");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => initSentryClient()).not.toThrow();
    expect(initSentryClient()).toBe(false);
    expect(consoleError).toHaveBeenCalled();
  });

  it("does not rethrow when building the integration throws", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = VALID_DSN;
    browserTracingIntegration.mockImplementation(() => {
      throw new Error("boom");
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => initSentryClient()).not.toThrow();
    expect(init).not.toHaveBeenCalled();
  });
});

describe("resolveSentryDsn", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  it("trims surrounding whitespace", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = `  ${VALID_DSN}  `;
    expect(resolveSentryDsn()).toBe(VALID_DSN);
  });

  // Web Vitals는 pageload 트랜잭션의 measurement로 실려 오므로 이 값이 0이면 지표가 오지
  // 않습니다. 값을 낮추는 조정은 실측 뒤에 하되 0으로 떨어지면 이슈 #81의 Goal을 위반합니다.
  it("keeps tracing enabled", () => {
    expect(SENTRY_INITIAL_TRACES_SAMPLE_RATE).toBeGreaterThan(0);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { resolveSentryClientOptions, SENTRY_INITIAL_TRACES_SAMPLE_RATE } from "./client-options";

describe("resolveSentryClientOptions", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;
  });

  // 이슈 #81의 제약입니다. DSN이 없으면 초기화하지 않아 로컬 개발과 테스트에서 이벤트가 나가지
  // 않아야 합니다. 호출자는 null을 받으면 `Sentry.init`을 부르지 않습니다.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("returns null when the DSN is %s", (_label, value) => {
    if (value === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = value;
    expect(resolveSentryClientOptions()).toBeNull();
  });

  it("returns the DSN and the initial traces sample rate when the DSN is set", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "https://public@o1.ingest.sentry.io/2";
    expect(resolveSentryClientOptions()).toEqual({
      dsn: "https://public@o1.ingest.sentry.io/2",
      tracesSampleRate: SENTRY_INITIAL_TRACES_SAMPLE_RATE,
    });
  });

  it("trims surrounding whitespace from the DSN", () => {
    process.env.NEXT_PUBLIC_SENTRY_DSN = "  https://public@o1.ingest.sentry.io/2  ";
    expect(resolveSentryClientOptions()?.dsn).toBe("https://public@o1.ingest.sentry.io/2");
  });

  // Web Vitals는 pageload 트랜잭션의 measurement로 실려 오므로 이 값이 0이면 지표가 오지
  // 않습니다. 값을 낮추는 조정은 실측 뒤에 하되, 0으로 떨어지는 것은 계측 자체를 끄는 것이라
  // 이슈 #81의 Goal을 위반합니다.
  it("keeps tracing enabled", () => {
    expect(SENTRY_INITIAL_TRACES_SAMPLE_RATE).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveMeasurementId, sendGaEvent, setGaParams } from "./ga";

const VALID_ID = "G-ABC123XYZ";

function stubGtag() {
  const gtag = vi.fn();
  window.gtag = gtag;
  return gtag;
}

beforeEach(() => {
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  delete window.gtag;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
  delete window.gtag;
  vi.restoreAllMocks();
});

describe("resolveMeasurementId", () => {
  // 이슈 #125의 제약입니다. 측정 ID가 없으면 초기화하지 않고 콘솔 경고도 남기지 않습니다.
  // 로컬 개발과 테스트의 정상 상태입니다.
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
  ])("returns null when the measurement id is %s", (_label, value) => {
    if (value !== undefined) process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
    expect(resolveMeasurementId()).toBeNull();
  });

  it("trims the measurement id", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = `  ${VALID_ID}  `;
    expect(resolveMeasurementId()).toBe(VALID_ID);
  });

  /**
   * 측정 ID는 인라인 부트스트랩 스크립트 본문에 문자열로 박힙니다. 형식을 벗어난 값을 통과시키면
   * 환경변수가 스크립트를 깨거나 코드를 끼워 넣는 통로가 됩니다.
   */
  it.each([
    ["a quote", "G-ABC'; alert(1); '"],
    ["a script tag", "G-ABC</script>"],
    ["a space", "G-ABC 123"],
  ])("treats a measurement id containing %s as absent", (_label, value) => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
    expect(resolveMeasurementId()).toBeNull();
  });

  /**
   * 문자 집합만 보면 GA4 웹 스트림이 아닌 값도 통과해 스크립트 로드와 전송 경로가 켜지고, 이벤트가
   * 어디에도 도착하지 않은 채 조용히 사라집니다(PR #129 리뷰).
   */
  it.each([
    ["no prefix", "ABC123"],
    ["an empty identifier", "G-"],
    ["only hyphens", "---"],
    ["a Tag Manager id", "GTM-ABC123"],
    ["a Google Ads id", "AW-123456789"],
    ["a lowercase prefix", "g-ABC123"],
  ])("treats %s as absent", (_label, value) => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
    expect(resolveMeasurementId()).toBeNull();
  });
});

describe("sendGaEvent", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["malformed", "G-ABC</script>"],
  ])("sends nothing when the measurement id is %s", (_label, value) => {
    if (value !== undefined) process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
    const gtag = stubGtag();
    sendGaEvent("login_start", {});
    expect(gtag).not.toHaveBeenCalled();
  });

  it("sends the event name and parameters to gtag", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    const gtag = stubGtag();
    sendGaEvent("repo_list_loaded", { repo_count: 7, duration_ms: 120 });
    expect(gtag).toHaveBeenCalledWith("event", "repo_list_loaded", { repo_count: 7, duration_ms: 120 });
  });

  /** GA4에 undefined를 그대로 보내면 문자열 "undefined"가 디멘션 값으로 쌓입니다. */
  it("drops parameters whose value is undefined", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    const gtag = stubGtag();
    sendGaEvent("login_view", { auth_error: undefined });
    expect(gtag).toHaveBeenCalledWith("event", "login_view", {});
  });

  /**
   * 광고 차단기나 네트워크 정책으로 스크립트가 아예 로드되지 않는 경우를 정상 경로로 다룹니다.
   * 던지지 않고 그냥 반환합니다(이슈 #125 제약).
   */
  it("does not throw when gtag is missing", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    expect(() => sendGaEvent("login_start", {})).not.toThrow();
  });

  /** 계측 코드에서 던진 예외가 화면으로 올라가면 인터뷰 도중 대화가 끊깁니다. */
  it("swallows an exception thrown by gtag", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    window.gtag = () => {
      throw new Error("blocked");
    };
    expect(() => sendGaEvent("login_start", {})).not.toThrow();
  });
});

describe("setGaParams", () => {
  it("sets common parameters through gtag set", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    const gtag = stubGtag();
    setGaParams({ flow_id: "flow-1", repo_visibility: "private" });
    expect(gtag).toHaveBeenCalledWith("set", { flow_id: "flow-1", repo_visibility: "private" });
  });

  /** null은 그 파라미터를 지우라는 뜻이므로 undefined처럼 걸러내면 안 됩니다. */
  it("keeps null so that gtag clears the parameter", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = VALID_ID;
    const gtag = stubGtag();
    setGaParams({ flow_id: null });
    expect(gtag).toHaveBeenCalledWith("set", { flow_id: null });
  });

  it("sets nothing when the measurement id is absent", () => {
    const gtag = stubGtag();
    setGaParams({ user_id: "hashed" });
    expect(gtag).not.toHaveBeenCalled();
  });
});

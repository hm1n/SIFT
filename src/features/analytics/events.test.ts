import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEvent } from "./events";

const sendGaEvent = vi.fn();
const setGaParams = vi.fn();

vi.mock("@/lib/analytics/ga", () => ({
  sendGaEvent: (...args: unknown[]) => sendGaEvent(...args),
  setGaParams: (...args: unknown[]) => setGaParams(...args),
}));

const { clearAnalysisFlow, commitCountBucket, setAnalyticsUser, startAnalysisFlow, trackEvent } =
  await import("./events");

beforeEach(() => {
  sendGaEvent.mockClear();
  setGaParams.mockClear();
});

describe("commitCountBucket", () => {
  // 경계값입니다. 0-50, 51-200, 201-1000, 1000+이므로 1000은 아래 칸이고 1001부터 위 칸입니다.
  it.each([
    [0, "0-50"],
    [50, "0-50"],
    [51, "51-200"],
    [200, "51-200"],
    [201, "201-1000"],
    [1000, "201-1000"],
    [1001, "1000+"],
  ])("maps %i to %s", (count, bucket) => {
    expect(commitCountBucket(count)).toBe(bucket);
  });
});

describe("trackEvent", () => {
  it("splits the event name from its parameters", () => {
    trackEvent({ name: "repo_list_loaded", repo_count: 3, duration_ms: 42 });
    expect(sendGaEvent).toHaveBeenCalledWith("repo_list_loaded", { repo_count: 3, duration_ms: 42 });
  });

  it("sends an event with no parameters as an empty object", () => {
    trackEvent({ name: "login_start" });
    expect(sendGaEvent).toHaveBeenCalledWith("login_start", {});
  });

  /**
   * `repo_list_loaded`는 저장소 목록을 조회하는 함수 안에서 나갑니다. 거기서 던지면 계측 실패가
   * 조회 실패가 되어 사용자에게 오류 화면이 뜹니다(이슈 #125 제약).
   */
  it("does not throw when the transport throws", () => {
    sendGaEvent.mockImplementationOnce(() => {
      throw new Error("transport is broken");
    });
    expect(() => trackEvent({ name: "repo_list_loaded", repo_count: 1, duration_ms: 1 })).not.toThrow();
  });
});

describe("공통 파라미터", () => {
  it("sets the hashed user id", () => {
    setAnalyticsUser("hashed-user");
    expect(setGaParams).toHaveBeenCalledWith({ user_id: "hashed-user" });
  });

  /**
   * `gtag('set', { user_id: null })`을 부르면 gtag가 그 자리를 빈 문자열로 직렬화해 이후 모든
   * 이벤트에 `uid=`를 실어 보냅니다(2026-09-15 수집 요청 가로채기로 확인). 로그인 전에는 붙지
   * 않아야 하므로 아예 세우지 않습니다.
   */
  it("does not call gtag when there has never been a user id", async () => {
    // "한 번도 세운 적 없음"은 모듈 상태이므로 이 스위트의 다른 테스트와 섞이지 않게 새로 불러옵니다.
    vi.resetModules();
    const fresh = await import("./events");
    setGaParams.mockClear();
    fresh.setAnalyticsUser(null);
    expect(setGaParams).not.toHaveBeenCalled();
  });

  /** 로그아웃은 새로고침 없이 서버 컴포넌트만 다시 그립니다. 지우지 않으면 앞 사용자의 값이 남습니다. */
  it("clears the user id once one has been set", () => {
    setAnalyticsUser("hashed-user");
    setGaParams.mockClear();
    setAnalyticsUser(null);
    expect(setGaParams).toHaveBeenCalledWith({ user_id: null });
  });

  it("sets the flow id and repository context when an analysis starts", () => {
    startAnalysisFlow({ repoVisibility: "private", repoLanguage: "TypeScript" });
    expect(setGaParams).toHaveBeenCalledWith({
      flow_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      repo_visibility: "private",
      repo_language: "TypeScript",
    });
  });

  /** 언어가 없는 저장소가 있습니다. 빈 문자열 대신 파라미터를 지워 값 없음과 값 있음을 가릅니다. */
  it("clears the language when the repository has none", () => {
    startAnalysisFlow({ repoVisibility: "public", repoLanguage: null });
    expect(setGaParams).toHaveBeenCalledWith(expect.objectContaining({ repo_language: null }));
  });

  /**
   * `crypto.randomUUID`는 보안 컨텍스트에만 있습니다. LAN 주소로 띄운 개발 서버에는 없고, 그때
   * 던지는 예외가 이 함수 밖으로 나가면 분석 시작 자체가 막힙니다.
   */
  it("does not throw when the flow id cannot be generated", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    expect(() => startAnalysisFlow({ repoVisibility: "public", repoLanguage: null })).not.toThrow();
    randomUUID.mockRestore();
  });

  /**
   * `flow_id` 생성 실패가 저장소 문맥까지 함께 날리면, 곧바로 나가는 `analysis_requested`가 저장소
   * 문맥 없이 전송됩니다. 묶는 값이 없을 뿐 나머지는 그대로 붙어야 합니다(PR #129 리뷰).
   */
  it("keeps the repository context when the flow id cannot be generated", () => {
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      throw new TypeError("crypto.randomUUID is not a function");
    });
    startAnalysisFlow({ repoVisibility: "private", repoLanguage: "TypeScript" });
    expect(setGaParams).toHaveBeenCalledWith({ repo_visibility: "private", repo_language: "TypeScript" });
    randomUUID.mockRestore();
  });

  /** 비우지 않으면 다음 분석을 시작하기 전의 이벤트가 지난 분석의 `flow_id`를 달고 나갑니다. */
  it("clears the whole flow context when the repository changes", () => {
    startAnalysisFlow({ repoVisibility: "public", repoLanguage: null });
    setGaParams.mockClear();
    clearAnalysisFlow();
    expect(setGaParams).toHaveBeenCalledWith({ flow_id: null, repo_visibility: null, repo_language: null });
  });

  /**
   * 세운 적 없는 파라미터를 null로 지우면 gtag가 빈 문자열로 직렬화해 이후 모든 이벤트에 실어
   * 보냅니다(`user_id`에서 실측). 이 가드가 없으면 로그인 화면처럼 분석을 한 적 없는 자리에서
   * 지우기를 부를 수 없습니다(PR #129 리뷰).
   */
  it("does not clear a flow context that was never set", async () => {
    // "한 번도 세운 적 없음"은 모듈 상태이므로 이 스위트의 다른 테스트와 섞이지 않게 새로 불러옵니다.
    vi.resetModules();
    const fresh = await import("./events");
    setGaParams.mockClear();
    fresh.clearAnalysisFlow();
    expect(setGaParams).not.toHaveBeenCalled();
  });

  it("does not throw when the transport throws", () => {
    setGaParams.mockImplementation(() => {
      throw new Error("transport is broken");
    });
    expect(() => setAnalyticsUser("hashed-user")).not.toThrow();
    expect(() => startAnalysisFlow({ repoVisibility: "public", repoLanguage: null })).not.toThrow();
    expect(() => clearAnalysisFlow()).not.toThrow();
    setGaParams.mockReset();
  });
});

/**
 * 1차 범위 이벤트를 하나씩 세워 GA4 한도를 확인합니다. 이 배열은 자동으로 늘지 않으므로 이벤트를
 * 더할 때 함께 더해야 합니다. 타입이 `AnalyticsEvent`라 이름이나 파라미터를 잘못 적으면 컴파일이 막습니다.
 */
const EVENT_SAMPLES: readonly AnalyticsEvent[] = [
  { name: "login_view", auth_error: "state_mismatch" },
  { name: "login_start" },
  { name: "login_result", success: false, error_kind: "exchange_failed" },
  { name: "repo_list_loaded", repo_count: 12, duration_ms: 340 },
  { name: "analysis_requested", contribution_item_count: 2 },
  { name: "analysis_stage_done", stage: "repository_metadata", duration_ms: 1200 },
  { name: "analysis_succeeded", candidate_count: 3, commit_count_bucket: "201-1000", duration_ms: 90000 },
  { name: "analysis_empty", empty_kind: "no_final_candidates" },
  { name: "analysis_failed", error_kind: "llm_hallucination_rejected", recovery: "retry", stage: "stage_b" },
  { name: "analysis_retried", error_kind: "rate_limit", retry_scope: "candidate_generation" },
];

describe("GA4 한도", () => {
  it("keeps every event name, parameter name, and value within the GA4 limits", () => {
    for (const event of EVENT_SAMPLES) {
      const { name, ...params } = event;
      expect(name.length).toBeLessThanOrEqual(40);
      // 공통 파라미터 넷(user_id, flow_id, repo_visibility, repo_language)이 더 붙으므로 여유를 둡니다.
      expect(Object.keys(params).length).toBeLessThanOrEqual(21);
      for (const [key, value] of Object.entries(params)) {
        expect(key.length).toBeLessThanOrEqual(40);
        if (typeof value === "string") expect(value.length).toBeLessThanOrEqual(100);
      }
    }
  });

  /** ga_, google_, firebase_ 접두사와 자동 수집 이벤트 이름은 쓸 수 없습니다. */
  it("does not use reserved event name prefixes", () => {
    for (const { name } of EVENT_SAMPLES) {
      expect(name).not.toMatch(/^(ga_|google_|firebase_)/);
    }
  });
});

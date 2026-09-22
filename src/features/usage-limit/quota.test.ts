import { describe, expect, it } from "vitest";
import { analysisUsageDate, DAILY_ANALYSIS_LIMIT } from "./quota";

describe("하루 분석 횟수 상한", () => {
  it("상한은 3회다", () => {
    // 이 값이 바뀌면 `llm-wiki/wiki/2026-09-22-분석-횟수-상한.md`의 비용 계산도 함께 고쳐야 합니다.
    expect(DAILY_ANALYSIS_LIMIT).toBe(3);
  });

  describe("날짜는 한국 자정에 넘어간다", () => {
    /**
     * UTC로 날짜를 가르면 한국 시간 오전 9시에 횟수가 초기화됩니다. 사용자가 밤에 상한에 닿고
     * 자정을 넘겨도 아홉 시간을 더 기다려야 하므로 "내일 다시" 안내가 틀린 말이 됩니다.
     */
    it.each([
      ["한국 시간으로 막 자정을 넘긴 순간", "2026-09-21T15:00:00Z", "2026-09-22"],
      ["그 1밀리초 전", "2026-09-21T14:59:59.999Z", "2026-09-21"],
      ["UTC 자정은 한국에서 이미 그날 오전 9시", "2026-09-22T00:00:00Z", "2026-09-22"],
      ["한국 시간 그날의 마지막 순간", "2026-09-22T14:59:59.999Z", "2026-09-22"],
    ])("%s", (_label, now, expected) => {
      expect(analysisUsageDate(Date.parse(now))).toBe(expected);
    });
  });

  it("해가 바뀌는 경계에서도 한국 날짜로 넘어간다", () => {
    expect(analysisUsageDate(Date.parse("2026-12-31T14:59:59.999Z"))).toBe("2026-12-31");
    expect(analysisUsageDate(Date.parse("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
  });
});

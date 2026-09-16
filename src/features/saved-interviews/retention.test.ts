import { describe, expect, it } from "vitest";
import { daysUntilDeletion, DELETION_WARNING_DAYS, RETENTION_DAYS, retentionCutoff } from "./retention";

const DAY_MS = 86_400_000;
const NOW = Date.parse("2026-09-15T12:00:00Z");

describe("보관 기간", () => {
  it("방금 연 인터뷰는 보관 기간이 그대로 남는다", () => {
    expect(daysUntilDeletion(new Date(NOW), NOW)).toBe(RETENTION_DAYS);
  });

  /**
   * `opened_at`은 데이터베이스 시계가, 남은 날수는 브라우저 시계가 셉니다. 브라우저가 몇 초 느리면 방금
   * 연 인터뷰가 미래로 보이고, 자르지 않으면 보관 기간보다 하루 많은 91이 화면에 뜹니다.
   */
  it("연 시각이 지금보다 앞서도 보관 기간을 넘지 않는다", () => {
    expect(daysUntilDeletion(new Date(NOW + 2_000), NOW)).toBe(RETENTION_DAYS);
  });

  it("하루가 지날 때마다 하루씩 줄어든다", () => {
    expect(daysUntilDeletion(new Date(NOW - 10 * DAY_MS), NOW)).toBe(RETENTION_DAYS - 10);
  });

  it("경고 기준에 닿으면 남은 날수가 경고 날수 이하다", () => {
    const openedAt = new Date(NOW - (RETENTION_DAYS - DELETION_WARNING_DAYS) * DAY_MS);

    expect(daysUntilDeletion(openedAt, NOW)).toBeLessThanOrEqual(DELETION_WARNING_DAYS);
  });

  it("기한이 지나면 0 이하다", () => {
    expect(daysUntilDeletion(new Date(NOW - (RETENTION_DAYS + 1) * DAY_MS), NOW)).toBeLessThanOrEqual(0);
  });

  it("ISO 문자열도 받는다", () => {
    expect(daysUntilDeletion(new Date(NOW - DAY_MS).toISOString(), NOW)).toBe(RETENTION_DAYS - 1);
  });

  /** 응답이 낡아 시각을 읽지 못하는 경우입니다. 남은 날수를 0으로 보면 화면이 멀쩡한 인터뷰를 숨깁니다. */
  it("시각을 읽지 못하면 보관 기간 전체로 본다", () => {
    expect(daysUntilDeletion("시각이 아님", NOW)).toBe(RETENTION_DAYS);
  });

  it("정리 기준 시각은 보관 기간만큼 앞이다", () => {
    expect(retentionCutoff(NOW).toISOString()).toBe(new Date(NOW - RETENTION_DAYS * DAY_MS).toISOString());
  });
});

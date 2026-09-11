import { describe, expect, it } from "vitest";
import { parseContributionItems } from "./contribution-items";
import { formatUpdatedLabel } from "./updated-label";

const NOW = Date.parse("2026-09-11T12:00:00Z");

describe("formatUpdatedLabel", () => {
  it.each([
    ["2026-09-11T03:00:00Z", "UPDATED TODAY"],
    ["2026-09-10T11:00:00Z", "UPDATED 1D AGO"],
    ["2026-09-09T12:00:00Z", "UPDATED 2D AGO"],
    ["2026-08-28T12:00:00Z", "UPDATED 14D AGO"],
  ])("%s를 %s로 표시한다", (pushedAt, label) => {
    expect(formatUpdatedLabel(pushedAt, NOW)).toBe(label);
  });

  it("미래 시각은 TODAY로 본다", () => {
    expect(formatUpdatedLabel("2026-09-12T00:00:00Z", NOW)).toBe("UPDATED TODAY");
  });

  it("값이 없거나 해석할 수 없으면 라벨을 만들지 않는다", () => {
    expect(formatUpdatedLabel(null, NOW)).toBeNull();
    expect(formatUpdatedLabel("not a date", NOW)).toBeNull();
  });
});

describe("parseContributionItems", () => {
  it.each([
    ["푸시 알림 구현\n게시판 기능 구현", ["푸시 알림 구현", "게시판 기능 구현"]],
    ["", []],
    ["  푸시 알림 구현  \n\n  ", ["푸시 알림 구현"]],
    // 디자인 placeholder처럼 한 문장을 쓰면 항목 하나입니다. 쉼표로 나누지 않습니다.
    ["실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다.", ["실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다."]],
  ])("입력 있음·없음·일부 상태를 줄 단위 목록으로 파싱한다", (value, expected) => {
    expect(parseContributionItems(value)).toEqual(expected);
  });
});

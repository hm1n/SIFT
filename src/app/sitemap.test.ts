import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/copy/shell";
import sitemap from "./sitemap";

describe("sitemap", () => {
  it("수집 대상 세 주소를 기준 도메인의 절대 주소로 싣는다", () => {
    expect(sitemap().map((entry) => entry.url)).toEqual([
      SITE_URL,
      `${SITE_URL}/privacy`,
      `${SITE_URL}/terms`,
    ]);
  });

  /** `/api` 아래는 화면이 아니고 부작용이 있는 경로가 섞여 있습니다. `robots.ts`도 같이 막습니다. */
  it("API 경로를 싣지 않는다", () => {
    expect(sitemap().some((entry) => entry.url.includes("/api"))).toBe(false);
  });

  /**
   * 배포할 때마다 바뀌는 값을 넣으면 내용이 그대로인 문서까지 갱신되었다고 알립니다. 넣지 않기로
   * 한 결정이라 실수로 되살아나지 않게 확인합니다.
   */
  it("lastModified를 넣지 않는다", () => {
    for (const entry of sitemap()) expect(entry.lastModified).toBeUndefined();
  });
});

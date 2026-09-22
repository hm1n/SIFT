import { describe, expect, it } from "vitest";
import { SITE_URL } from "@/copy/shell";
import robots from "./robots";
import sitemap from "./sitemap";

describe("robots", () => {
  it("모든 수집기에 `/`를 열고 `/api` 아래를 막는다", () => {
    expect(robots().rules).toEqual({ userAgent: "*", allow: "/", disallow: "/api/" });
  });

  it("sitemap 주소를 함께 알린다", () => {
    expect(robots().sitemap).toBe(`${SITE_URL}/sitemap.xml`);
  });

  /**
   * 두 파일이 같은 기준 도메인을 봐야 합니다. 한쪽만 도메인이 바뀌면 수집기가 robots.txt에서 받은
   * 주소로 갔다가 다른 도메인의 목록을 읽습니다.
   */
  it("sitemap이 싣는 주소와 같은 도메인을 가리킨다", () => {
    const declared = new URL(String(robots().sitemap));
    for (const entry of sitemap()) expect(new URL(entry.url).origin).toBe(declared.origin);
  });
});

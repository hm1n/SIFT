import type { MetadataRoute } from "next";
import { SITE_URL } from "@/copy/shell";

/**
 * 수집 규칙입니다(이슈 #149). `/robots.txt`로 나갑니다.
 *
 * `/api` 아래를 막습니다. 화면이 아니라 응답이고, OAuth 로그인·콜백과 세션 삭제처럼 부작용이 있는
 * 경로가 그 아래 있습니다. 수집기가 밟아서 좋을 것이 없습니다.
 *
 * 막는 것이 곧 감추는 것은 아닙니다. robots.txt는 권한 장치가 아니라 요청입니다. 접근 제어는 각
 * 라우트의 세션 검사가 합니다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

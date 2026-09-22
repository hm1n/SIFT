import type { MetadataRoute } from "next";
import { SITE_URL } from "@/copy/shell";

/**
 * 검색엔진이 수집할 주소 목록입니다(이슈 #149). `/sitemap.xml`로 나갑니다.
 *
 * 셋뿐입니다. 로그인해야 닿는 화면은 주소가 `/` 하나이고 그 안에서 갈리므로 따로 실을 것이 없고,
 * `/api` 아래는 화면이 아닙니다.
 *
 * `lastModified`를 넣지 않습니다. 넣으려면 값이 필요한데, `new Date()`는 배포할 때마다 바뀌어
 * 내용이 그대로인 문서까지 갱신되었다고 알립니다. 실제 갱신일을 손으로 적는 방법은 문서를 고칠 때
 * 같이 고쳐야 하는 자리를 하나 더 만듭니다. 세 페이지짜리 사이트에서 둘 다 값보다 비용이 큽니다.
 *
 * 우선순위는 `/`를 1로 두고 법적 고지 두 문서를 낮춥니다. 같은 사이트 안에서의 상대적인 중요도라
 * 검색 순위와는 무관합니다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, changeFrequency: "monthly", priority: 1 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${SITE_URL}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}

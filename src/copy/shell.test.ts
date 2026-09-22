import { describe, expect, it } from "vitest";
import { DOCUMENT_COPY, LEGAL_PAGE_METADATA, SITE_URL } from "./shell";

/**
 * 검색 노출 설정입니다(이슈 #149).
 *
 * `layout.tsx`가 아니라 이 상수를 봅니다. layout은 `next/font/google`을 부르고 서버 전용 API를
 * 쓰므로 테스트에서 그대로 읽을 수 없습니다. 값이 여기 있으면 검사할 자리가 하나로 모입니다.
 */
describe("문서 metadata", () => {
  it("metadataBase가 기준 도메인이다", () => {
    expect(DOCUMENT_COPY.metadataBase.origin).toBe(SITE_URL);
  });

  it("`/`의 canonical과 Open Graph url이 루트를 가리킨다", () => {
    expect(DOCUMENT_COPY.alternates.canonical).toBe("/");
    expect(DOCUMENT_COPY.openGraph.url).toBe("/");
  });

  it("Open Graph와 Twitter Card가 문서 제목과 설명을 그대로 쓴다", () => {
    expect(DOCUMENT_COPY.openGraph.title).toBe(DOCUMENT_COPY.title);
    expect(DOCUMENT_COPY.openGraph.description).toBe(DOCUMENT_COPY.description);
    expect(DOCUMENT_COPY.twitter.title).toBe(DOCUMENT_COPY.title);
    expect(DOCUMENT_COPY.twitter.description).toBe(DOCUMENT_COPY.description);
    expect(DOCUMENT_COPY.twitter.card).toBe("summary_large_image");
  });

  it("한국어 사이트임을 Open Graph에 밝힌다", () => {
    expect(DOCUMENT_COPY.openGraph.locale).toBe("ko_KR");
    expect(DOCUMENT_COPY.openGraph.type).toBe("website");
  });
});

/**
 * 자식 화면이 `openGraph`나 `alternates`를 정의하지 않으면 루트 값을 통째로 물려받습니다.
 * 그래서 두 문서가 각자의 값을 들어야 합니다. 물려받으면 두 문서를 공유했을 때 랜딩의 제목이
 * 나가고, 검색엔진이 세 주소를 모두 `/`의 사본으로 읽습니다.
 */
describe("법적 고지 화면 metadata", () => {
  it.each([
    ["privacy", "/privacy"],
    ["terms", "/terms"],
  ] as const)("%s는 자기 경로를 canonical로 쓴다", (key, path) => {
    expect(LEGAL_PAGE_METADATA[key].alternates.canonical).toBe(path);
    expect(LEGAL_PAGE_METADATA[key].openGraph.url).toBe(path);
  });

  it.each(["privacy", "terms"] as const)("%s의 Open Graph 제목과 설명이 자기 것이다", (key) => {
    const page = LEGAL_PAGE_METADATA[key];
    expect(page.openGraph.title).toBe(page.title);
    expect(page.openGraph.description).toBe(page.description);
    expect(page.title).not.toBe(DOCUMENT_COPY.title);
  });

  it("세 화면의 canonical이 서로 다르다", () => {
    const canonicals = [
      DOCUMENT_COPY.alternates.canonical,
      LEGAL_PAGE_METADATA.privacy.alternates.canonical,
      LEGAL_PAGE_METADATA.terms.alternates.canonical,
    ];
    expect(new Set(canonicals).size).toBe(canonicals.length);
  });
});

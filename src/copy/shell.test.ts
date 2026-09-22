import { readFileSync } from "node:fs";
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
 * 공유 미리보기 이미지입니다.
 *
 * `src/app/opengraph-image.png` 파일 규약을 쓰지 않아 가로·세로를 손으로 적습니다. 규약이 하던 일을
 * 사람이 하므로 실제 파일과 어긋날 수 있고, 어긋나면 플랫폼이 잘린 카드를 그립니다. 그래서 선언한
 * 값을 파일에서 읽은 값과 맞춥니다.
 */
describe("Open Graph 이미지", () => {
  const [image] = DOCUMENT_COPY.openGraph.images;

  /** PNG의 IHDR은 항상 첫 청크이고 가로·세로가 16바이트와 20바이트에 있습니다. */
  function pngSize(path: string): { width: number; height: number } {
    const bytes = readFileSync(path);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect(bytes.subarray(12, 16).toString()).toBe("IHDR");
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }

  it("선언한 크기가 실제 파일의 크기와 같다", () => {
    const actual = pngSize(`public${image.url}`);
    expect({ width: image.width, height: image.height }).toEqual(actual);
  });

  /**
   * 카드가 큰 이미지로 그려지는 최소 폭이 1200입니다. 그보다 작으면 `summary_large_image`를 걸어도
   * 작은 정사각 카드로 떨어집니다.
   */
  it("큰 카드로 그려지는 가로 폭과 비율을 만족한다", () => {
    expect(image.width).toBeGreaterThanOrEqual(1200);
    expect(image.width / image.height).toBeCloseTo(1200 / 630, 1);
  });

  it("대체 텍스트가 있다", () => {
    expect(image.alt.length).toBeGreaterThan(0);
  });

  /** 이미지가 없는 화면이 생기면 그 화면만 미리보기 카드가 비어 보입니다. */
  it("세 화면이 모두 같은 이미지를 가리킨다", () => {
    for (const page of [DOCUMENT_COPY, LEGAL_PAGE_METADATA.privacy, LEGAL_PAGE_METADATA.terms]) {
      expect(page.openGraph.images[0].url).toBe(image.url);
      expect(page.twitter.images).toEqual([image.url]);
    }
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

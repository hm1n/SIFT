import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 브라우저 탭 아이콘입니다. `src/app/icon.svg`와 `src/app/favicon.ico` 두 파일이고 Next의 파일 규약이
 * `<head>`에 링크를 만듭니다.
 *
 * 두 파일 모두 화면 로고 `SiftMark`에서 나왔습니다. 갈라져도 화면은 멀쩡하고 빌드도 통과해서, 탭을
 * 직접 보지 않으면 드러나지 않습니다. 그래서 여기서 대조합니다.
 */
const CIRCLE = /<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" opacity="([\d.]+)"\s*\/>/g;

/** 파일에서 원을 뽑아 비교할 수 있는 문자열로 만듭니다. JSX와 SVG의 문법 차이를 여기서 지웁니다. */
function circles(path: string): string[] {
  const source = readFileSync(path, "utf8");
  return [...source.matchAll(CIRCLE)].map(([, cx, cy, r, opacity]) => `${cx} ${cy} ${r} ${opacity}`);
}

describe("탭 아이콘", () => {
  it("icon.svg의 점이 화면 로고와 같다", () => {
    const logo = circles("src/components/shell/sift-mark.tsx");
    expect(logo).toHaveLength(25);
    expect(circles("src/app/icon.svg")).toEqual(logo);
  });

  /**
   * ICO는 헤더 뒤에 크기별 이미지를 나열하는 컨테이너입니다. 크기가 하나뿐이면 브라우저가 늘리거나
   * 줄여서 쓰므로 탭에서 뭉갭니다. 세 크기가 들어 있는지 봅니다.
   */
  it("favicon.ico가 16·32·48 세 크기를 담는다", () => {
    const bytes = readFileSync("src/app/favicon.ico");
    expect(bytes.readUInt16LE(0)).toBe(0);
    /* 1이 아이콘, 2가 커서입니다. */
    expect(bytes.readUInt16LE(2)).toBe(1);

    const entries = Array.from({ length: bytes.readUInt16LE(4) }, (_, index) => {
      const at = 6 + 16 * index;
      /* 너비 자리의 0은 256을 뜻합니다. */
      return {
        width: bytes.readUInt8(at) || 256,
        length: bytes.readUInt32LE(at + 8),
        offset: bytes.readUInt32LE(at + 12),
      };
    });

    expect(entries.map((entry) => entry.width)).toEqual([16, 32, 48]);
    for (const entry of entries) {
      /* 항목을 PNG로 담았습니다. 헤더의 크기와 실제 데이터가 어긋나면 아이콘이 깨집니다. */
      expect(bytes.subarray(entry.offset + 1, entry.offset + 4).toString()).toBe("PNG");
      expect(entry.offset + entry.length).toBeLessThanOrEqual(bytes.length);
    }
  });
});

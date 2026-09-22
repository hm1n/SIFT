import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 푸터의 남은 횟수 안내가 읽히는 밝기인지 봅니다(이슈 #142, PR #151 리뷰 1라운드).
 *
 * 처음에 넣은 색은 디자인의 neutral-300을 그대로 옮긴 `--color-scrollbar`였고 흰 배경에서 대비가
 * 1.48:1이었습니다. 9px 글자라 사실상 보이지 않습니다. 이 저장소는 같은 이유로 amber-600을
 * amber-700으로, red-500을 red-600으로 이미 한 번씩 내렸습니다.
 *
 * 색 이름을 문자열로 비교하지 않고 대비를 실제로 계산합니다. 토큰을 다른 값으로 바꾸거나 토큰의
 * 정의가 밝아지면 그때도 걸립니다. jsdom은 색을 계산하지 않으므로 `scroll.test.ts`와 같이 렌더
 * 대신 소스를 읽습니다.
 */

const here = dirname(fileURLToPath(import.meta.url));
const moduleCss = readFileSync(join(here, "repository-select-screen.module.css"), "utf8");
const globalsCss = readFileSync(join(here, "../../app/globals.css"), "utf8");

/** WCAG 2.1의 상대 휘도입니다. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r, g, b] = channels.map((value) =>
    value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [brighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (brighter + 0.05) / (darker + 0.05);
}

/** `:root`에 선언된 토큰 값을 찾습니다. 토큰이 아니면 그대로 색으로 봅니다. */
function resolveColor(value: string): string {
  const token = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!token) return value.trim();
  const declared = new RegExp(`${token[1]}:\\s*(#[0-9a-f]{6})`, "i").exec(globalsCss);
  if (!declared) throw new Error(`${token[1]} 토큰을 globals.css에서 찾지 못했습니다.`);
  return declared[1];
}

function colorOf(className: string): string {
  const rule = new RegExp(`\\.${className} \\{([^}]*)\\}`).exec(moduleCss);
  if (!rule) throw new Error(`.${className} 규칙을 찾지 못했습니다.`);
  const color = /(?:^|\n)\s*color:\s*([^;]+);/.exec(rule[1]);
  if (!color) throw new Error(`.${className}에 color 선언이 없습니다.`);
  return resolveColor(color[1]);
}

describe("남은 분석 횟수 안내의 명암비", () => {
  /** 푸터 배경입니다. `.footer`가 `--color-card`를 씁니다. */
  const background = resolveColor("var(--color-card)");

  it.each([
    ["usage", "남은 횟수를 알리는 기본 상태"],
    ["usageExceeded", "상한에 닿았을 때"],
  ])("%s는 작은 글자 기준 4.5:1을 넘는다", (className) => {
    expect(contrast(colorOf(className), background)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * 스크롤바 토큰을 글자에 쓰지 않는지 함께 봅니다. 이 회귀가 났던 자리라, 대비 계산만 두면 값이
   * 우연히 통과하는 다른 흐린 토큰으로 다시 바뀔 수 있습니다.
   */
  it("스크롤바 토큰을 글자 색으로 쓰지 않는다", () => {
    expect(colorOf("usage")).not.toBe(resolveColor("var(--color-scrollbar)"));
  });
});

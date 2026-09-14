import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * CSS Module에 없는 클래스를 참조해도 조용히 넘어가는 것을 막습니다.
 *
 * `styles.visuallyHidden`처럼 정의되지 않은 이름을 쓰면 `undefined`가 나오고 `className={undefined}`는
 * 속성 자체를 지웁니다. 오류도 경고도 없고 타입도 통과합니다. 실제로 2026-09-14에 답변 칸 라벨과
 * 생성 중 표시의 대체 문장이 이 경로로 화면에 그대로 드러났습니다. 시각적으로 숨기려던 것이
 * 숨겨지지 않은 것이라 눈으로 보기 전에는 알 수 없었습니다.
 *
 * jsdom은 레이아웃을 계산하지 않아 "숨겨졌는지"를 렌더 테스트로 확인할 수 없습니다. 그래서 렌더 대신
 * 소스를 읽어 참조와 정의를 맞춰 봅니다.
 */

const SRC = dirname(fileURLToPath(import.meta.url));

/** `.className` 형태의 셀렉터에서 이름만 거둡니다. `:hover` 같은 의사 클래스는 대문자가 없어 걸러집니다. */
function definedClasses(cssPath: string): Set<string> {
  const text = readFileSync(cssPath, "utf8");
  return new Set(text.match(/\.[a-zA-Z][A-Za-z0-9_]*/g)?.map((name) => name.slice(1)) ?? []);
}

function componentFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return componentFiles(full);
    if (!entry.name.endsWith(".tsx") || entry.name.includes(".test.")) return [];
    return [full];
  });
}

describe("CSS Module 클래스 참조", () => {
  it("컴포넌트가 참조하는 이름이 모두 해당 모듈에 정의돼 있다", () => {
    const missing: string[] = [];
    const files = componentFiles(SRC);
    // 훑을 파일이 없으면 통과가 아니라 탐색이 깨진 것입니다.
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const importMatch = source.match(/import\s+styles\s+from\s+"(\.[^"]+\.module\.css)"/);
      if (!importMatch) continue;

      const defined = definedClasses(join(dirname(file), importMatch[1]));
      const used = new Set(source.match(/styles\.[A-Za-z0-9_]+/g)?.map((ref) => ref.slice(7)) ?? []);

      for (const name of used) {
        if (defined.has(name)) continue;
        missing.push(`${relative(SRC, file).split(sep).join(posix.sep)} -> styles.${name}`);
      }
    }

    expect(missing).toEqual([]);
  });
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

/**
 * `AppShell`은 높이를 확정해 내려주고 `.content`가 `overflow: hidden`으로 자릅니다. 이 두 선언이
 * 없으면 Repository가 많을 때 목록 아래쪽과 기여 섹션이 잘린 채 닿을 방법이 사라집니다(이슈 #135).
 *
 * jsdom은 레이아웃을 계산하지 않아 실제로 스크롤되는지는 렌더 테스트로 볼 수 없습니다.
 * `css-module-class-reference.test.ts`와 같이 렌더 대신 소스를 읽습니다. 브라우저 실측값과 수동
 * 확인 절차는 `llm-wiki/wiki/2026-09-11-Repository-목록-조회와-선택-화면.md` 8절에 있습니다.
 */
it("목록과 기여 섹션이 셸 높이 안에서 스크롤한다", () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "repository-select-screen.module.css"),
    "utf8",
  );

  expect(css).toMatch(/\.screen \{[^}]*min-height: 0/);
  expect(css).toMatch(/\.body \{[^}]*overflow-y: auto/);
});

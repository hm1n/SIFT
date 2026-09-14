import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff-patch";

describe("parsePatch", () => {
  it("hunk 헤더가 정한 자리부터 줄 번호를 센다", () => {
    const lines = parsePatch(["@@ -10,3 +10,4 @@", " keep", "-gone", "+added", " tail"].join("\n"));

    expect(lines.map((line) => [line.type, line.oldNumber, line.newNumber, line.content])).toEqual([
      ["meta", null, null, "@@ -10,3 +10,4 @@"],
      ["context", 10, 10, "keep"],
      ["del", 11, null, "gone"],
      ["add", null, 11, "added"],
      ["context", 12, 12, "tail"],
    ]);
  });

  it("hunk 헤더의 줄 수가 생략돼도 시작 번호를 읽는다", () => {
    const lines = parsePatch(["@@ -1 +1 @@", "-before", "+after"].join("\n"));

    expect(lines[1]).toMatchObject({ type: "del", oldNumber: 1 });
    expect(lines[2]).toMatchObject({ type: "add", newNumber: 1 });
  });

  it("hunk 헤더 뒤의 함수 이름을 붙여도 헤더로 읽는다", () => {
    const lines = parsePatch("@@ -5,2 +5,2 @@ export function parsePatch() {\n context");

    expect(lines[0].type).toBe("meta");
    expect(lines[1]).toMatchObject({ oldNumber: 5, newNumber: 5 });
  });

  it("hunk가 여러 개면 헤더마다 번호를 다시 잡는다", () => {
    const lines = parsePatch(
      ["@@ -1,1 +1,1 @@", " first", "@@ -40,1 +41,1 @@", " second"].join("\n")
    );

    expect(lines[1]).toMatchObject({ oldNumber: 1, newNumber: 1 });
    expect(lines[3]).toMatchObject({ oldNumber: 40, newNumber: 41 });
  });

  // 절단된 patch가 정상 입력입니다. 파싱에 실패해 빈 화면을 그리면 남은 diff마저 볼 수 없습니다.
  it("hunk 헤더 없이 시작하면 줄 번호를 null로 두고 줄은 모두 남긴다", () => {
    const lines = parsePatch([" context", "-gone", "+added"].join("\n"));

    expect(lines).toHaveLength(3);
    expect(lines.every((line) => line.oldNumber === null && line.newNumber === null)).toBe(true);
    expect(lines.map((line) => line.type)).toEqual(["context", "del", "add"]);
  });

  it("헤더가 뒤늦게 나오면 그 줄부터 번호를 센다", () => {
    const lines = parsePatch(["+orphan", "@@ -3,1 +4,1 @@", " context"].join("\n"));

    expect(lines[0]).toMatchObject({ type: "add", newNumber: null });
    expect(lines[2]).toMatchObject({ oldNumber: 3, newNumber: 4 });
  });

  // 접두어까지 잘려 나간 마지막 줄을 버리면 사용자가 보는 diff가 조용히 짧아집니다.
  it("접두어 없는 줄은 문맥 줄로 남긴다", () => {
    const lines = parsePatch(["@@ -1,1 +1,1 @@", "prefix-less remnant"].join("\n"));

    expect(lines[1]).toMatchObject({ type: "context", content: "prefix-less remnant" });
  });

  it("No newline 표시는 meta로 두고 줄 번호를 올리지 않는다", () => {
    const lines = parsePatch(
      ["@@ -1,1 +1,1 @@", "-old", "\\ No newline at end of file", "+new"].join("\n")
    );

    expect(lines[2]).toMatchObject({ type: "meta", oldNumber: null, newNumber: null });
    expect(lines[3]).toMatchObject({ type: "add", newNumber: 1 });
  });

  it("본문의 빈 문맥 줄을 빈 내용으로 남긴다", () => {
    const lines = parsePatch(["@@ -1,2 +1,2 @@", " ", " next"].join("\n"));

    expect(lines[1]).toMatchObject({ type: "context", content: "", oldNumber: 1 });
    expect(lines[2]).toMatchObject({ oldNumber: 2 });
  });

  it("마지막 개행이 만든 빈 줄은 세지 않는다", () => {
    expect(parsePatch("@@ -1,1 +1,1 @@\n+added\n")).toHaveLength(2);
  });

  it("빈 문자열은 빈 배열이다", () => {
    expect(parsePatch("")).toEqual([]);
  });
});

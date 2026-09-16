import { describe, expect, it } from "vitest";
import { turnsToSave } from "./turn";

const HISTORY = [
  { turnId: "t1", question: "질문 1", answer: "답변 1" },
  { turnId: "t2", question: "질문 2", answer: "답변 2" },
  { turnId: "t3", question: "질문 3", answer: "답변 3" },
];

describe("저장할 턴 고르기", () => {
  it("이번 턴의 질문과 답변만 두 줄로 편다", () => {
    expect(turnsToSave(HISTORY, ["t2"])).toEqual([
      { role: "question", text: "질문 2" },
      { role: "answer", text: "답변 2" },
    ]);
  });

  it("밀린 턴을 함께 담는다", () => {
    expect(turnsToSave(HISTORY, ["t1", "t3"]).map((message) => message.text)).toEqual([
      "질문 1",
      "답변 1",
      "질문 3",
      "답변 3",
    ]);
  });

  /**
   * 식별자 목록의 순서를 따르면 클라이언트가 순서를 잘못 보낼 때 저장된 대화의 앞뒤가 뒤바뀝니다.
   */
  it("식별자 목록의 순서가 아니라 이력에 실려 온 순서를 따른다", () => {
    expect(turnsToSave(HISTORY, ["t2", "t1", "t3"]).map((message) => message.text)).toEqual([
      "질문 1",
      "답변 1",
      "질문 2",
      "답변 2",
      "질문 3",
      "답변 3",
    ]);
  });

  it("이번 턴이 밀린 목록에도 있으면 한 번만 담는다", () => {
    expect(turnsToSave(HISTORY, ["t1", "t1"])).toHaveLength(2);
  });

  it("이력에 없는 턴은 담지 않는다", () => {
    expect(turnsToSave(HISTORY, ["없는턴", "t1"])).toHaveLength(2);
  });

  it("이력이 비어 있으면 담을 것이 없다", () => {
    expect(turnsToSave([], ["t1"])).toEqual([]);
  });
});

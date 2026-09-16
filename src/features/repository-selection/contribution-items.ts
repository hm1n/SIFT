// ponytail: 줄바꿈을 항목 경계로 고정합니다. 항목 안에 여러 줄 설명이 필요해질 때 구조화 입력으로 승격합니다.
// 디자인의 placeholder는 한 문장이라 한 문장이 항목 하나가 됩니다. 문장을 항목으로 풀어내는 일은 Stage A 쪽 후속입니다
// (`llm-wiki/wiki/2026-09-10-디자인-개편-후속-backlog.md`).
export function parseContributionItems(value: string): string[] {
  return value.split("\n").map((item) => item.trim()).filter(Boolean);
}

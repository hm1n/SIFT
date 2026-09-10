import { describe, expect, it } from "vitest";
import {
  buildBlockUpdatePrompt,
  BLOCK_MAX_BYTES,
  BLOCK_MAX_OUTPUT_TOKENS,
  BLOCK_UPDATE_PROMPT_VARIANT,
} from "./block-prompt";
import { evidenceSnapshotFixture } from "./question-fixture";
import { renderInterviewEvidencePrompt } from "./question-prompt";

describe("블록 갱신 프롬프트", () => {
  it("변형은 규칙의 문단 구분만 바꾸며 근거와 정정 답변을 보존한다", () => {
    const snapshot = evidenceSnapshotFixture();
    const input = { snapshot, kind: "result" as const, currentBlock: "30명 중 28명",
      question: "설문 원본이 있나요?", answer: "정정합니다. 설문을 하지 않았습니다." };
    const split = buildBlockUpdatePrompt({ ...input, variant: "split" });
    const merged = buildBlockUpdatePrompt({ ...input, variant: "merged" });
    expect(split.system.replaceAll("\n\n", " ")).toBe(merged.system);
    expect(split.evidence).toBe(renderInterviewEvidencePrompt(snapshot));
    expect(split.turn).toBe(merged.turn);
    expect(JSON.parse(split.turn)).toMatchObject({ answer: input.answer, currentBlock: input.currentBlock });
    expect(split.system).toContain("최신 답변이 앞선 내용을 정정하면");
    expect(split.system).toContain("확인 필요 표시는 서버가 source에서 계산");
    expect(BLOCK_MAX_OUTPUT_TOKENS).toBe(Math.floor(BLOCK_MAX_BYTES / 5));
  });

  it("변형을 생략하면 실측으로 확정한 merged 변형을 쓴다", () => {
    const snapshot = evidenceSnapshotFixture();
    const input = { snapshot, kind: "problem" as const, currentBlock: "", question: "q", answer: "a" };
    expect(BLOCK_UPDATE_PROMPT_VARIANT).toBe("merged");
    expect(buildBlockUpdatePrompt(input).system).toBe(
      buildBlockUpdatePrompt({ ...input, variant: "merged" }).system
    );
  });
});

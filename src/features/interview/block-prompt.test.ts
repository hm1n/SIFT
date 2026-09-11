import { describe, expect, it } from "vitest";
import {
  buildBlockUpdatePrompt,
  BLOCK_FORMAT_EXAMPLES,
  BLOCK_MAX_BYTES,
  BLOCK_MAX_OUTPUT_TOKENS,
  BLOCK_MAX_STATEMENTS,
  BLOCK_TARGET_BYTES,
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
    expect(split.system).toContain("정정하거나 철회하면 낡은 주장을 지웁니다");
    expect(split.system).toContain("확인 필요 표시는 서버가 인용에서 계산");
    expect(BLOCK_MAX_OUTPUT_TOKENS).toBe(Math.floor(BLOCK_MAX_BYTES / 5));
  });

  it("출력 계약은 문장마다 인용 배열이고 문장 수와 목표 분량은 예시에서 유도한다", () => {
    const { system } = buildBlockUpdatePrompt({
      snapshot: evidenceSnapshotFixture(), kind: "action", currentBlock: "", question: "q", answer: "a",
    });
    expect(system).toContain("{statements:[{text,citations:[{source,commitSha,filePath}]}],sufficient:boolean}");
    expect(system).toContain(`최대 ${BLOCK_MAX_STATEMENTS}개`);
    expect(BLOCK_MAX_STATEMENTS).toBe(2);
    const longest = Math.max(...Object.values(BLOCK_FORMAT_EXAMPLES).map((t) => Buffer.byteLength(t)));
    expect(BLOCK_TARGET_BYTES).toBe(longest);
    expect(BLOCK_TARGET_BYTES).toBeLessThan(BLOCK_MAX_BYTES);
    expect(system).toContain(`${BLOCK_TARGET_BYTES} UTF-8 바이트 안팎`);
    for (const example of Object.values(BLOCK_FORMAT_EXAMPLES)) expect(system).toContain(example);
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

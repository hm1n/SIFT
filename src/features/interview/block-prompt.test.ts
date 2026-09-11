import { describe, expect, it } from "vitest";
import { emptyExperienceBlockState } from "../experience-block/types";
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

const history = [
  { turnId: "t1", question: "상황은요?", answer: "화면이 비어 있었습니다." },
  { turnId: "t2", question: "설문 원본이 있나요?", answer: "정정합니다. 설문을 하지 않았습니다." },
];

describe("블록 갱신 프롬프트", () => {
  it("변형은 규칙의 문단 구분만 바꾸며 근거와 이력과 주장 상태를 그대로 싣는다", () => {
    const snapshot = evidenceSnapshotFixture();
    const state = emptyExperienceBlockState();
    const input = { snapshot, state, history, targetBlock: "result" as const, answerTurnId: "t2" };
    const split = buildBlockUpdatePrompt({ ...input, variant: "split" });
    const merged = buildBlockUpdatePrompt({ ...input, variant: "merged" });
    expect(split.system.replaceAll("\n\n", " ")).toBe(merged.system);
    expect(split.evidence).toBe(renderInterviewEvidencePrompt(snapshot));
    expect(split.turn).toBe(merged.turn);
    expect(JSON.parse(split.turn)).toMatchObject({ targetBlock: "result", answerTurnId: "t2", stateVersion: 0, history, claims: [] });
    expect(split.system).toContain("언급되지 않은 주장은 절대 지우지 않습니다");
    expect(split.system).toContain("확인 필요 표시는 서버가 출처에서 계산");
    expect(BLOCK_MAX_OUTPUT_TOKENS).toBe(Math.floor(BLOCK_MAX_BYTES / 5));
  });

  it("처리할 답변의 턴 ID가 이력에 없으면 조립하지 않는다. 최신 답변을 따로 싣지 않고 ID로 지정하기 때문이다", () => {
    expect(() => buildBlockUpdatePrompt({
      snapshot: evidenceSnapshotFixture(), state: emptyExperienceBlockState(), history, targetBlock: "problem", answerTurnId: "t9",
    })).toThrow("t9");
  });

  it("출력 계약은 주장 연산·표시 문장·평가이고 문장 수와 목표 분량은 예시에서 유도한다", () => {
    const { system } = buildBlockUpdatePrompt({
      snapshot: evidenceSnapshotFixture(), state: emptyExperienceBlockState(), history, targetBlock: "action", answerTurnId: "t1",
    });
    expect(system).toContain('{ops:[{op:"add"|"revise"|"retract"|"conflict"');
    expect(system).toContain("display:[{block,sentences:[{text,claimIds}]}]");
    expect(system).toContain("evaluation:[{block,sufficient,askable,reason}]");
    expect(system).toContain(`최대 ${BLOCK_MAX_STATEMENTS}개`);
    expect(BLOCK_MAX_STATEMENTS).toBe(2);
    const longest = Math.max(...Object.values(BLOCK_FORMAT_EXAMPLES).map((t) => Buffer.byteLength(t)));
    expect(BLOCK_TARGET_BYTES).toBe(longest);
    expect(BLOCK_TARGET_BYTES).toBeLessThan(BLOCK_MAX_BYTES);
    expect(system).toContain(`${BLOCK_TARGET_BYTES} UTF-8 바이트 안팎`);
    for (const example of Object.values(BLOCK_FORMAT_EXAMPLES)) expect(system).toContain(example);
  });

  it("변형을 생략하면 실측으로 확정한 merged 변형을 쓴다", () => {
    const input = { snapshot: evidenceSnapshotFixture(), state: emptyExperienceBlockState(), history, targetBlock: "problem" as const, answerTurnId: "t1" };
    expect(BLOCK_UPDATE_PROMPT_VARIANT).toBe("merged");
    expect(buildBlockUpdatePrompt(input).system).toBe(buildBlockUpdatePrompt({ ...input, variant: "merged" }).system);
  });
});

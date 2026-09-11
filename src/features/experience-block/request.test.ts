import { describe, expect, it } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES } from "@/features/interview/history";
import { CLAIMS_STATE_MAX_BYTES } from "./reducer";
import { emptyExperienceBlockState, type Claim, type ExperienceBlockState } from "./types";
import {
  EXPERIENCE_BLOCK_HISTORY_MAX_TURNS,
  parseExperienceBlockRequestBody,
} from "./request";

const snapshot = evidenceSnapshotFixture();

function turn(turnId: string, question = "질문", answer = "답변") {
  return { turnId, question, answer };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    snapshot,
    history: [turn("t1")],
    state: emptyExperienceBlockState(),
    targetBlock: "problem",
    answerTurnId: "t1",
    ...overrides,
  };
}

describe("parseExperienceBlockRequestBody", () => {
  it("계약을 지킨 요청을 받아들인다", () => {
    const result = parseExperienceBlockRequestBody(validBody());

    expect(result.ok).toBe(true);
  });

  it("근거 스냅샷이 어긋나면 invalid_request로 거절한다", () => {
    const result = parseExperienceBlockRequestBody(
      validBody({ snapshot: { ...snapshot, candidateSha: "abc" } })
    );

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("targetBlock이 네 블록 중 하나가 아니면 invalid_request로 거절한다", () => {
    const result = parseExperienceBlockRequestBody(validBody({ targetBlock: "unknown" }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("answerTurnId가 이력에 없으면 invalid_request로 거절한다", () => {
    const result = parseExperienceBlockRequestBody(validBody({ answerTurnId: "missing" }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("주장 상태의 display·evaluation에 블록 키가 빠지면 invalid_request로 거절한다", () => {
    // 리듀서가 `state.display[block]`류로 네 키 모두 있다고 가정하고 접근하므로, 하나라도 빠지면
    // 요청 단계에서 걸러야 리듀서가 undefined 접근으로 깨지지 않습니다.
    const state = emptyExperienceBlockState();
    const displayWithoutProblem = Object.fromEntries(
      Object.entries(state.display).filter(([block]) => block !== "problem")
    );
    const result = parseExperienceBlockRequestBody(
      validBody({ state: { ...state, display: displayWithoutProblem } })
    );

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("주장의 출처가 비어 있으면 invalid_request로 거절한다", () => {
    const claim: Claim = {
      id: "c1",
      block: "problem",
      text: "문장",
      sources: [],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = { ...emptyExperienceBlockState(), claims: [claim] };
    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it(`이력이 ${EXPERIENCE_BLOCK_HISTORY_MAX_TURNS}턴을 넘으면 history_too_large로 거절한다`, () => {
    const history = Array.from({ length: EXPERIENCE_BLOCK_HISTORY_MAX_TURNS + 1 }, (_, index) =>
      turn(`t${index + 1}`)
    );
    const result = parseExperienceBlockRequestBody(
      validBody({ history, answerTurnId: history.at(-1)!.turnId })
    );

    expect(result).toMatchObject({ ok: false, kind: "history_too_large" });
  });

  it("한 턴의 질문이나 답변이 항목 상한을 넘으면 history_too_large로 거절한다", () => {
    const oversizedAnswer = turn("t1", "질문", "a".repeat(INTERVIEW_HISTORY_ITEM_MAX_BYTES + 1));
    const result = parseExperienceBlockRequestBody(validBody({ history: [oversizedAnswer] }));

    expect(result).toMatchObject({ ok: false, kind: "history_too_large" });
  });

  it("주장 상태가 상한을 넘으면 claims_too_large로 거절한다", () => {
    const claim: Claim = {
      id: "c1",
      block: "problem",
      text: "가".repeat(CLAIMS_STATE_MAX_BYTES),
      sources: [{ source: "user" }],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = { ...emptyExperienceBlockState(), claims: [claim] };
    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "claims_too_large" });
  });
});

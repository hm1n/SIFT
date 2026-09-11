import { describe, expect, it } from "vitest";
import {
  evidenceSnapshotFixture,
  FIXTURE_REPRESENTATIVE_SHA,
} from "@/features/interview/question-fixture";
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
    const state: ExperienceBlockState = {
      ...emptyExperienceBlockState(),
      nextClaimSeq: 2,
      claims: [claim],
    };
    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "claims_too_large" });
  });

  // 아래 다섯 개는 Codex 리뷰(PR #104)가 지적한 "클라이언트가 보낸 state의 내부 무결성 미검증"
  // 묶음의 회귀 테스트입니다. `state`는 클라이언트가 보관하다 돌려보낸 값이라 신뢰할 수 없고,
  // 여기서 막지 않으면 검증된 적 없는 정보가 검증된 것처럼 화면에 표시될 수 있습니다.

  it("주장 ID가 중복되면 invalid_request로 거절한다", () => {
    const duplicate: Claim = {
      id: "c1",
      block: "problem",
      text: "문장1",
      sources: [{ source: "user" }],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = {
      ...emptyExperienceBlockState(),
      nextClaimSeq: 2,
      claims: [duplicate, { ...duplicate, block: "action", text: "문장2" }],
    };

    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("nextClaimSeq가 이미 쓰인 주장 ID 이하이면 invalid_request로 거절한다", () => {
    // 다음 add 연산이 배정하는 ID(`c${nextClaimSeq}`)가 기존 주장과 충돌하면 리듀서의 Map이
    // 조용히 덮어씁니다.
    const claim: Claim = {
      id: "c3",
      block: "problem",
      text: "문장",
      sources: [{ source: "user" }],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = {
      ...emptyExperienceBlockState(),
      nextClaimSeq: 3,
      claims: [claim],
    };

    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("저장소 출처의 커밋이 스냅샷에 없으면 invalid_request로 거절한다", () => {
    const claim: Claim = {
      id: "c1",
      block: "problem",
      text: "문장",
      sources: [{ source: "repository", commitSha: "f".repeat(40), filePath: null }],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = {
      ...emptyExperienceBlockState(),
      nextClaimSeq: 2,
      claims: [claim],
    };

    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("저장소 출처가 스냅샷에 실재하면 받아들인다", () => {
    const claim: Claim = {
      id: "c1",
      block: "problem",
      text: "문장",
      sources: [{ source: "repository", commitSha: FIXTURE_REPRESENTATIVE_SHA, filePath: null }],
      status: "active",
      turnId: "t1",
    };
    const state: ExperienceBlockState = {
      ...emptyExperienceBlockState(),
      nextClaimSeq: 2,
      claims: [claim],
    };

    const result = parseExperienceBlockRequestBody(validBody({ state }));

    expect(result.ok).toBe(true);
  });

  it("표시 문장이 존재하지 않는 주장을 참조하면 invalid_request로 거절한다", () => {
    const state = emptyExperienceBlockState();
    const state2: ExperienceBlockState = {
      ...state,
      display: { ...state.display, problem: [{ text: "지어낸 문장", claimIds: ["없는-id"] }] },
    };

    const result = parseExperienceBlockRequestBody(validBody({ state: state2 }));

    expect(result).toMatchObject({ ok: false, kind: "invalid_request" });
  });
});

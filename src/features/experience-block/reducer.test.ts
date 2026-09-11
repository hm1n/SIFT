import { describe, expect, it } from "vitest";
import { evidenceSnapshotFixture, FIXTURE_RELATED_SHA, FIXTURE_REPRESENTATIVE_SHA } from "@/features/interview/question-fixture";
import { applyBlockUpdate, BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS, blockConflicts, CLAIMS_STATE_MAX_BYTES, markDisplay } from "./reducer";
import { BLOCK_KINDS, emptyExperienceBlockState, type BlockUpdateOutput, type ExperienceBlockState } from "./types";

const snapshot = evidenceSnapshotFixture();
const USER = { source: "user" as const };
const REPO = { source: "repository" as const, commitSha: FIXTURE_REPRESENTATIVE_SHA, filePath: "src/features/interview/sse.ts" };

function seeded(): ExperienceBlockState {
  const result = applyBlockUpdate(emptyExperienceBlockState(), {
    ops: [
      { op: "add", tempId: "a", block: "problem", text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠습니다.", sources: [USER] },
      { op: "add", tempId: "b", block: "problem", text: "매 턴 반복됐습니다.", sources: [USER] },
      { op: "add", tempId: "c", block: "action", text: "SSE done 이벤트의 seq를 비교합니다.", sources: [REPO] },
    ],
    display: [
      { block: "problem", sentences: [{ text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠고 매 턴 반복됐습니다.", claimIds: ["new:a", "new:b"] }] },
      { block: "action", sentences: [{ text: "done 이벤트의 seq를 비교해 완결을 판정했습니다.", claimIds: ["new:c"] }] },
    ],
    evaluation: [{ block: "problem", sufficient: true, askable: false, reason: "sufficient" }],
  } satisfies BlockUpdateOutput, { snapshot, turnId: "t1" });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.state;
}

describe("applyBlockUpdate", () => {
  it("추가한 주장에 순번 ID를 주고 같은 응답의 표시 문장이 new:tempId로 참조한다", () => {
    const state = seeded();
    expect(state.version).toBe(1);
    expect(state.claims.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(state.display.problem[0].claimIds).toEqual(["c1", "c2"]);
    expect(state.evaluation.problem).toEqual({ sufficient: true, askable: false, reason: "sufficient" });
    expect(state.evaluation.action).toBeNull();
  });

  it("빈 연산과 빈 표시는 삭제가 아니다. 기존 주장과 표시와 평가를 유지하고 버전만 올린다", () => {
    const state = seeded();
    const result = applyBlockUpdate(state, { ops: [], display: [], evaluation: [] }, { snapshot, turnId: "t2" });
    expect(result.ok && result.state).toMatchObject({ version: 2, claims: state.claims, display: state.display, evaluation: state.evaluation });
    expect(result.ok && result.affectedBlocks).toEqual([]);
  });

  it("언급되지 않은 주장은 유지되고 부분 정정은 대상 주장만 바꾼다", () => {
    const state = seeded();
    const result = applyBlockUpdate(state, {
      ops: [{ op: "retract", claimId: "c2" }],
      display: [{ block: "problem", sentences: [{ text: "화면이 비어 있어 대기와 실패를 구별하기 어려웠습니다.", claimIds: ["c1"] }] }],
      evaluation: [],
    }, { snapshot, turnId: "t2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.claims.find((c) => c.id === "c1")).toMatchObject({ status: "active", turnId: "t1" });
    expect(result.state.claims.find((c) => c.id === "c2")).toMatchObject({ status: "retracted", turnId: "t2" });
    expect(result.state.claims.find((c) => c.id === "c3")).toMatchObject({ status: "active" });
    expect(result.state.display.action).toEqual(state.display.action);
    expect(result.affectedBlocks).toEqual(["problem"]);
  });

  it("표시 문장이 있던 블록의 주장이 바뀌었는데 새 표시 문장이 없으면 거절하고, 표시가 비어 있던 블록은 주장만 쌓이는 것을 허용한다", () => {
    const result = applyBlockUpdate(seeded(), { ops: [{ op: "retract", claimId: "c2" }], display: [], evaluation: [] }, { snapshot, turnId: "t2" });
    expect(!result.ok && result.errors.map((e) => e.kind)).toEqual(["display_missing"]);
    const fresh = applyBlockUpdate(seeded(), {
      ops: [{ op: "add", tempId: "r", block: "result", text: "첫 조각이 바로 보였습니다.", sources: [USER] }], display: [], evaluation: [],
    }, { snapshot, turnId: "t2" });
    expect(fresh.ok && fresh.state.claims.some((c) => c.block === "result")).toBe(true);
    expect(fresh.ok && fresh.state.display.result).toEqual([]);
  });

  it("철회된 주장, 다른 블록의 주장, 없는 주장을 표시 문장이 참조하면 거절하고 상태를 바꾸지 않는다", () => {
    const state = seeded();
    const result = applyBlockUpdate(state, {
      ops: [{ op: "retract", claimId: "c2" }],
      display: [{ block: "problem", sentences: [{ text: "x", claimIds: ["c2", "c3", "c9", "new:zzz"] }] }],
      evaluation: [],
    }, { snapshot, turnId: "t2" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((e) => e.kind).sort()).toEqual(["claim_block_mismatch", "claim_not_active", "unknown_claim", "unknown_claim"]);
    expect(state.claims.find((c) => c.id === "c2")?.status).toBe("active");
  });

  it("미해소 충돌을 참조한 표시 문장은 그 문장만 빼고 경고로 남긴다. 응답 전체를 거절하지 않는다", () => {
    const result = applyBlockUpdate(seeded(), {
      ops: [{ op: "conflict", claimId: "c3", observation: "patch는 fetch 기반 수신입니다." }],
      display: [{ block: "action", sentences: [{ text: "EventSource로 받았습니다.", claimIds: ["c3"] }] }],
      evaluation: [],
    }, { snapshot, turnId: "t2" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.display.action).toEqual([]);
    expect(result.warnings.map((w) => w.kind)).toEqual(["conflicted_sentence_dropped"]);
    expect(result.state.claims.find((c) => c.id === "c3")?.status).toBe("conflicted");
  });

  it("철회된 주장을 다시 고치거나 철회하면 거절한다", () => {
    const state = seeded();
    const retracted = applyBlockUpdate(state, {
      ops: [{ op: "retract", claimId: "c2" }], display: [{ block: "problem", sentences: [] }], evaluation: [],
    }, { snapshot, turnId: "t2" });
    if (!retracted.ok) throw new Error("seed");
    const result = applyBlockUpdate(retracted.state, {
      ops: [{ op: "revise", claimId: "c2", text: "다시", sources: [USER] }], display: [{ block: "problem", sentences: [] }], evaluation: [],
    }, { snapshot, turnId: "t3" });
    expect(!result.ok && result.errors.map((e) => e.kind)).toEqual(["claim_not_active"]);
  });

  it("근거에 없는 커밋과 파일, 출처 없는 주장, 중복 임시 ID를 거절한다", () => {
    const result = applyBlockUpdate(emptyExperienceBlockState(), {
      ops: [
        { op: "add", tempId: "a", block: "action", text: "x", sources: [{ source: "repository", commitSha: "f".repeat(40), filePath: null }] },
        { op: "add", tempId: "b", block: "action", text: "y", sources: [{ source: "repository", commitSha: FIXTURE_RELATED_SHA, filePath: "src/nope.ts" }] },
        { op: "add", tempId: "c", block: "action", text: "z", sources: [] },
        { op: "add", tempId: "c", block: "action", text: "w", sources: [USER] },
      ],
      display: [{ block: "action", sentences: [] }],
      evaluation: [],
    }, { snapshot, turnId: "t1" });
    expect(!result.ok && result.errors.map((e) => e.kind)).toEqual(["unknown_commit", "unknown_file", "no_source", "duplicate_temp_id"]);
  });

  it("표시 문장 수 상한과 블록 바이트 상한, 참조 없는 문장을 거절한다", () => {
    const state = seeded();
    const long = "가".repeat(BLOCK_MAX_BYTES / 3 + 1);
    const result = applyBlockUpdate(state, {
      ops: [],
      display: [{ block: "problem", sentences: [
        { text: long, claimIds: ["c1"] }, { text: "b", claimIds: ["c1"] }, { text: "c", claimIds: [] },
      ] }],
      evaluation: [],
    }, { snapshot, turnId: "t2" });
    expect(BLOCK_MAX_STATEMENTS).toBe(2);
    expect(!result.ok && result.errors.map((e) => e.kind).sort()).toEqual(["block_too_large", "no_claim_reference", "too_many_statements"]);
  });

  it("sufficient와 reason이 어긋나거나 알 수 없는 사유면 거절한다", () => {
    const bad = (evaluation: unknown) => applyBlockUpdate(seeded(), { ops: [], display: [], evaluation: [evaluation] }, { snapshot, turnId: "t2" });
    expect(bad({ block: "result", sufficient: true, askable: false, reason: "askable" }).ok).toBe(false);
    expect(bad({ block: "result", sufficient: false, askable: false, reason: "sufficient" }).ok).toBe(false);
    expect(bad({ block: "result", sufficient: false, askable: false, reason: "maybe" }).ok).toBe(false);
    expect(bad({ block: "result", sufficient: false, askable: false, reason: "not_done" }).ok).toBe(true);
    expect(bad({ block: "result", sufficient: true, askable: false, reason: "none" }).ok).toBe(true);
  });

  it("주장 상태가 네 블록 상한을 넘으면 거절한다", () => {
    expect(CLAIMS_STATE_MAX_BYTES).toBe(BLOCK_KINDS.length * BLOCK_MAX_BYTES);
    const text = "가".repeat(Math.ceil(CLAIMS_STATE_MAX_BYTES / 3) + 1);
    const result = applyBlockUpdate(emptyExperienceBlockState(), {
      ops: [{ op: "add", tempId: "a", block: "problem", text, sources: [USER] }],
      display: [{ block: "problem", sentences: [] }], evaluation: [],
    }, { snapshot, turnId: "t1" });
    expect(!result.ok && result.errors[0].kind).toBe("claims_too_large");
  });
});

describe("markDisplay와 blockConflicts", () => {
  it("사용자 진술만 근거인 주장이 하나라도 있으면 그 문장에 표시가 붙고, 저장소 인용 하나로 검증된 것처럼 보이지 않는다", () => {
    const state = seeded();
    const result = applyBlockUpdate(state, {
      ops: [{ op: "add", tempId: "n", block: "action", text: "체감상 빨라졌습니다.", sources: [USER] }],
      display: [{ block: "action", sentences: [{ text: "seq를 비교해 판정했고 체감상 빨라졌습니다.", claimIds: ["c3", "new:n"] }] }],
      evaluation: [],
    }, { snapshot, turnId: "t2" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const marks = markDisplay(result.state, "action");
    expect(marks[0].userStatement).toBe(true);
    expect(marks[0].repositorySources).toEqual([REPO]);
    expect(markDisplay(state, "action")[0].userStatement).toBe(false);
  });

  it("충돌한 주장은 revise로 해소되어 다시 active가 되고 충돌 목록에서 빠진다. new: 참조로 같은 응답에 추가한 주장에도 충돌을 걸 수 있다", () => {
    const conflicted = applyBlockUpdate(seeded(), {
      ops: [
        { op: "add", tempId: "e", block: "action", text: "EventSource로 받았습니다.", sources: [USER] },
        { op: "conflict", claimId: "new:e", observation: "테스트 patch는 fetch 응답 객체를 씁니다." },
      ],
      display: [{ block: "action", sentences: [] }], evaluation: [],
    }, { snapshot, turnId: "t2" });
    if (!conflicted.ok) throw new Error(JSON.stringify(conflicted.errors));
    expect(conflicted.state.claims.find((c) => c.id === "c4")?.status).toBe("conflicted");
    expect(blockConflicts(conflicted.state, "action")).toHaveLength(1);
    const resolved = applyBlockUpdate(conflicted.state, {
      ops: [{ op: "revise", claimId: "c4", text: "fetch로 본문을 스트림으로 읽었습니다.", sources: [USER] }],
      display: [{ block: "action", sentences: [{ text: "fetch로 본문을 스트림으로 읽었습니다.", claimIds: ["c4"] }] }], evaluation: [],
    }, { snapshot, turnId: "t3" });
    if (!resolved.ok) throw new Error(JSON.stringify(resolved.errors));
    expect(resolved.state.claims.find((c) => c.id === "c4")?.status).toBe("active");
    expect(resolved.state.conflicts).toEqual([]);
    const twice = applyBlockUpdate(conflicted.state, {
      ops: [{ op: "conflict", claimId: "c4", observation: "다시" }], display: [{ block: "action", sentences: [] }], evaluation: [],
    }, { snapshot, turnId: "t3" });
    expect(!twice.ok && twice.errors.map((e) => e.kind)).toEqual(["claim_not_active"]);
  });

  it("충돌한 주장은 표시에서 빠지고 블록 밖 충돌 목록에 남는다", () => {
    const result = applyBlockUpdate(seeded(), {
      ops: [{ op: "conflict", claimId: "c3", observation: "patch에는 fetch 기반 수신만 보입니다." }],
      display: [{ block: "action", sentences: [] }],
      evaluation: [{ block: "action", sufficient: false, askable: true, reason: "askable" }],
    }, { snapshot, turnId: "t2" });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(blockConflicts(result.state, "action")).toEqual([{ claimId: "c3", observation: "patch에는 fetch 기반 수신만 보입니다.", turnId: "t2" }]);
    expect(blockConflicts(result.state, "problem")).toEqual([]);
    expect(result.state.display.action).toEqual([]);
  });
});

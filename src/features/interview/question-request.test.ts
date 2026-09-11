import { describe, expect, it } from "vitest";
import {
  evidenceSnapshotFixture,
  snapshotCommit,
  snapshotFile,
  FIXTURE_RELATED_SHA,
} from "./question-fixture";
import {
  INTERVIEW_HISTORY_ITEM_MAX_BYTES,
  INTERVIEW_HISTORY_MAX_ITEMS,
  INTERVIEW_LAST_OUTCOME_MAX_BYTES,
} from "./history";
import {
  INTERVIEW_STREAM_TARGET_META_BYTES,
  MAX_INTERVIEW_STREAM_BODY_BYTES,
  isExperienceEvidenceSnapshot,
  parseInterviewStreamRequestBody,
} from "./question-request";

describe("isExperienceEvidenceSnapshot", () => {
  it("스냅샷 계약을 지킨 값을 받아들인다", () => {
    expect(isExperienceEvidenceSnapshot(evidenceSnapshotFixture())).toBe(true);
  });

  it("JSON 왕복 뒤에도 받아들인다", () => {
    const roundTripped = JSON.parse(JSON.stringify(evidenceSnapshotFixture())) as unknown;

    expect(isExperienceEvidenceSnapshot(roundTripped)).toBe(true);
  });

  it("자리와 role이 어긋난 커밋을 거절한다", () => {
    // 대표 자리에 관련 커밋이 들어오면 프롬프트가 "대표 커밋"이라며 관계만 확인된 커밋을 싣습니다.
    const wrongRole = evidenceSnapshotFixture({
      representativeCommit: snapshotCommit({ role: "related" }),
    });
    const wrongRelated = evidenceSnapshotFixture({
      relatedCommits: [snapshotCommit({ sha: FIXTURE_RELATED_SHA, role: "representative" })],
    });

    expect(isExperienceEvidenceSnapshot(wrongRole)).toBe(false);
    expect(isExperienceEvidenceSnapshot(wrongRelated)).toBe(false);
  });

  it("후보 SHA와 대표 커밋 SHA가 다르면 거절한다", () => {
    const mismatched = evidenceSnapshotFixture({ candidateSha: "c".repeat(40) });

    expect(isExperienceEvidenceSnapshot(mismatched)).toBe(false);
  });

  it("patch 본문과 부재 사유가 함께 있거나 함께 없으면 거절한다", () => {
    const bothPresent = evidenceSnapshotFixture({
      representativeCommit: snapshotCommit({
        files: [snapshotFile({ patchOmittedReason: "not_provided" })],
      }),
    });
    const bothMissing = evidenceSnapshotFixture({
      representativeCommit: snapshotCommit({
        files: [snapshotFile({ patch: null, patchOmittedReason: null })],
      }),
    });

    expect(isExperienceEvidenceSnapshot(bothPresent)).toBe(false);
    expect(isExperienceEvidenceSnapshot(bothMissing)).toBe(false);
  });

  it("확인 수준이 빠진 항목을 거절한다", () => {
    const snapshot = evidenceSnapshotFixture();
    const withoutVerifiability = {
      ...snapshot,
      evidence: { text: snapshot.evidence.text },
    };

    expect(isExperienceEvidenceSnapshot(withoutVerifiability)).toBe(false);
  });

  it("SHA 형식과 origin, source를 확인한다", () => {
    expect(isExperienceEvidenceSnapshot(evidenceSnapshotFixture({ candidateSha: "abc" }))).toBe(false);
    expect(
      isExperienceEvidenceSnapshot({ ...evidenceSnapshotFixture(), origin: "manual" })
    ).toBe(false);
    expect(
      isExperienceEvidenceSnapshot({ ...evidenceSnapshotFixture(), source: "guess" })
    ).toBe(false);
  });

  it("숫자 자리에 음수나 실수가 오면 거절한다", () => {
    const negativeChanges = evidenceSnapshotFixture({
      representativeCommit: snapshotCommit({ files: [snapshotFile({ additions: -1 })] }),
    });

    expect(isExperienceEvidenceSnapshot(negativeChanges)).toBe(false);
  });

  it("객체가 아닌 값을 거절한다", () => {
    for (const value of [null, undefined, "snapshot", 1, []]) {
      expect(isExperienceEvidenceSnapshot(value)).toBe(false);
    }
  });
});

function historyPairs(pairs: number) {
  return Array.from({ length: pairs }, (_, index) => [
    { role: "question", text: `질문 ${index}` },
    { role: "answer", text: `답변 ${index}` },
  ]).flat();
}

describe("parseInterviewStreamRequestBody", () => {
  it("snapshot 키 안에 담긴 스냅샷만 받아들인다", () => {
    expect(parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture() }).ok).toBe(true);
    expect(parseInterviewStreamRequestBody(evidenceSnapshotFixture()).ok).toBe(false);
    expect(parseInterviewStreamRequestBody({}).ok).toBe(false);
  });

  it("history가 없으면 빈 이력으로 채운다", () => {
    // 첫 질문 요청은 지금까지처럼 history 없이 옵니다. 이 경로가 그대로 통과해야 합니다.
    const parsed = parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture() });

    expect(parsed).toMatchObject({ ok: true, body: { history: [] } });
  });

  it("질문으로 시작해 답변으로 끝나는 이력을 받아들인다", () => {
    const parsed = parseInterviewStreamRequestBody({
      snapshot: evidenceSnapshotFixture(),
      history: historyPairs(2),
    });

    expect(parsed).toMatchObject({ ok: true, body: { history: historyPairs(2) } });
  });

  it("마지막이 질문인 이력을 invalid_request로 거절한다", () => {
    const parsed = parseInterviewStreamRequestBody({
      snapshot: evidenceSnapshotFixture(),
      history: [...historyPairs(1), { role: "question", text: "질문 1" }],
    });

    expect(parsed).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("빈 본문과 역할이 이어지는 이력을 invalid_request로 거절한다", () => {
    for (const history of [
      [
        { role: "question", text: "질문 0" },
        { role: "answer", text: "" },
      ],
      [
        { role: "question", text: "질문 0" },
        { role: "question", text: "질문 1" },
      ],
    ]) {
      expect(
        parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture(), history })
      ).toMatchObject({ ok: false, kind: "invalid_request" });
    }
  });

  it("이력 항목이 아닌 값을 invalid_request로 거절한다", () => {
    for (const history of ["질문", [{ role: "user", text: "답변" }], [{ role: "answer" }]]) {
      expect(
        parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture(), history })
      ).toMatchObject({ ok: false, kind: "invalid_request" });
    }
  });

  it("항목 수 상한을 넘으면 history_too_large로 거절한다", () => {
    // 형식은 맞습니다. 대화를 줄이면 풀리므로 invalid_request와 갈라 놓습니다.
    const parsed = parseInterviewStreamRequestBody({
      snapshot: evidenceSnapshotFixture(),
      history: historyPairs(INTERVIEW_HISTORY_MAX_ITEMS / 2 + 1),
    });

    expect(parsed).toMatchObject({ ok: false, kind: "history_too_large" });
  });

  it("항목 하나가 바이트 상한을 넘으면 history_too_large로 거절한다", () => {
    const parsed = parseInterviewStreamRequestBody({
      snapshot: evidenceSnapshotFixture(),
      history: [
        { role: "question", text: "질문 0" },
        { role: "answer", text: "a".repeat(INTERVIEW_HISTORY_ITEM_MAX_BYTES + 1) },
      ],
    });

    expect(parsed).toMatchObject({ ok: false, kind: "history_too_large" });
  });

  it("targetBlock·targetElement가 없으면 대상 없는 일반 질문 요청으로 받아들인다", () => {
    const parsed = parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture() });

    expect(parsed.ok && parsed.body.targetBlock).toBeUndefined();
  });

  it("targetBlock과 targetElement를 함께 받으면 그대로 담는다", () => {
    const parsed = parseInterviewStreamRequestBody({
      snapshot: evidenceSnapshotFixture(),
      targetBlock: "problem",
      targetElement: "b",
    });

    expect(parsed).toMatchObject({ ok: true, body: { targetBlock: "problem", targetElement: "b" } });
  });

  it("targetBlock과 targetElement 중 하나만 있으면 invalid_request로 거절한다", () => {
    expect(
      parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture(), targetBlock: "problem" })
    ).toMatchObject({ ok: false, kind: "invalid_request" });
    expect(
      parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture(), targetElement: "a" })
    ).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  it("targetBlock이나 targetElement 값이 올바르지 않으면 invalid_request로 거절한다", () => {
    expect(
      parseInterviewStreamRequestBody({
        snapshot: evidenceSnapshotFixture(),
        targetBlock: "unknown",
        targetElement: "a",
      })
    ).toMatchObject({ ok: false, kind: "invalid_request" });
    expect(
      parseInterviewStreamRequestBody({
        snapshot: evidenceSnapshotFixture(),
        targetBlock: "problem",
        targetElement: "c",
      })
    ).toMatchObject({ ok: false, kind: "invalid_request" });
  });

  describe("lastOutcome (구현검토 2026-09-11 P1-5)", () => {
    it("lastOutcome이 없으면 대상 없는 요청으로 받아들인다", () => {
      const parsed = parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture() });
      expect(parsed.ok && parsed.body.lastOutcome).toBeUndefined();
    });

    it("올바른 lastOutcome은 그대로 담는다", () => {
      const lastOutcome = {
        blockUpdateFailed: true,
        targetResponse: null,
        conflicts: [{ observation: "근거는 fetch 기반 수신을 보여 줍니다." }],
      };
      const parsed = parseInterviewStreamRequestBody({ snapshot: evidenceSnapshotFixture(), lastOutcome });
      expect(parsed).toMatchObject({ ok: true, body: { lastOutcome } });
    });

    it("targetResponse가 알려진 값이 아니면 invalid_request로 거절한다", () => {
      const parsed = parseInterviewStreamRequestBody({
        snapshot: evidenceSnapshotFixture(),
        lastOutcome: { blockUpdateFailed: false, targetResponse: "made_up", conflicts: [] },
      });
      expect(parsed).toMatchObject({ ok: false, kind: "invalid_request" });
    });

    it("conflicts가 상한 개수를 넘으면 invalid_request로 거절한다", () => {
      const parsed = parseInterviewStreamRequestBody({
        snapshot: evidenceSnapshotFixture(),
        lastOutcome: {
          blockUpdateFailed: false,
          targetResponse: "provided",
          conflicts: Array.from({ length: 4 }, () => ({ observation: "a" })),
        },
      });
      expect(parsed).toMatchObject({ ok: false, kind: "invalid_request" });
    });

    it("conflicts 관찰 문장이 바이트 상한을 넘으면 invalid_request로 거절한다", () => {
      const parsed = parseInterviewStreamRequestBody({
        snapshot: evidenceSnapshotFixture(),
        lastOutcome: {
          blockUpdateFailed: false,
          targetResponse: "provided",
          conflicts: [{ observation: "가".repeat(100) }],
        },
      });
      expect(parsed).toMatchObject({ ok: false, kind: "invalid_request" });
    });
  });
});

describe("MAX_INTERVIEW_STREAM_BODY_BYTES", () => {
  it("근거 몫에 이력 몫과 대상 메타 몫, 직전 결과 몫을 더한 값이다", () => {
    // 근거 몫을 그대로 두고 더하기만 하므로 첫 질문 요청의 통과 여부가 바뀌지 않습니다.
    expect(MAX_INTERVIEW_STREAM_BODY_BYTES).toBe(
      64 * 1024 +
        INTERVIEW_HISTORY_MAX_ITEMS * INTERVIEW_HISTORY_ITEM_MAX_BYTES +
        INTERVIEW_STREAM_TARGET_META_BYTES +
        INTERVIEW_LAST_OUTCOME_MAX_BYTES
    );
  });
});

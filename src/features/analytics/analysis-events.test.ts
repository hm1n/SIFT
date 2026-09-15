import { describe, expect, it } from "vitest";
import type { AnalysisState, LoadingPhase } from "@/features/repository-analysis/repository-analysis";
import { advanceAnalysisTracker, createAnalysisTracker, type AnalysisTracker } from "./analysis-events";

const START = 1_000;

/** 금지 값이 파라미터에 실리는지 보려고 실제 모양의 식별 정보를 넣어 둡니다. */
const OWNER = "hm1n";
const REPO_NAME = "SIFT";
const SHA = "9f2c1ab4d5e6f70819283746455463728190abcd";
const FILE_PATH = "src/features/interview/interview-screen.tsx";
const COMMIT_MESSAGE = "fix: 스트리밍 중 스크롤이 튀는 문제";

function loading(phase: LoadingPhase): AnalysisState {
  return { status: "loading", loading: phase };
}

/**
 * 성공 상태입니다. 깊은 타입을 전부 채우는 대신 이 함수가 읽는 필드만 실제 모양으로 채우고
 * 나머지는 좁혀 둡니다. 계측이 보는 것은 후보 수와 상세 조회 커밋 수뿐입니다.
 */
function successState(includedCommitCount: number, candidateCount: number): AnalysisState {
  return {
    status: "success",
    data: {
      allCommits: [],
      includedCommits: Array.from({ length: includedCommitCount }, (_, index) => ({
        sha: `${SHA}${index}`,
        message: COMMIT_MESSAGE,
        files: [{ path: FILE_PATH }],
      })),
      repository: { fileTree: [], treeTruncated: false, languages: {} },
    },
    candidates: {
      candidates: Array.from({ length: candidateCount }, () => ({ sha: SHA, citedFilePaths: [FILE_PATH] })),
    },
    stageASelection: { excludedUnits: [], thresholdScore: 0, selectedUnitCount: 0, unjudgedShas: [] },
  } as unknown as AnalysisState;
}

function errorState(retryable: boolean): AnalysisState {
  return {
    status: "error",
    error: {
      kind: "llm_schema_violation",
      title: `Could not analyze ${OWNER}/${REPO_NAME}`,
      message: `The commit ${SHA} in ${FILE_PATH} was rejected.`,
      recovery: "retry",
    },
    ...(retryable
      ? { retryPoint: { repository: { owner: OWNER, repo: REPO_NAME }, contributionItems: [], data: {} } }
      : {}),
  } as unknown as AnalysisState;
}

/** 상태를 차례로 먹여 나온 이벤트를 모두 모읍니다. */
function run(states: readonly { state: AnalysisState; at: number }[], tracker = createAnalysisTracker(START)) {
  let current: AnalysisTracker = tracker;
  const events = states.flatMap(({ state, at }) => {
    const advanced = advanceAnalysisTracker(current, state, at);
    current = advanced.tracker;
    return advanced.events;
  });
  return { tracker: current, events };
}

describe("advanceAnalysisTracker", () => {
  it("첫 단계에 들어갈 때는 아직 끝난 단계가 없으므로 아무것도 보내지 않는다", () => {
    const { tracker, events } = run([{ state: loading({ step: "commits" }), at: START }]);
    expect(events).toEqual([]);
    expect(tracker.stage).toBe("commits");
  });

  /**
   * 이 스위트의 핵심입니다. 상세 조회는 커밋마다 진행률을 담아 상태를 갱신하므로, 상태 변화마다
   * 이벤트를 보내면 저장소 하나에 수백 건이 나갑니다.
   */
  it("같은 단계의 진행률 갱신은 몇 번이 와도 이벤트를 만들지 않는다", () => {
    const progress = Array.from({ length: 50 }, (_, index) => ({
      state: loading({ step: "details", completed: index, total: 50, phase: "commit_details" as const }),
      at: START + index,
    }));
    const { events } = run([{ state: loading({ step: "commits" }), at: START }, ...progress]);
    expect(events).toEqual([{ name: "analysis_stage_done", stage: "commits", duration_ms: 0 }]);
  });

  it("단계가 넘어갈 때마다 직전 단계의 소요 시간을 남긴다", () => {
    const { events } = run([
      { state: loading({ step: "commits" }), at: START },
      { state: loading({ step: "details", completed: 0, total: 3, phase: "commit_details" }), at: START + 100 },
      { state: loading({ step: "details", phase: "repository_metadata", completed: 3, total: 3 }), at: START + 400 },
      { state: loading({ step: "deriving" }), at: START + 450 },
      { state: loading({ step: "stage_a", total: 10 }), at: START + 460 },
      { state: loading({ step: "stage_b" }), at: START + 1_460 },
    ]);
    expect(events).toEqual([
      { name: "analysis_stage_done", stage: "commits", duration_ms: 100 },
      { name: "analysis_stage_done", stage: "commit_details", duration_ms: 300 },
      { name: "analysis_stage_done", stage: "repository_metadata", duration_ms: 50 },
      { name: "analysis_stage_done", stage: "deriving", duration_ms: 10 },
      { name: "analysis_stage_done", stage: "stage_a", duration_ms: 1_000 },
    ]);
  });

  it("성공하면 마지막 단계의 완료와 함께 분석 전체의 결과를 남긴다", () => {
    const { events } = run([
      { state: loading({ step: "stage_b" }), at: START },
      { state: successState(300, 3), at: START + 5_000 },
    ]);
    expect(events).toEqual([
      { name: "analysis_stage_done", stage: "stage_b", duration_ms: 5_000 },
      {
        name: "analysis_succeeded",
        candidate_count: 3,
        commit_count_bucket: "201-1000",
        duration_ms: 5_000,
      },
    ]);
  });

  /** 단계 자체는 끝났고 결과가 비어 있는 것이므로 그 단계의 완료도 함께 남깁니다. */
  it("빈 결과도 그 단계가 끝난 것으로 본다", () => {
    const { events } = run([
      { state: loading({ step: "commits" }), at: START },
      { state: { status: "empty", kind: "no_commits" }, at: START + 200 },
    ]);
    expect(events).toEqual([
      { name: "analysis_stage_done", stage: "commits", duration_ms: 200 },
      { name: "analysis_empty", empty_kind: "no_commits" },
    ]);
  });

  /** `no_final_candidates`는 `EmptyKind` 유니온 밖의 별도 상태라 빠뜨리기 쉽습니다. */
  it("no_final_candidates도 empty_kind로 실린다", () => {
    const { events } = run([
      { state: loading({ step: "stage_b" }), at: START },
      { state: { status: "empty", kind: "no_final_candidates", reason: "근거가 부족합니다." }, at: START + 10 },
    ]);
    expect(events).toContainEqual({ name: "analysis_empty", empty_kind: "no_final_candidates" });
  });

  /** 실패한 단계는 끝난 것이 아닙니다. 어디서 멈췄는지는 `analysis_failed`의 `stage`가 싣습니다. */
  it("실패하면 단계 완료를 보내지 않고 멈춘 단계를 실어 보낸다", () => {
    const { events } = run([
      { state: loading({ step: "stage_a", total: 10 }), at: START },
      { state: errorState(true), at: START + 3_000 },
    ]);
    expect(events).toEqual([
      {
        name: "analysis_failed",
        error_kind: "llm_schema_violation",
        recovery: "retry",
        stage: "stage_a",
      },
    ]);
  });

  it("단계에 들어가기 전에 실패하면 stage를 붙이지 않는다", () => {
    const { events } = run([{ state: errorState(false), at: START + 10 }]);
    expect(events).toEqual([
      { name: "analysis_failed", error_kind: "llm_schema_violation", recovery: "retry" },
    ]);
  });

  it("idle은 아무것도 만들지 않는다", () => {
    const { events } = run([{ state: { status: "idle" }, at: START }]);
    expect(events).toEqual([]);
  });

  /**
   * 이슈 #125의 제약입니다. 저장소 owner와 이름, 커밋 SHA, 커밋 메시지, 파일 경로를 보내지 않습니다.
   * 위 픽스처는 이 값들을 모두 담고 있으므로, 새 파라미터가 상태에서 값을 그대로 퍼 오면 여기서 걸립니다.
   */
  it("금지한 식별 정보를 어떤 파라미터에도 싣지 않는다", () => {
    const { events } = run([
      { state: loading({ step: "commits" }), at: START },
      { state: loading({ step: "stage_b" }), at: START + 10 },
      { state: successState(300, 3), at: START + 20 },
      { state: errorState(true), at: START + 30 },
    ]);
    const serialized = JSON.stringify(events);
    for (const forbidden of [OWNER, REPO_NAME, SHA, FILE_PATH, COMMIT_MESSAGE]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

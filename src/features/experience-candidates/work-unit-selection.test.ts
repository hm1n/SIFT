import { describe, expect, it } from "vitest";
import {
  MANY_COMMITS_THRESHOLD,
  MANY_FILES_THRESHOLD,
  type ScorableCommit,
} from "./work-unit-score";
import {
  STAGE_A_MAX_SELECTION_BYTES,
  WORK_UNIT_SELECTION_EXCLUSION_COPY,
  selectWorkUnitsForStageA,
} from "./work-unit-selection";
import { STAGE_A_MAX_PROMPT_BYTES } from "./stage-a";
import { renderWorkUnitSummary, summarizeWorkUnit } from "./work-unit-summary";
import type { WorkUnit } from "./work-unit";

function commit(overrides: Partial<ScorableCommit> = {}): ScorableCommit {
  return {
    sha: "sha",
    title: "feat: 기능 추가",
    message: "feat: 기능 추가",
    pullRequests: [],
    date: "2026-08-20T00:00:00Z",
    additions: 10,
    deletions: 5,
    files: [{ path: "src/index.ts", status: "modified", additions: 10, changes: 15 }],
    ...overrides,
  };
}

function unit(number: number, commits: readonly ScorableCommit[]): WorkUnit<ScorableCommit> {
  return {
    kind: "pull_request",
    unitId: `pr:${number}`,
    title: `제목 ${number}`,
    pullRequest: { number, title: `제목 ${number}`, state: "closed", baseBranch: "develop", headBranch: "f" },
    commits,
  };
}

/** 커밋 수와 파일 수로 점수를 올립니다. 신호 두 개가 붙으면 2점입니다. */
function scoredUnit(number: number, score: 0 | 1 | 2): WorkUnit<ScorableCommit> {
  const files = Array.from({ length: score >= 2 ? MANY_FILES_THRESHOLD + 1 : 1 }, (_, index) => ({
    path: `src/file-${index}.ts`,
    status: "modified" as const,
    additions: 1,
    changes: 2,
  }));
  const count = score >= 1 ? MANY_COMMITS_THRESHOLD + 1 : 1;
  return unit(number, Array.from({ length: count }, (_, index) =>
    commit({ sha: `sha-${number}-${index}`, files })));
}

/** 묶음 하나를 선별기와 같은 방식으로 렌더링해 정확한 바이트 크기를 구합니다. */
function unitBytes(target: WorkUnit<ScorableCommit>): number {
  return Buffer.byteLength(renderWorkUnitSummary(summarizeWorkUnit(target)), "utf8");
}

/** 0점 단일 커밋 단위입니다. 개수 상한 회귀 테스트에서 대량으로 만들어 씁니다. */
function zeroScoreCommitUnit(id: string): WorkUnit<ScorableCommit> {
  const sha = id.padStart(40, "0");
  return {
    kind: "commit",
    unitId: `commit:${sha}`,
    title: "fix: 오타 수정",
    commits: [commit({ sha, title: "fix: 오타 수정", message: "fix: 오타 수정" })],
  };
}

describe("selectWorkUnitsForStageA", () => {
  it("점수 높은 항목 다음이 예산에 안 들어가도 그 뒤 낮은 점수 항목은 계속 확인한다", () => {
    // 2026-09-11 이전에는 첫 무리가 선택된 뒤 예산이 막히면 이후 항목을 전부 개별 확인 없이
    // 제외했습니다. 이 테스트는 그 회귀를 재현합니다: 중간 점수(pr:2)는 못 들어가도 그보다
    // 작은 최하위 점수(pr:1)는 남은 예산에 들어가면 선택됩니다.
    const high = scoredUnit(3, 2);
    const mid = scoredUnit(2, 1);
    const low = scoredUnit(1, 0);
    const budget = unitBytes(high) + 1 + unitBytes(low);
    const selection = selectWorkUnitsForStageA([high, mid, low], budget);

    expect(selection.selected.map(({ unit: item }) => item.unitId)).toEqual(["pr:3", "pr:1"]);
    expect(selection.excluded.map(({ unit: item }) => item.unitId)).toEqual(["pr:2"]);
    expect(selection.excluded[0].reason).toBe("over_input_budget");
    expect(selection.thresholdScore).toBe(0);
  });

  it("어떤 묶음도 조용히 사라지지 않는다", () => {
    const units = [scoredUnit(1, 0), scoredUnit(2, 2), scoredUnit(3, 1), scoredUnit(4, 1)];
    const selection = selectWorkUnitsForStageA(units, 500);

    expect(selection.selected.length + selection.excluded.length).toBe(units.length);
    const seen = [...selection.selected, ...selection.excluded]
      .map(({ unit: item }) => item.unitId)
      .sort();
    expect(seen).toEqual(["pr:1", "pr:2", "pr:3", "pr:4"]);
  });

  it("동점 항목도 개별로 확인해 예산에 드는 만큼만 선택한다", () => {
    // 2026-09-11 이전에는 동점 무리 하나가 통째로 예산을 못 채우면 무리 전체를 제외했습니다.
    // `hm1n/Algorithm`에서 0점 434개가 이 규칙 때문에 한꺼번에 빠진 것과 같은 유형입니다. 이제는
    // 같은 점수라도 항목마다 개별로 검사해 예산에 드는 만큼(pr:2)은 선택하고 나머지(pr:3)만
    // 제외합니다.
    const units = [scoredUnit(1, 2), scoredUnit(2, 1), scoredUnit(3, 1)];
    const budget = unitBytes(units[0]) + 1 + unitBytes(units[1]);
    const selection = selectWorkUnitsForStageA(units, budget);

    expect(selection.selected.map(({ unit: item }) => item.unitId)).toEqual(["pr:1", "pr:2"]);
    expect(selection.excluded.map(({ unit: item }) => item.unitId)).toEqual(["pr:3"]);
    expect(selection.excluded[0].reason).toBe("over_input_budget");
  });

  it("동점 무리 하나가 예산을 넘으면 개별 항목 단위로 쪼갠다", () => {
    const units = [scoredUnit(1, 2), scoredUnit(2, 2), scoredUnit(3, 2)];
    const singleBytes = unitBytes(units[0]);
    const selection = selectWorkUnitsForStageA(units, singleBytes * 2 + 1);

    expect(selection.selected).toHaveLength(2);
    expect(selection.excluded).toHaveLength(1);
    // 이 묶음은 혼자서는 예산에 들어갑니다. 자리가 없어 밀린 것이므로 입력 상한 사유입니다.
    expect(selection.excluded[0].reason).toBe("over_input_budget");
  });

  /**
   * 두 상한이 어긋나면 선별 결과가 청크 둘로 갈리고, `candidate-client`의 청크 사이 대기가
   * 살아납니다. 그 61초는 Groq의 분당 토큰 창에서 나온 값이라 Gemini에서는 근거가 없고 사용자가
   * 이유 없이 1분을 기다립니다. 숫자를 두 파일에 적어 두었으므로 이 테스트가 어긋남을 잡습니다.
   */
  it("선별 예산이 청크 바이트 상한과 같다", () => {
    expect(STAGE_A_MAX_SELECTION_BYTES).toBe(STAGE_A_MAX_PROMPT_BYTES);
  });

  it("모든 묶음이 개별적으로 예산을 넘으면 억지로 남기지 않고 전부 제외한다", () => {
    // Codex 리뷰 P2-2 회귀 테스트입니다. 이전에는 selected가 비면 최고 점수 묶음을 무조건
    // 되살려 excluded에서 지웠고, 예산을 넘은 요청이 서버에 가서 422로 거부됐습니다.
    const units = [scoredUnit(1, 2), scoredUnit(2, 0)];
    const selection = selectWorkUnitsForStageA(units, 1);

    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toHaveLength(2);
    expect(selection.excluded.every(({ reason }) => reason === "over_byte_budget")).toBe(true);
    // 되살리며 excluded에서 지우던 회귀가 있었으므로 둘 다 그대로 남아 있는지 확인합니다.
    expect(selection.excluded.map(({ unit: item }) => item.unitId).sort()).toEqual(["pr:1", "pr:2"]);
    expect(selection.thresholdScore).toBe(0);
    expect(selection.bytes).toBe(0);
  });

  it("최고 점수 묶음이 예산을 넘고 다음 묶음은 넘지 않으면 다음 묶음을 선택한다", () => {
    const [highScore, lowScore] = [scoredUnit(1, 2), scoredUnit(2, 0)];
    // 낮은 점수 묶음 혼자는 들어가지만 높은 점수 묶음은 혼자서도 못 들어가는 예산을 고릅니다.
    const budget = unitBytes(lowScore);
    const selection = selectWorkUnitsForStageA([highScore, lowScore], budget);

    expect(selection.selected.map(({ unit: item }) => item.unitId)).toEqual(["pr:2"]);
    expect(selection.excluded.map(({ unit: item }) => item.unitId)).toEqual(["pr:1"]);
    expect(selection.excluded[0].reason).toBe("over_byte_budget");
  });

  it("빈 입력에서 빈 결과를 낸다", () => {
    const selection = selectWorkUnitsForStageA([], STAGE_A_MAX_SELECTION_BYTES);

    expect(selection.selected).toEqual([]);
    expect(selection.excluded).toEqual([]);
    expect(selection.bytes).toBe(0);
  });

  it("제외 사유마다 표시 문구가 있다", () => {
    expect(Object.values(WORK_UNIT_SELECTION_EXCLUSION_COPY).every((copy) => copy.length > 0)).toBe(true);
  });

  it("제외된 묶음은 발화한 신호를 함께 돌려준다", () => {
    // scoredUnit(3, 1)은 커밋 6개로만 1점을 얻어 many_commits 신호 하나만 발화시킵니다. 예산을
    // 최고 점수 항목 하나만 들어갈 크기로 잡아 pr:3이 확실히 제외되게 합니다.
    const units = [scoredUnit(1, 0), scoredUnit(2, 2), scoredUnit(3, 1)];
    const budget = unitBytes(units[1]);
    const selection = selectWorkUnitsForStageA(units, budget);

    const excludedThree = selection.excluded.find(({ unit: item }) => item.unitId === "pr:3");
    expect(excludedThree?.signals).toEqual(["many_commits"]);
  });

  it("동점 항목이 개수 상한을 넘으면 입력 순서대로 상한까지만 선택한다", () => {
    // `hm1n/Algorithm` 축소판입니다. 0점 커밋 20개 중 개수 상한 5개만 예산이 허용하면, 바이트
    // 예산이 충분해도 입력 순서상 앞의 5개만 선택되고 나머지는 개수 상한 사유로 제외됩니다.
    const units = Array.from({ length: 20 }, (_, index) => zeroScoreCommitUnit(String(index + 1)));
    const selection = selectWorkUnitsForStageA(units, STAGE_A_MAX_SELECTION_BYTES, 5);

    expect(selection.selected).toHaveLength(5);
    expect(selection.selected.map(({ unit: item }) => item.unitId)).toEqual(
      units.slice(0, 5).map((item) => item.unitId)
    );
    expect(selection.excluded).toHaveLength(15);
    expect(selection.excluded.every(({ reason }) => reason === "over_input_budget")).toBe(true);
  });

  it("전체 입력이 두 예산 안에 들어가면 종류와 점수에 관계없이 모두 선택한다", () => {
    const units: WorkUnit<ScorableCommit>[] = [
      scoredUnit(1, 2),
      zeroScoreCommitUnit("1"),
      scoredUnit(2, 0),
    ];
    const selection = selectWorkUnitsForStageA(units, STAGE_A_MAX_SELECTION_BYTES);

    expect(selection.selected).toHaveLength(3);
    expect(selection.excluded).toHaveLength(0);
  });

  it("같은 입력을 반복 실행하면 선택과 제외가 그대로 반복된다", () => {
    const units = [scoredUnit(1, 1), scoredUnit(2, 1), scoredUnit(3, 0)];
    const budget = unitBytes(units[0]) + 1 + unitBytes(units[1]);

    const first = selectWorkUnitsForStageA(units, budget);
    const second = selectWorkUnitsForStageA(units, budget);

    expect(second.selected.map(({ unit: item }) => item.unitId)).toEqual(
      first.selected.map(({ unit: item }) => item.unitId)
    );
    expect(second.excluded.map(({ unit: item }) => item.unitId)).toEqual(
      first.excluded.map(({ unit: item }) => item.unitId)
    );
  });

  it("동점 입력 순서를 바꾸면 예산 경계에서 선택 집합이 달라질 수 있다", () => {
    const [a, b] = [scoredUnit(1, 1), scoredUnit(2, 1)];
    const budget = unitBytes(a);

    const original = selectWorkUnitsForStageA([a, b], budget);
    const reversed = selectWorkUnitsForStageA([b, a], budget);

    expect(original.selected.map(({ unit: item }) => item.unitId)).toEqual(["pr:1"]);
    expect(reversed.selected.map(({ unit: item }) => item.unitId)).toEqual(["pr:2"]);
  });
});

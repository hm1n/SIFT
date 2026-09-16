import { describe, expect, it } from "vitest";
import { syntheticCommitSha, syntheticPullRequestUnitId } from "./synthetic-unit-id";
import { modelFacingUnitId } from "../src/features/experience-candidates/work-unit";

describe("syntheticCommitSha", () => {
  it("40자 hex SHA를 만든다", () => {
    const sha = syntheticCommitSha(1);
    expect(sha).toHaveLength(40);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("서로 다른 index는 모델 노출 식별자(SHA 앞 7자리)도 서로 다르다", () => {
    const ids = Array.from({ length: 50 }, (_, index) =>
      modelFacingUnitId(`commit:${syntheticCommitSha(index)}`)
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("syntheticPullRequestUnitId", () => {
  it("라운드가 달라도 pr:숫자 형식을 유지한다", () => {
    expect(syntheticPullRequestUnitId("pr:12", 1)).toMatch(/^pr:\d+$/);
    expect(syntheticPullRequestUnitId("pr:12", 2)).toMatch(/^pr:\d+$/);
  });

  it("라운드마다 서로 다른 번호를 만든다", () => {
    const ids = [1, 2, 3].map((round) => syntheticPullRequestUnitId("pr:12", round));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

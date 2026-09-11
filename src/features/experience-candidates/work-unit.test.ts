import { describe, expect, it } from "vitest";
import { groupCommitsIntoWorkUnits, type GroupableCommit, type WorkUnitPullRequest } from "./work-unit";

function pullRequest(number: number, title = `PR ${number}`): WorkUnitPullRequest {
  return { number, title, state: "closed", baseBranch: "develop", headBranch: `feature/${number}` };
}

function commit(sha: string, numbers: readonly number[], title = `${sha} 제목`): GroupableCommit {
  return { sha, title, pullRequests: numbers.map((number) => pullRequest(number)) };
}

describe("groupCommitsIntoWorkUnits", () => {
  it("빈 입력에 빈 배열을 반환한다", () => {
    expect(groupCommitsIntoWorkUnits([])).toEqual([]);
  });

  it("같은 Pull Request 커밋을 한 묶음으로 모은다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("a", [7]),
      commit("b", [7]),
      commit("c", [7]),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("pull_request");
    expect(result[0].unitId).toBe("pr:7");
    expect(result[0].commits.map(({ sha }) => sha)).toEqual(["a", "b", "c"]);
  });

  it("커밋이 입력에서 떨어져 있어도 같은 Pull Request면 한 묶음으로 모은다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("a", [7]),
      commit("b", [9]),
      commit("c", [7]),
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].commits.map(({ sha }) => sha)).toEqual(["a", "c"]);
    expect(result[1].commits.map(({ sha }) => sha)).toEqual(["b"]);
  });

  it("단위를 식별자가 처음 나타난 순서로 반환한다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("a", [30]),
      commit("b", [4]),
      commit("c", [12]),
    ]);

    expect(result.map(({ unitId }) => unitId)).toEqual(["pr:30", "pr:4", "pr:12"]);
  });

  it("묶음 안에서 입력 순서를 유지한다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("c", [1]),
      commit("a", [1]),
      commit("b", [1]),
    ]);

    expect(result[0].commits.map(({ sha }) => sha)).toEqual(["c", "a", "b"]);
  });

  it("커밋이 여러 Pull Request에 속하면 가장 작은 번호로 묶는다", () => {
    const result = groupCommitsIntoWorkUnits([commit("a", [42, 7, 19])]);

    expect(result).toHaveLength(1);
    expect(result[0].unitId).toBe("pr:7");
  });

  it("릴리스 Pull Request 번호가 함께 붙어도 기능 Pull Request로 나눈다", () => {
    // 기능 PR을 develop에 병합한 뒤 develop을 main으로 병합하면 모든 커밋에 릴리스 PR 번호가
    // 함께 붙습니다. 번호를 공유한다고 합치면 저장소 전체가 한 묶음이 됩니다.
    const result = groupCommitsIntoWorkUnits([
      commit("a", [10, 99]),
      commit("b", [10, 99]),
      commit("c", [20, 99]),
    ]);

    expect(result.map(({ unitId }) => unitId)).toEqual(["pr:10", "pr:20"]);
    expect(result[0].commits.map(({ sha }) => sha)).toEqual(["a", "b"]);
    expect(result[1].commits.map(({ sha }) => sha)).toEqual(["c"]);
  });

  it("가장 작은 번호의 Pull Request 메타데이터를 대표로 남긴다", () => {
    const result = groupCommitsIntoWorkUnits([
      { sha: "a", title: "제목", pullRequests: [pullRequest(9, "릴리스"), pullRequest(3, "기능")] },
    ]);

    expect(result[0].kind).toBe("pull_request");
    if (result[0].kind !== "pull_request") throw new Error("unreachable");
    expect(result[0].pullRequest).toEqual({
      number: 3,
      title: "기능",
      state: "closed",
      baseBranch: "develop",
      headBranch: "feature/3",
    });
    expect(result[0].title).toBe("기능");
  });

  it("Pull Request에 속하지 않은 커밋을 커밋 하나짜리 단위로 만든다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("a", [5]),
      commit("b", [], "직접 푸시한 커밋"),
    ]);

    expect(result).toHaveLength(2);
    expect(result[1].kind).toBe("commit");
    expect(result[1].unitId).toBe("commit:b");
    expect(result[1].title).toBe("직접 푸시한 커밋");
    expect(result[1].commits.map(({ sha }) => sha)).toEqual(["b"]);
  });

  it("모든 커밋이 Pull Request에 속하지 않으면 커밋마다 단위 하나씩 만든다", () => {
    const result = groupCommitsIntoWorkUnits([commit("a", []), commit("b", [])]);

    expect(result.map(({ unitId }) => unitId)).toEqual(["commit:a", "commit:b"]);
    expect(result.every((unit) => unit.kind === "commit")).toBe(true);
  });

  it("단위 순서가 입력 순서를 유지한다", () => {
    const result = groupCommitsIntoWorkUnits([
      commit("a", []),
      commit("b", [1]),
      commit("c", []),
    ]);

    expect(result.map(({ unitId }) => unitId)).toEqual(["commit:a", "pr:1", "commit:c"]);
  });

  it("입력 배열을 변경하지 않는다", () => {
    const commits = [commit("a", [1]), commit("b", [])];
    const snapshot = structuredClone(commits);

    groupCommitsIntoWorkUnits(commits);

    expect(commits).toEqual(snapshot);
  });

  it("상세 조회 결과의 추가 필드를 묶음 안에서 유지한다", () => {
    const detailed = { ...commit("a", [1]), additions: 10, files: [{ path: "src/index.ts" }] };

    const result = groupCommitsIntoWorkUnits([detailed]);

    expect(result[0].commits[0].additions).toBe(10);
    expect(result[0].commits[0].files).toEqual([{ path: "src/index.ts" }]);
  });
});

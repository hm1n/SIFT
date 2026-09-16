import { describe, expect, it } from "vitest";
import {
  collectEvidenceFiles,
  groupEvidenceFilesByDirectory,
  type EvidenceFile,
} from "./evidence-files";
import { snapshotCommit, snapshotFile } from "./question-fixture";

/** 묶기 테스트는 경로만 보므로 나머지 필드를 실제 스냅샷에서 유도하지 않고 직접 만듭니다. */
function fileAt(path: string): EvidenceFile {
  const boundary = path.lastIndexOf("/");
  return {
    path,
    directory: boundary === -1 ? "" : path.slice(0, boundary),
    filename: boundary === -1 ? path : path.slice(boundary + 1),
    additions: 0,
    deletions: 0,
    status: "modified",
    commits: [],
  };
}

describe("collectEvidenceFiles", () => {
  it("같은 경로가 여러 커밋에 있으면 한 파일로 합치고 커밋을 스냅샷 순서대로 싣는다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({
        sha: "a".repeat(40),
        files: [snapshotFile({ path: "src/a.ts", additions: 5, deletions: 2 })],
      }),
      snapshotCommit({
        sha: "b".repeat(40),
        role: "related",
        files: [snapshotFile({ path: "src/a.ts", additions: 3, deletions: 4 })],
      }),
    ]);

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/a.ts");
    expect(files[0].commits.map((commit) => commit.sha)).toEqual(["a".repeat(40), "b".repeat(40)]);
    expect(files[0].commits.map((commit) => commit.role)).toEqual(["representative", "related"]);
  });

  it("여러 커밋에 걸친 파일의 +/- 는 커밋별 값의 합이다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({ files: [snapshotFile({ path: "src/a.ts", additions: 5, deletions: 2 })] }),
      snapshotCommit({
        role: "related",
        files: [snapshotFile({ path: "src/a.ts", additions: 3, deletions: 4 })],
      }),
    ]);

    expect(files[0].additions).toBe(8);
    expect(files[0].deletions).toBe(6);
  });

  it("커밋이 하나면 그 커밋의 status를 쓰고 removed는 deleted로 좁힌다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({
        files: [
          snapshotFile({ path: "src/added.ts", status: "added" }),
          snapshotFile({ path: "src/gone.ts", status: "removed" }),
          snapshotFile({ path: "src/moved.ts", status: "renamed" }),
        ],
      }),
    ]);

    expect(files.map((file) => file.status)).toEqual(["added", "deleted", "modified"]);
  });

  // 스냅샷에 커밋 시간 순서가 없어 added 뒤 deleted인지 그 반대인지 재구성할 수 없습니다. 순서를
  // 모르는 채 한쪽을 고르면 실제와 어긋난 상태를 단정하게 됩니다.
  it("커밋이 둘 이상이면 어느 커밋이 added여도 modified로 둔다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({ files: [snapshotFile({ path: "src/a.ts", status: "added" })] }),
      snapshotCommit({
        role: "related",
        files: [snapshotFile({ path: "src/a.ts", status: "added" })],
      }),
    ]);

    expect(files[0].status).toBe("modified");
  });

  it("파일 순서는 대표 커밋부터 처음 등장한 차례를 따른다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({
        files: [snapshotFile({ path: "src/b.ts" }), snapshotFile({ path: "src/a.ts" })],
      }),
      snapshotCommit({
        role: "related",
        files: [snapshotFile({ path: "src/c.ts" }), snapshotFile({ path: "src/a.ts" })],
      }),
    ]);

    expect(files.map((file) => file.path)).toEqual(["src/b.ts", "src/a.ts", "src/c.ts"]);
  });

  it("커밋별 patch 본문과 절단 표시를 커밋 항목에 그대로 남긴다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({ files: [snapshotFile({ path: "src/a.ts", patch: "@@ -1 +1 @@" })] }),
      snapshotCommit({
        role: "related",
        files: [
          snapshotFile({
            path: "src/a.ts",
            patch: null,
            patchTruncated: true,
            patchOmittedReason: "budget_exhausted",
          }),
        ],
      }),
    ]);

    expect(files[0].commits[0].file.patch).toBe("@@ -1 +1 @@");
    expect(files[0].commits[1].file.patch).toBeNull();
    expect(files[0].commits[1].file.patchOmittedReason).toBe("budget_exhausted");
  });

  // 색인에서 못 찾은 커밋은 제목·메시지·PR을 확인할 수 없다는 사실을 diff 뷰어가 알려야 합니다.
  it("커밋의 색인 여부를 커밋 항목에 싣는다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({ indexed: false, title: null, message: null, files: [snapshotFile()] }),
    ]);

    expect(files[0].commits[0].indexed).toBe(false);
    expect(files[0].commits[0].title).toBeNull();
  });

  it("경로를 디렉터리와 파일명으로 나누고 루트 파일의 디렉터리는 빈 문자열이다", () => {
    const files = collectEvidenceFiles([
      snapshotCommit({
        files: [snapshotFile({ path: "src/features/a.ts" }), snapshotFile({ path: "README.md" })],
      }),
    ]);

    expect(files[0]).toMatchObject({ directory: "src/features", filename: "a.ts" });
    expect(files[1]).toMatchObject({ directory: "", filename: "README.md" });
  });

  it("변경 파일이 없는 커밋만 있으면 빈 배열이다", () => {
    expect(collectEvidenceFiles([snapshotCommit({ files: [] })])).toEqual([]);
  });
});

describe("groupEvidenceFilesByDirectory", () => {
  it("모든 디렉터리가 공유하는 앞 구간을 이름에서 덜어낸다", () => {
    const groups = groupEvidenceFilesByDirectory([
      fileAt("src/features/interview/sse.ts"),
      fileAt("src/features/experience-candidates/types.ts"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["interview", "experience-candidates"]);
    expect(groups[0].directory).toBe("src/features/interview");
  });

  // 전부 덜어내면 묶음 이름이 사라져 파일이 어디에 있는지 알 수 없습니다.
  it("한 디렉터리뿐이어도 마지막 세그먼트는 남긴다", () => {
    const groups = groupEvidenceFilesByDirectory([
      fileAt("src/features/interview/sse.ts"),
      fileAt("src/features/interview/history.ts"),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("interview");
  });

  it("공통 접두어가 없으면 디렉터리 이름을 그대로 쓴다", () => {
    const groups = groupEvidenceFilesByDirectory([fileAt("src/a.ts"), fileAt("docs/b.md")]);

    expect(groups.map((group) => group.label)).toEqual(["src", "docs"]);
  });

  it("루트 파일 묶음의 이름은 / 이고 공통 접두어 계산이 그 때문에 비지 않는다", () => {
    const groups = groupEvidenceFilesByDirectory([
      fileAt("README.md"),
      fileAt("src/features/a.ts"),
    ]);

    expect(groups.map((group) => group.label)).toEqual(["/", "src/features"]);
  });

  it("파일이 없으면 빈 배열이다", () => {
    expect(groupEvidenceFilesByDirectory([])).toEqual([]);
  });

  it("한 디렉터리의 파일들을 입력 순서대로 묶는다", () => {
    const groups = groupEvidenceFilesByDirectory([
      fileAt("src/a.ts"),
      fileAt("docs/b.md"),
      fileAt("src/c.ts"),
    ]);

    expect(groups[0].files.map((file) => file.path)).toEqual(["src/a.ts", "src/c.ts"]);
    expect(groups[1].files.map((file) => file.path)).toEqual(["docs/b.md"]);
  });
});

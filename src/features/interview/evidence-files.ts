import type {
  EvidenceCommitRole,
  EvidenceSnapshotCommit,
  EvidenceSnapshotFile,
} from "@/features/experience-candidates/types";

/**
 * 근거 스냅샷은 `커밋 → 파일` 구조인데 코드 패널은 `파일 → 커밋` 구조로 그립니다. 파일 트리에서
 * 파일 하나를 고르고 그 파일이 어느 커밋에서 어떻게 바뀌었는지 넘겨 보는 것이 이 패널의 조작이라,
 * 같은 경로가 대표 커밋과 관련 커밋에 흩어져 있으면 트리에 같은 이름이 여러 번 나옵니다.
 * 여기서 한 번 뒤집고 화면은 결과만 그립니다.
 */

/** 디자인의 파일 상태 표시 3종입니다. GitHub의 status 문자열을 여기에 맞춰 좁힙니다. */
export type EvidenceFileStatus = "added" | "modified" | "deleted";

/** 한 파일이 한 커밋에서 어떻게 바뀌었는지입니다. diff 뷰어가 커밋 선택기로 넘겨 보는 단위입니다. */
export interface EvidenceFileCommit {
  readonly sha: string;
  readonly role: EvidenceCommitRole;
  readonly title: string | null;
  readonly message: string | null;
  /** 그 커밋이 실어 온 이 파일의 변경입니다. patch 본문과 절단·부재 표시가 커밋마다 다릅니다. */
  readonly file: EvidenceSnapshotFile;
}

export interface EvidenceFile {
  readonly path: string;
  /** 경로에서 파일명을 뺀 부분입니다. 저장소 루트의 파일이면 빈 문자열입니다. */
  readonly directory: string;
  readonly filename: string;
  /** 이 파일이 등장하는 모든 커밋의 합입니다. 파일 행의 `+n / -n`이 이 값입니다. */
  readonly additions: number;
  readonly deletions: number;
  readonly status: EvidenceFileStatus;
  /** 스냅샷에 실린 순서, 즉 대표 커밋 먼저 그다음 관련 커밋 순입니다. */
  readonly commits: readonly EvidenceFileCommit[];
}

export interface EvidenceFileGroup {
  readonly directory: string;
  /** 공통 접두어를 덜어낸 표시용 이름입니다. 저장소 루트의 파일 묶음은 `/`입니다. */
  readonly label: string;
  readonly files: readonly EvidenceFile[];
}

/**
 * GitHub의 `status`는 added·removed·modified·renamed·copied·changed·unchanged를 씁니다. 디자인의
 * 표시는 셋뿐이라 나머지는 modified로 모읍니다. renamed와 copied를 added로 보내지 않는 이유는
 * 그 파일의 이전 경로를 스냅샷이 싣지 않아 새로 생긴 파일과 구분해 보여 줄 수단이 없기 때문입니다.
 */
function narrowStatus(status: string): EvidenceFileStatus {
  if (status === "added") return "added";
  if (status === "removed" || status === "deleted") return "deleted";
  return "modified";
}

interface MutableEvidenceFile extends Omit<EvidenceFile, "commits" | "additions" | "deletions" | "status"> {
  additions: number;
  deletions: number;
  status: EvidenceFileStatus;
  commits: EvidenceFileCommit[];
}

function splitPath(path: string): { directory: string; filename: string } {
  const boundary = path.lastIndexOf("/");
  return boundary === -1
    ? { directory: "", filename: path }
    : { directory: path.slice(0, boundary), filename: path.slice(boundary + 1) };
}

/**
 * 스냅샷의 커밋 목록을 파일 기준으로 뒤집습니다. 인자는 `[대표 커밋, ...관련 커밋]` 순으로 넘깁니다.
 * 결과 순서는 그 순서에서 파일이 처음 등장한 차례를 따릅니다.
 *
 * **여러 커밋에 걸친 파일의 상태는 modified로 둡니다.** 스냅샷에 커밋 시간 순서가 없어
 * (`EvidenceSnapshotCommit`에 날짜 필드가 없고 배열 순서는 역할 순서입니다) added 뒤에 deleted인지
 * 그 반대인지 재구성할 수 없습니다. 순서를 모르는 채 마지막 값을 고르면 실제와 어긋난 상태를
 * 단정하게 되므로, 커밋이 둘 이상이면 그 파일이 이 경험 안에서 수정되었다는 사실까지만 말합니다.
 */
export function collectEvidenceFiles(
  commits: readonly EvidenceSnapshotCommit[]
): readonly EvidenceFile[] {
  const byPath = new Map<string, MutableEvidenceFile>();

  for (const commit of commits) {
    for (const file of commit.files) {
      const entry: EvidenceFileCommit = {
        sha: commit.sha,
        role: commit.role,
        title: commit.title,
        message: commit.message,
        file,
      };
      const collected = byPath.get(file.path);
      if (collected === undefined) {
        byPath.set(file.path, {
          path: file.path,
          ...splitPath(file.path),
          additions: file.additions,
          deletions: file.deletions,
          status: narrowStatus(file.status),
          commits: [entry],
        });
        continue;
      }
      collected.additions += file.additions;
      collected.deletions += file.deletions;
      collected.status = "modified";
      collected.commits.push(entry);
    }
  }

  return [...byPath.values()];
}

/**
 * 모든 디렉터리가 공유하는 앞 구간의 길이(세그먼트 수)입니다. 마지막 한 세그먼트는 남깁니다.
 * 전부 덜어내면 디렉터리 묶음의 이름이 사라져 파일이 어디에 있는지 알 수 없습니다.
 */
function commonPrefixLength(directories: readonly string[]): number {
  const segmented = directories.map((directory) => (directory === "" ? [] : directory.split("/")));
  const limit = Math.max(0, Math.min(...segmented.map((segments) => segments.length)) - 1);
  let length = 0;
  while (length < limit && segmented.every((segments) => segments[length] === segmented[0][length])) {
    length += 1;
  }
  return length;
}

/**
 * 파일을 디렉터리로 묶고 디렉터리 이름에서 공통 접두어를 덜어냅니다. 300px 폭의 패널에서
 * `src/features/interview`처럼 모든 줄이 같은 글자로 시작하면 실제로 다른 부분이 잘려 나갑니다.
 *
 * 트리를 중첩시키지 않습니다. 한 경험의 근거에 실리는 파일은 수십 개 규모이고, 중첩 트리는 접힘
 * 상태를 깊이마다 따로 들고 있어야 합니다. 디자인도 디렉터리 한 겹만 그립니다.
 */
export function groupEvidenceFilesByDirectory(
  files: readonly EvidenceFile[]
): readonly EvidenceFileGroup[] {
  if (files.length === 0) return [];

  const byDirectory = new Map<string, EvidenceFile[]>();
  for (const file of files) {
    const collected = byDirectory.get(file.directory);
    if (collected === undefined) {
      byDirectory.set(file.directory, [file]);
      continue;
    }
    collected.push(file);
  }

  const prefixLength = commonPrefixLength([...byDirectory.keys()]);
  return [...byDirectory.entries()].map(([directory, grouped]) => ({
    directory,
    label: (directory === "" ? [] : directory.split("/")).slice(prefixLength).join("/") || "/",
    files: grouped,
  }));
}

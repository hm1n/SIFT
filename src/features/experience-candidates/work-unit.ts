import type { PullRequestReference } from "@/lib/github/types";

/**
 * 작업 단위를 대표하는 Pull Request입니다. `url`을 뺀 이유는 Stage A 입력에 링크가 필요하지
 * 않고, 화면 표시는 `ReadonlyCommitDetail`의 원본 `pullRequests`를 그대로 쓰기 때문입니다.
 */
export type WorkUnitPullRequest = Pick<
  PullRequestReference,
  "number" | "title" | "state" | "baseBranch" | "headBranch"
>;

/** 묶기에 필요한 최소 필드입니다. 이 계약만 만족하면 상세 조회 결과가 아니어도 묶을 수 있습니다. */
export interface GroupableCommit {
  readonly sha: string;
  readonly title: string;
  readonly pullRequests: readonly WorkUnitPullRequest[];
}

export type WorkUnitKind = "pull_request" | "commit";

interface WorkUnitBase<TCommit extends GroupableCommit> {
  /**
   * 판단 단위 하나를 가리키는 식별자입니다. Pull Request 묶음은 `pr:번호`, 단일 커밋은
   * `commit:SHA`입니다. `stage-b.ts`의 `resolveWorkUnitKey`가 이미 쓰던 형식을 그대로 물려받아
   * Stage A와 Stage B가 같은 식별자를 공유합니다.
   */
  readonly unitId: string;
  /** Pull Request 묶음은 PR 제목, 단일 커밋은 그 커밋의 제목입니다. */
  readonly title: string;
  /** 입력 순서를 유지합니다. 최소 1개입니다. */
  readonly commits: readonly TCommit[];
}

export interface PullRequestWorkUnit<TCommit extends GroupableCommit = GroupableCommit>
  extends WorkUnitBase<TCommit> {
  readonly kind: "pull_request";
  readonly pullRequest: WorkUnitPullRequest;
}

export interface CommitWorkUnit<TCommit extends GroupableCommit = GroupableCommit>
  extends WorkUnitBase<TCommit> {
  readonly kind: "commit";
}

/**
 * 경험 판단의 단위입니다. Stage A는 커밋이 아니라 이 단위를 판단합니다.
 *
 * Pull Request에 속한 커밋은 그 Pull Request 전체를 판단 단위로 묶습니다. 어떤 Pull Request는
 * 커밋 18개 중 8개가 파일명 대소문자 변경이어서 개별 커밋은 전부 잡무로 보이지만, 묶으면 배포
 * 실패를 하루 만에 해결한 경험이 됩니다. 근거는
 * `llm-wiki/wiki/2026-08-24-경험-판단단위-PR-묶음-전환-검토.md`에 있습니다.
 *
 * Pull Request에 속하지 않은 커밋은 커밋 하나를 판단 단위로 삼습니다. 시간 간격이나 파일 겹침
 * 같은 대체 묶음 규칙은 저장소마다 다른 조정값이 필요해 서비스 규칙으로 채택하지 않았습니다.
 * 근거는 `llm-wiki/wiki/2026-09-10-PR-없는-저장소-커밋-묶음-방식-실험.md` 6절에 있습니다.
 */
export type WorkUnit<TCommit extends GroupableCommit = GroupableCommit> =
  | PullRequestWorkUnit<TCommit>
  | CommitWorkUnit<TCommit>;

/**
 * 커밋이 여러 Pull Request에 속할 때 가장 작은 번호를 고릅니다.
 *
 * 번호를 공유하는 Pull Request를 전부 하나로 합치는 방식(union-find)은 쓰지 않습니다. 기능
 * Pull Request를 develop에 병합한 뒤 develop을 main으로 병합하는 저장소에서는 모든 커밋에
 * 릴리스 Pull Request 번호가 함께 붙습니다. 합치면 저장소 전체가 한 묶음이 됩니다. 파일 경로
 * 겹침으로 묶었을 때 319개 커밋 중 282개가 한 묶음이 된 것과 같은 붕괴입니다.
 *
 * 가장 작은 번호는 그 커밋을 처음 포함한 Pull Request입니다. 릴리스 Pull Request는 나중에
 * 생기므로 번호가 더 큽니다. 따라서 최소 번호를 고르면 기능 Pull Request가 선택됩니다.
 *
 * 확인 필요: `demian` 83커밋과 `andbread` 319커밋 모두 Pull Request가 2개 이상 붙은 커밋이
 * 0건이어서 이 규칙은 실데이터로 검증되지 않았습니다. 최소·최대·union-find 세 방식이 같은
 * 결과를 냅니다.
 */
function resolvePullRequest(commit: GroupableCommit): WorkUnitPullRequest | null {
  return commit.pullRequests.reduce<WorkUnitPullRequest | null>(
    (selected, pullRequest) =>
      selected === null || pullRequest.number < selected.number ? pullRequest : selected,
    null
  );
}

/**
 * 커밋을 판단 단위로 바꿉니다. LLM과 네트워크를 쓰지 않는 순수 함수입니다.
 *
 * Pull Request에 속한 커밋은 같은 Pull Request끼리 묶고, 속하지 않은 커밋은 커밋 하나가 곧
 * 판단 단위가 됩니다. 어느 커밋도 조용히 빠지지 않습니다.
 *
 * 단위 순서는 각 식별자가 입력에서 처음 나타난 순서입니다. 번호 순으로 정렬하지 않는 이유는
 * 호출자가 넘긴 커밋 순서(현재는 최신 순)를 단위 수준에서도 유지하기 위해서입니다. 점수 정렬은
 * 별도 단계가 맡습니다.
 */
export function groupCommitsIntoWorkUnits<TCommit extends GroupableCommit>(
  commits: readonly TCommit[]
): readonly WorkUnit<TCommit>[] {
  const unitsById = new Map<
    string,
    { pullRequest: WorkUnitPullRequest | null; commits: TCommit[] }
  >();
  const order: string[] = [];

  for (const commit of commits) {
    const pullRequest = resolvePullRequest(commit);
    const unitId = pullRequest ? `pr:${pullRequest.number}` : `commit:${commit.sha}`;
    const existing = unitsById.get(unitId);
    if (existing === undefined) {
      unitsById.set(unitId, { pullRequest, commits: [commit] });
      order.push(unitId);
      continue;
    }
    existing.commits.push(commit);
  }

  return order.map((unitId): WorkUnit<TCommit> => {
    const { pullRequest, commits: unitCommits } = unitsById.get(unitId)!;
    if (pullRequest === null) {
      return { kind: "commit", unitId, title: unitCommits[0].title, commits: unitCommits };
    }
    return {
      kind: "pull_request",
      unitId,
      title: pullRequest.title,
      pullRequest,
      commits: unitCommits,
    };
  });
}

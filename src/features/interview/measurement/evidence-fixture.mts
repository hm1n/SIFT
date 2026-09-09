/**
 * 측정 스크립트가 공유하는 근거 스냅샷 조립기입니다. 수동 실행 스크립트 전용이고 vitest 스위트에
 * 포함되지 않습니다.
 *
 * `followup-question-cost.measure.mts`가 갖고 있던 조립 절차를 그대로 옮겼습니다. 옮긴 이유는
 * 이슈 #79의 지연 측정이 같은 근거를 써야 하기 때문입니다. 스크립트마다 조립을 다시 쓰면 같은
 * PR을 가리키면서 서로 다른 입력을 재게 되고, 그 차이는 결과 표에 드러나지 않습니다.
 *
 * 합성 diff를 쓰지 않습니다. patch 몫과 실제 토큰의 관계는 실제 diff에서만 나옵니다.
 */

import { buildExperienceEvidenceSnapshot } from "../../experience-candidates/evidence-snapshot";
import type {
  CandidateDiff,
  ExperienceCandidateListItem,
  ExperienceEvidenceSnapshot,
  EvidenceSnapshotCommit,
  StageBCandidateResult,
} from "../../experience-candidates/types";
import { renderInterviewEvidencePrompt } from "../question-prompt";
import {
  GITHUB_API_BASE,
  classifyErrorResponse,
  githubFetch,
  parseJson,
  parseNextLink,
} from "../../../lib/github/commits";
import { GitHubFetchError } from "../../../lib/github/errors";
import { fetchCommitDetailBySha, withoutPatch } from "../../../lib/github/contributions";
import type { CandidateDataOutput, CommitDetail } from "../../../lib/github/types";

export interface EvidenceFixtureOptions {
  readonly owner: string;
  readonly repo: string;
  readonly token: string;
  /** PR에서 가져올 커밋 수 상한입니다. */
  readonly maxCommits: number;
  /** 근거 스냅샷 상한입니다. 운영 기본값은 5,250입니다. */
  readonly maxInputTokens: number;
}

/**
 * PR 커밋 SHA를 `maxCommits`개까지 모읍니다.
 *
 * **다음 페이지 링크를 따라갑니다.** 한 페이지는 최대 100개입니다. 따라가지 않으면
 * `maxCommits`가 100을 넘고 PR 커밋이 100개를 넘을 때 첫 페이지만 받고, 뒤의 `slice`가 요청한
 * 것보다 적은 커밋을 조용히 측정합니다. 측정값이 조용히 틀리면 그 값을 근거로 삼는 상수와 위키
 * 문서가 함께 틀립니다.
 *
 * 커서로 브랜치명을 쓰지 않고 GitHub이 준 Link 헤더를 그대로 따라갑니다.
 */
async function fetchPullRequestCommitShas(
  options: EvidenceFixtureOptions,
  pullRequestNumber: number
): Promise<string[]> {
  const perPage = Math.min(Math.max(options.maxCommits, 1), 100);
  let url: string | null =
    `${GITHUB_API_BASE}/repos/${options.owner}/${options.repo}/pulls/${pullRequestNumber}/commits?per_page=${perPage}`;
  const shas: string[] = [];
  while (url !== null && shas.length < options.maxCommits) {
    const page = await fetchCommitShaPage(options, url, pullRequestNumber);
    shas.push(...page.shas);
    url = page.next;
  }
  return shas;
}

interface CommitShaPage {
  readonly shas: string[];
  /** 다음 페이지 주소입니다. 마지막 페이지면 null입니다. */
  readonly next: string | null;
}

async function fetchCommitShaPage(
  options: EvidenceFixtureOptions,
  pageUrl: string,
  pullRequestNumber: number
): Promise<CommitShaPage> {
  const response = await githubFetch(pageUrl, options.token);
  if (!response.ok) {
    // status만 남기면 토큰 만료와 rate limit을 가릴 수 없어 기다릴지 자격 증명을 고칠지
    // 판단하지 못합니다. 저장소 분류기를 그대로 씁니다. 403의 1차와 2차 rate limit 판별이
    // 여기 들어 있습니다.
    const kind = await classifyErrorResponse(response);
    throw new GitHubFetchError(
      kind,
      `PR #${pullRequestNumber} 커밋 목록 조회 실패(${kind}): ${response.status}`
    );
  }
  const commits = await parseJson<{ sha: string }[]>(response, "PR 커밋 목록");
  return {
    shas: commits.map(({ sha }) => sha),
    // 빈 페이지에서 멈추지 않으면 링크가 남아 있는 한 계속 부릅니다.
    next: commits.length === 0 ? null : parseNextLink(response.headers.get("link")),
  };
}

function toDiff(detail: CommitDetail): CandidateDiff {
  return {
    sha: detail.sha,
    files: detail.files.map((file) => ({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      ...(file.patch === undefined ? {} : { patch: file.patch }),
    })),
  };
}

export async function buildSnapshot(
  options: EvidenceFixtureOptions,
  pullRequestNumber: number
): Promise<ExperienceEvidenceSnapshot> {
  const { owner, repo, token, maxCommits, maxInputTokens } = options;
  const shas = (await fetchPullRequestCommitShas(options, pullRequestNumber)).slice(0, maxCommits);
  if (shas.length === 0) throw new Error(`PR #${pullRequestNumber}에 커밋이 없습니다.`);

  const details: CommitDetail[] = [];
  for (const sha of shas) {
    details.push(await fetchCommitDetailBySha({ owner, repo, token }, sha));
  }

  const [representative, ...related] = details;
  const citedFilePaths = representative.files
    .slice()
    .sort((left, right) => right.changes - left.changes)
    .slice(0, 2)
    .map(({ path }) => path);
  const candidate = {
    sha: representative.sha,
    relatedShas: related.map(({ sha }) => sha),
    evidence: `Pull Request #${pullRequestNumber}의 커밋 ${details.length}개가 같은 문제를 함께 다뤘고, 변경 파일과 diff에서 판단 근거를 확인할 수 있습니다.`,
    citedFilePaths,
    source: "automatic_recommendation" as const,
  };
  const item: ExperienceCandidateListItem = {
    candidate,
    commit: withoutPatch(representative),
    origin: "repository",
    normalizedRelatedShas: candidate.relatedShas,
    normalizedCitedFilePaths: citedFilePaths,
  };
  const data: CandidateDataOutput = {
    allCommits: [],
    includedCommits: details.map(withoutPatch),
    repository: { fileTree: [], treeTruncated: false, languages: {} },
  };
  const candidates: StageBCandidateResult = {
    candidates: [candidate],
    insufficientCandidatesReason: null,
    diffs: details.map(toDiff),
  };
  const result = buildExperienceEvidenceSnapshot(
    item,
    data,
    candidates,
    maxInputTokens,
    renderInterviewEvidencePrompt
  );
  if (!result.ok) throw new Error(`PR #${pullRequestNumber} 스냅샷 조립 실패: ${result.reason}`);
  return result.snapshot;
}

/**
 * patch 본문만 걷어낸 축약 근거입니다. 커밋 제목·메시지·파일 목록·확인 수준은 그대로 둡니다.
 * 부재 사유를 `not_provided`로 두어 "본문 없음"과 본문이 함께 실리지 않게 합니다
 * (`question-request.ts`의 배타성 조건과 같은 규칙입니다).
 */
export function stripPatches(
  snapshot: ExperienceEvidenceSnapshot
): ExperienceEvidenceSnapshot {
  const strip = (commit: EvidenceSnapshotCommit): EvidenceSnapshotCommit => ({
    ...commit,
    files: commit.files.map((file) => ({
      ...file,
      patch: null,
      patchTruncated: false,
      patchOmittedReason: "not_provided" as const,
    })),
  });
  return {
    ...snapshot,
    representativeCommit: strip(snapshot.representativeCommit),
    relatedCommits: snapshot.relatedCommits.map(strip),
    patchBudget: { ...snapshot.patchBudget, patchBytes: 0, truncatedByBudget: false },
  };
}

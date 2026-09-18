import { GitHubFetchError, type GitHubFetchErrorKind } from "./errors";
import { isGitHubRateLimited } from "./rate-limit";
import type { CommitSummary, GitHubAuth } from "./types";

export const GITHUB_API_BASE = "https://api.github.com";
const PER_PAGE = 100;

export interface AuthoredCommitsCursor {
  headSha: string;
  page: number;
}

export interface AuthoredCommitsBatchResult extends AuthoredCommitsResult {
  cursor: AuthoredCommitsCursor | null;
}

interface RawCommit {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string } | null;
  };
  author: { login: string } | null;
  parents: Array<{ sha: string }>;
}

function githubHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function classifyErrorResponse(response: Response): Promise<GitHubFetchErrorKind> {
  if (response.status === 404) return "repo_not_found";
  if (response.status === 401) return "auth_revoked";
  if (response.status === 422) return "server_error";
  // 1차와 2차(secondary)를 함께 가립니다. 판별을 `rate-limit.ts`에 둔 이유는 그 파일 주석에 있습니다.
  if (await isGitHubRateLimited(response)) return "rate_limit";
  // 한도가 아닌 403은 권한 문제입니다. 한도를 다 놓치면 정상 유저가 인증 취소로 오분류됩니다.
  if (response.status === 403) return "auth_revoked";
  return "server_error";
}

/**
 * 전송 실패 한정 시도 횟수입니다. 실패 한 건이 undici의 연결 제한 10초를 쓰므로, commit-details의
 * maxDuration 60초 예산(정상 배치 약 17초) 안에 들도록 총 2회까지만 시도합니다.
 */
const GITHUB_FETCH_ATTEMPTS = 2;

/**
 * 재시도가 복구한 실패는 오류로도 사용자에게도 남지 않습니다. 개발 서버에서만 한 줄 남겨 조용히
 * 덮이지 않게 합니다. 토큰과 예외 원문은 남기지 않고 연결 오류 코드만 씁니다.
 */
function logRetry(url: string, error: unknown, elapsedMs: number, attempt: number): void {
  if (process.env.NODE_ENV !== "development") return;
  const cause = error instanceof Error ? error.cause : undefined;
  console.error("[githubFetch] retrying after transport failure", {
    url,
    attempt,
    elapsedMs,
    causeCode:
      typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
        ? cause.code
        : undefined,
  });
}

/**
 * fetch가 reject한 전송 실패만 한 번 더 시도합니다. HTTP 오류 응답은 fetch가 정상 반환하므로
 * 재시도 없이 그대로 classifyErrorResponse로 넘어갑니다. 정체 원인이 서버 혼잡이 아니라 로컬
 * 이름 해석이고 실패 직후 재요청이 245ms에 성공했으므로(2026-09-15 측정) 대기를 두지 않습니다.
 */
export async function githubFetch(url: string, token: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= GITHUB_FETCH_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      return await fetch(url, { headers: githubHeaders(token) });
    } catch (error) {
      lastError = error;
      if (attempt < GITHUB_FETCH_ATTEMPTS) logRetry(url, error, Date.now() - startedAt, attempt);
    }
  }
  // 잡은 예외를 `cause`로 넘깁니다. 연결 실패의 원인(`UND_ERR_CONNECT_TIMEOUT`, `ECONNRESET` 등)이
  // 여기서 사라지면 호출부에는 network라는 분류만 남아, 같은 증상을 다시 조사할 때 원인을 처음부터
  // 다시 재현해야 합니다(2026-09-15 GitHub 수집 실패 조사).
  throw new GitHubFetchError(
    "network",
    `The GitHub API request failed after ${GITHUB_FETCH_ATTEMPTS} attempts: ${url}`,
    undefined,
    { cause: lastError }
  );
}

/** 성공 응답의 body 파싱이 실패하면(끊긴 연결, 깨진 JSON) network 오류로 통일해서 던진다. */
export async function parseJson<T>(response: Response, context: string): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new GitHubFetchError("network", `${context}: ${(error as Error).message}`);
  }
}

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function toCommitSummary(raw: RawCommit): CommitSummary {
  return {
    sha: raw.sha,
    title: raw.commit.message.split("\n")[0],
    author: raw.author?.login ?? raw.commit.author?.name ?? "unknown",
    date: raw.commit.author?.date ?? "",
    parentCount: raw.parents.length,
  };
}

export interface RepoInfo {
  defaultBranch: string;
}

export interface AuthoredCommitsResult {
  commits: CommitSummary[];
  repositoryHasCommits: boolean;
}

export interface AuthenticatedUser {
  /** 세션 쿠키와 저장 계층이 쓰는 식별자입니다. login은 사용자가 바꿀 수 있어서 키로 쓰지 않습니다. */
  id: number;
  login: string;
}

export async function fetchAuthenticatedUser(token: string): Promise<AuthenticatedUser> {
  const response = await githubFetch(`${GITHUB_API_BASE}/user`, token);
  if (!response.ok) {
    throw new GitHubFetchError(
      response.status === 404 ? "server_error" : await classifyErrorResponse(response),
      `Could not fetch the authenticated user (${response.status})`
    );
  }
  const data = await parseJson<Partial<AuthenticatedUser>>(
    response,
    "Could not parse the authenticated user response"
  );
  if (!Number.isSafeInteger(data.id) || (data.id ?? 0) <= 0 || typeof data.login !== "string" || data.login === "") {
    throw new GitHubFetchError("server_error", "인증 사용자 응답에 사용자 번호나 아이디가 없습니다");
  }
  return { id: data.id as number, login: data.login };
}

export async function fetchAuthenticatedUserLogin(token: string): Promise<string> {
  return (await fetchAuthenticatedUser(token)).login;
}

export async function fetchRepoInfo({ owner, repo, token }: GitHubAuth): Promise<RepoInfo> {
  const response = await githubFetch(`${GITHUB_API_BASE}/repos/${owner}/${repo}`, token);
  if (!response.ok) {
    throw new GitHubFetchError(
      await classifyErrorResponse(response),
      `Could not fetch repository info: ${owner}/${repo} (${response.status})`
    );
  }
  const data = await parseJson<{ default_branch: string }>(
    response,
    `Could not parse the repository info response: ${owner}/${repo}`
  );
  return { defaultBranch: data.default_branch };
}

/**
 * 브랜치 이름을 그대로 페이지네이션 sha로 쓰면, 조회 도중 기본 브랜치에 새 커밋이 들어올 때
 * 페이지 경계에서 커밋이 중복되거나 누락될 수 있다. 브랜치 head를 커밋 SHA로 한 번 고정해
 * 이후 모든 페이지 요청이 같은 히스토리를 기준으로 동작하게 한다.
 *
 * 커밋이 하나도 없는 저장소는 기본 브랜치에 대한 ref 자체가 없어 이 조회가 404를 반환한다.
 * 다만 Repository 정보 조회와 이 조회 사이에 기본 브랜치가 바뀌었을 수도 있으므로, 404를
 * 곧바로 빈 저장소로 단정하지 않는다. 저장소 크기(size)는 저장 용량(KB)일 뿐 커밋 수를 보장하지
 * 않아 판별 기준으로 쓸 수 없다. 대신 기본 브랜치를 다시 조회해 이름이 그대로인지로 판별한다.
 * 이름이 바뀌었으면 새 이름으로 한 번 재시도하고, 그대로인데도 404면 실제로 ref가 없는 빈
 * 저장소로 본다.
 *
 * ponytail: 재시도는 1회로 고정. 재시도한 새 브랜치명도 404면(연속 rename) 재확인 없이 그냥
 * 빈 저장소로 본다 — 두 번 연속 레이스는 사실상 안 일어나서 재시도 횟수를 매개변수로 뺄 필요는
 * 없음. 실제로 반복 발생이 확인되면 그때 재시도 횟수를 인자로 빼서 늘리면 됨.
 */
export async function resolveBranchHeadSha(
  auth: GitHubAuth,
  branch: string,
  hasRetried = false
): Promise<string | null> {
  const { owner, repo, token } = auth;
  const response = await githubFetch(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`,
    token
  );
  if (response.status === 404) {
    if (hasRetried) {
      return null;
    }
    const refreshed = await fetchRepoInfo(auth);
    if (refreshed.defaultBranch === branch) {
      return null;
    }
    return resolveBranchHeadSha(auth, refreshed.defaultBranch, true);
  }
  if (!response.ok) {
    throw new GitHubFetchError(
      await classifyErrorResponse(response),
      `Could not fetch default branch info: ${owner}/${repo}@${branch} (${response.status})`
    );
  }
  const data = await parseJson<{ commit: { sha: string } }>(
    response,
    `Could not parse the default branch response: ${owner}/${repo}@${branch}`
  );
  return data.commit.sha;
}

/**
 * 선택한 Repository의 기본 브랜치를 기준으로 PAT 소유자가 작성한 커밋을 페이지네이션 조회한다.
 * 커밋 수에는 임의의 상한을 두지 않는다.
 */
export async function fetchAuthoredCommits(auth: GitHubAuth): Promise<AuthoredCommitsResult> {
  const { owner, repo, token } = auth;
  const login = await fetchAuthenticatedUserLogin(token);
  const { defaultBranch } = await fetchRepoInfo(auth);
  const headSha = await resolveBranchHeadSha(auth, defaultBranch);
  if (headSha === null) {
    return { commits: [], repositoryHasCommits: false };
  }

  const commits: CommitSummary[] = [];
  let url: string | null = `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(
    headSha
  )}&author=${encodeURIComponent(login)}&per_page=${PER_PAGE}`;
  // ponytail: GitHub의 author 연결만 신뢰한다. 실제 누락이 관찰되면 명시적 identity 입력을 검토한다.

  while (url) {
    let response: Response;
    try {
      response = await githubFetch(url, token);
    } catch (error) {
      if (commits.length > 0) {
        throw new GitHubFetchError("partial_failure", (error as Error).message, commits, {
          cause: error,
        });
      }
      throw error;
    }

    if (response.status === 409) {
      // 커밋이 하나도 없는 Repository는 200 []이 아니라 409 "Git Repository is empty"를 반환한다.
      // 이미 일부 페이지를 받은 뒤라면 저장소 상태가 바뀐 것이므로 partial_failure로 처리한다.
      if (commits.length > 0) {
        throw new GitHubFetchError(
          "partial_failure",
          `The repository changed while listing commits, so the request failed (409)`,
          commits
        );
      }
      return { commits: [], repositoryHasCommits: false };
    }

    if (!response.ok) {
      const message = `Could not list commits (${response.status})`;
      const cause = new GitHubFetchError(await classifyErrorResponse(response), message);
      if (commits.length > 0) {
        throw new GitHubFetchError("partial_failure", message, commits, { cause });
      }
      throw cause;
    }

    try {
      const page = await parseJson<RawCommit[]>(response, "Could not parse the commit list response");
      commits.push(...page.map(toCommitSummary));
    } catch (error) {
      const cause =
        error instanceof GitHubFetchError
          ? error
          : new GitHubFetchError(
              "network",
              `Could not parse the commit list response: ${(error as Error).message}`,
              undefined,
              { cause: error }
            );
      if (commits.length > 0) {
        throw new GitHubFetchError("partial_failure", cause.message, commits, {
          cause,
        });
      }
      throw cause;
    }

    url = parseNextLink(response.headers.get("link"));
  }

  return { commits, repositoryHasCommits: true };
}

/** 고정한 head SHA에서 제한된 페이지 수만 조회한다. 커서는 route handler가 불투명 값으로 감싼다. */
export async function fetchAuthoredCommitsBatch(
  auth: GitHubAuth,
  cursor: AuthoredCommitsCursor | null,
  maxPages: number
): Promise<AuthoredCommitsBatchResult> {
  const { owner, repo, token } = auth;
  const login = await fetchAuthenticatedUserLogin(token);
  let state = cursor;
  if (state === null) {
    const { defaultBranch } = await fetchRepoInfo(auth);
    const headSha = await resolveBranchHeadSha(auth, defaultBranch);
    if (headSha === null) {
      return { commits: [], repositoryHasCommits: false, cursor: null };
    }
    state = { headSha, page: 1 };
  }

  const commits: CommitSummary[] = [];
  for (let offset = 0; offset < maxPages; offset += 1) {
    const page = state.page + offset;
    let response: Response;
    try {
      response = await githubFetch(
        `${GITHUB_API_BASE}/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(state.headSha)}&author=${encodeURIComponent(login)}&per_page=${PER_PAGE}&page=${page}`,
        token
      );
    } catch (error) {
      if (commits.length === 0) throw error;
      throw new GitHubFetchError("partial_failure", (error as Error).message, commits, { cause: error });
    }
    if (response.status === 409) {
      if (commits.length === 0 && page === 1) {
        return { commits: [], repositoryHasCommits: false, cursor: null };
      }
      const cause = new GitHubFetchError("server_error", "The repository changed while listing commits, so the request failed (409)");
      throw new GitHubFetchError("partial_failure", cause.message, commits, { cause });
    }
    if (!response.ok) {
      const cause = new GitHubFetchError(
        await classifyErrorResponse(response),
        `Could not list commits (${response.status})`
      );
      if (commits.length > 0) {
        throw new GitHubFetchError("partial_failure", cause.message, commits, { cause });
      }
      throw cause;
    }
    try {
      const batch = await parseJson<RawCommit[]>(response, "Could not parse the commit list response");
      commits.push(...batch.map(toCommitSummary));
    } catch (error) {
      if (commits.length === 0) throw error;
      throw new GitHubFetchError("partial_failure", (error as Error).message, commits, { cause: error });
    }
    if (parseNextLink(response.headers.get("link")) === null) {
      return { commits, repositoryHasCommits: true, cursor: null };
    }
  }
  return {
    commits,
    repositoryHasCommits: true,
    cursor: { ...state, page: state.page + maxPages },
  };
}

/** PAT 소유자가 작성한 커밋 전체를 반환한다. */
export async function fetchAllCommits(auth: GitHubAuth): Promise<CommitSummary[]> {
  return (await fetchAuthoredCommits(auth)).commits;
}

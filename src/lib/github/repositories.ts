import { classifyErrorResponse, GITHUB_API_BASE, githubFetch, parseJson, parseNextLink } from "./commits";
import { GitHubFetchError } from "./errors";
import type { RepositorySummary } from "./types";

const PER_PAGE = 100;

interface RawRepository {
  id: number;
  name: string;
  owner: { login: string };
  private: boolean;
  language: string | null;
  pushed_at: string | null;
}

function toSummary(raw: RawRepository): RepositorySummary {
  return {
    id: raw.id,
    owner: raw.owner.login,
    name: raw.name,
    visibility: raw.private ? "private" : "public",
    language: raw.language,
    pushedAt: raw.pushed_at,
  };
}

/**
 * 세션 사용자가 접근할 수 있는 Repository 전체를 `GET /user/repos`에서 모아 돌려줍니다. 마지막 push가 최근인 순서입니다.
 *
 * 페이지 커서는 `Link` 헤더의 page 번호라서 조회 도중 목록이 바뀌면 경계에서 항목이 중복되거나 빠질 수 있습니다.
 * 커밋 조회처럼 고정할 SHA가 없어 피할 수 없고, 중복은 id로 걸러내되 누락은 남습니다. 도중에 실패하면 모은 것을
 * 버리고 전체를 오류로 냅니다. 부분 목록은 특정 Repository가 없는 것처럼 보이게 하므로 이어 쓰지 않습니다.
 *
 * `/user/repos`의 404는 Repository 없음이 아니라 엔드포인트 자체의 문제라 `fetchAuthenticatedUserLogin`과 같이
 * `server_error`로 봅니다. rate limit이 아닌 403은 scope 부족이나 조직의 SSO 강제인데 복구가 다시 로그인이라
 * 기존 `auth_revoked`를 그대로 씁니다.
 */
export async function fetchUserRepositories(token: string): Promise<RepositorySummary[]> {
  const seen = new Set<number>();
  const repositories: RepositorySummary[] = [];
  let url: string | null = `${GITHUB_API_BASE}/user/repos?per_page=${PER_PAGE}&sort=pushed&direction=desc`;

  while (url) {
    const response = await githubFetch(url, token);
    if (!response.ok) {
      throw new GitHubFetchError(
        response.status === 404 ? "server_error" : await classifyErrorResponse(response),
        `Repository 목록을 가져오지 못했습니다 (${response.status})`
      );
    }
    const page = await parseJson<RawRepository[]>(response, "Repository 목록 응답을 해석하지 못했습니다");
    if (!Array.isArray(page)) {
      throw new GitHubFetchError("server_error", "Repository 목록 응답 형식이 올바르지 않습니다.");
    }
    for (const raw of page) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      repositories.push(toSummary(raw));
    }
    url = parseNextLink(response.headers.get("link"));
  }

  return repositories;
}

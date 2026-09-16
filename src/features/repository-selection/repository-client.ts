import { trackEvent } from "@/features/analytics/events";
import { apiFetch } from "@/lib/github/api-contract";
import { GitHubFetchError } from "@/lib/github/errors";
import type { RepositorySummary } from "@/lib/github/types";

export const REPOSITORIES_PATH = "/api/github/repositories";

/**
 * 세션 사용자의 Repository 목록을 자체 라우트에서 가져옵니다. 오류 봉투 복원은 다른 GitHub 라우트와 같은 `apiFetch`가 합니다.
 *
 * `repo_list_loaded`를 화면이 아니라 여기서 보냅니다. 조회가 성공했다는 사실은 이 함수가 알고,
 * 목록 화면의 배치나 다시 조회하는 진입점이 바뀌어도 이 자리는 그대로이기 때문입니다. 실패는 여기서
 * 세지 않습니다. 목록 조회 실패는 이 이슈의 퍼널 이벤트 목록에 없습니다.
 */
export async function fetchRepositoriesFromApi(): Promise<RepositorySummary[]> {
  const startedAt = Date.now();
  const result = await apiFetch<{ repositories?: unknown }>(REPOSITORIES_PATH);
  if (!result || typeof result !== "object" || !Array.isArray(result.repositories)) {
    throw new GitHubFetchError("server_error", "The server response format is not valid.");
  }
  const repositories = result.repositories as RepositorySummary[];
  trackEvent({
    name: "repo_list_loaded",
    repo_count: repositories.length,
    duration_ms: Date.now() - startedAt,
  });
  return repositories;
}

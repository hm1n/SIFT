import { apiFetch } from "@/lib/github/api-contract";
import { GitHubFetchError } from "@/lib/github/errors";
import type { RepositorySummary } from "@/lib/github/types";

export const REPOSITORIES_PATH = "/api/github/repositories";

/** 세션 사용자의 Repository 목록을 자체 라우트에서 가져옵니다. 오류 봉투 복원은 다른 GitHub 라우트와 같은 `apiFetch`가 합니다. */
export async function fetchRepositoriesFromApi(): Promise<RepositorySummary[]> {
  const result = await apiFetch<{ repositories?: unknown }>(REPOSITORIES_PATH);
  if (!result || typeof result !== "object" || !Array.isArray(result.repositories)) {
    throw new GitHubFetchError("server_error", "서버 응답 형식이 올바르지 않습니다.");
  }
  return result.repositories as RepositorySummary[];
}

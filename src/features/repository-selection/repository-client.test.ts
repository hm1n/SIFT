import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubFetchError } from "@/lib/github/errors";
import { fetchRepositoriesFromApi, REPOSITORIES_PATH } from "./repository-client";

afterEach(() => vi.unstubAllGlobals());

describe("fetchRepositoriesFromApi", () => {
  it("목록 라우트를 GET으로 부르고 repositories 배열을 돌려준다", async () => {
    const repositories = [{ id: 1, owner: "octocat", name: "hello-world", visibility: "public", language: "TypeScript", pushedAt: "2026-09-10T00:00:00Z" }];
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ repositories }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await fetchRepositoriesFromApi()).toEqual(repositories);
    expect(fetchMock).toHaveBeenCalledWith(REPOSITORIES_PATH, undefined);
  });

  it("오류 봉투를 같은 kind의 GitHubFetchError로 복원한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      Response.json({ error: { kind: "rate_limit", message: "한도" } }, { status: 429 })
    ));
    const promise = fetchRepositoriesFromApi();
    await expect(promise).rejects.toBeInstanceOf(GitHubFetchError);
    await expect(promise).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("repositories가 배열이 아닌 200 응답은 server_error다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ repositories: { id: 1 } })));
    await expect(fetchRepositoriesFromApi()).rejects.toMatchObject({ kind: "server_error" });
  });

  it("서버에 연결하지 못하면 network다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
    await expect(fetchRepositoriesFromApi()).rejects.toMatchObject({ kind: "network" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubFetchError } from "@/lib/github/errors";

const trackEvent = vi.fn();
vi.mock("@/features/analytics/events", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

const { fetchRepositoriesFromApi, REPOSITORIES_PATH } = await import("./repository-client");

afterEach(() => {
  vi.unstubAllGlobals();
  trackEvent.mockClear();
});

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

  /**
   * `repo_list_loaded`를 화면이 아니라 여기서 보냅니다. 목록 화면의 배치나 다시 조회하는 진입점이
   * 바뀌어도 조회가 성공했다는 사실은 이 함수가 알기 때문입니다(이슈 #125).
   */
  it("조회에 성공하면 저장소 수와 소요 시간을 남긴다", async () => {
    const repositories = [
      { id: 1, owner: "octocat", name: "hello-world", visibility: "public", language: "TypeScript", pushedAt: null },
      { id: 2, owner: "octocat", name: "second", visibility: "private", language: null, pushedAt: null },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ repositories })));

    await fetchRepositoriesFromApi();

    expect(trackEvent).toHaveBeenCalledTimes(1);
    const event = trackEvent.mock.calls[0]?.[0];
    expect(event).toMatchObject({ name: "repo_list_loaded", repo_count: 2 });
    expect(event.duration_ms).toBeGreaterThanOrEqual(0);
    // 저장소 owner와 이름은 보내지 않습니다(이슈 #125 제약).
    expect(JSON.stringify(event)).not.toContain("octocat");
    expect(JSON.stringify(event)).not.toContain("hello-world");
  });

  it.each([
    ["오류 봉투", Response.json({ error: { kind: "rate_limit", message: "한도" } }, { status: 429 })],
    ["형식이 어긋난 200 응답", Response.json({ repositories: { id: 1 } })],
  ])("%s에서는 아무 이벤트도 남기지 않는다", async (_label, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(response));
    await expect(fetchRepositoriesFromApi()).rejects.toBeInstanceOf(GitHubFetchError);
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

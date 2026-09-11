import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubFetchError } from "./errors";
import { fetchUserRepositories } from "./repositories";

const REPOS_URL = "https://api.github.com/user/repos";

function rawRepository(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: i,
    name: `repo-${i}`,
    owner: { login: i % 2 === 0 ? "octocat" : "acme" },
    private: i % 3 === 0,
    language: i % 4 === 0 ? null : "TypeScript",
    pushed_at: `2026-09-0${(i % 9) + 1}T00:00:00Z`,
    ...overrides,
  };
}

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });
}

async function expectKind(promise: Promise<unknown>, kind: GitHubFetchError["kind"]) {
  await expect(promise).rejects.toBeInstanceOf(GitHubFetchError);
  await expect(promise).rejects.toMatchObject({ kind });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchUserRepositories", () => {
  it("GitHub 응답을 owner, name, visibility, language, pushedAt 요약으로 바꾼다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([rawRepository(3), rawRepository(4)])));

    const repositories = await fetchUserRepositories("token");

    expect(repositories).toEqual([
      { id: 3, owner: "acme", name: "repo-3", visibility: "private", language: "TypeScript", pushedAt: "2026-09-04T00:00:00Z" },
      { id: 4, owner: "octocat", name: "repo-4", visibility: "public", language: null, pushedAt: "2026-09-05T00:00:00Z" },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      `${REPOS_URL}?per_page=100&sort=pushed&direction=desc`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer token" }) })
    );
  });

  it("Link 헤더의 next를 끝까지 따라가 전체를 한 배열로 모은다", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 100 }, (_, i) => rawRepository(i)), { headers: { link: `<${REPOS_URL}?page=2>; rel="next", <${REPOS_URL}?page=3>; rel="last"` } }))
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 100 }, (_, i) => rawRepository(100 + i)), { headers: { link: `<${REPOS_URL}?page=3>; rel="next"` } }))
      .mockResolvedValueOnce(jsonResponse(Array.from({ length: 7 }, (_, i) => rawRepository(200 + i)), { headers: { link: `<${REPOS_URL}?page=2>; rel="prev"` } }));
    vi.stubGlobal("fetch", fetchMock);

    const repositories = await fetchUserRepositories("token");

    expect(repositories).toHaveLength(207);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe(`${REPOS_URL}?page=2`);
    expect(fetchMock.mock.calls[2][0]).toBe(`${REPOS_URL}?page=3`);
  });

  // page 번호 커서는 조회 도중 목록이 바뀌면 경계에서 같은 항목을 두 번 줄 수 있습니다. 중복만 id로 걸러냅니다.
  it("페이지 경계에서 중복된 Repository는 id로 한 번만 남긴다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse([rawRepository(1), rawRepository(2)], { headers: { link: `<${REPOS_URL}?page=2>; rel="next"` } }))
      .mockResolvedValueOnce(jsonResponse([rawRepository(2), rawRepository(3)])));

    const repositories = await fetchUserRepositories("token");

    expect(repositories.map((repository) => repository.id)).toEqual([1, 2, 3]);
  });

  it("Repository가 하나도 없으면 빈 배열을 돌려준다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([])));
    expect(await fetchUserRepositories("token")).toEqual([]);
  });

  it("401은 auth_revoked로 분류한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, { status: 401 })));
    await expectKind(fetchUserRepositories("token"), "auth_revoked");
  });

  it("x-ratelimit-remaining이 0인 403은 primary rate limit이다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } })
    ));
    await expectKind(fetchUserRepositories("token"), "rate_limit");
  });

  it("Retry-After 헤더가 있는 403은 secondary rate limit이다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "You have exceeded a secondary rate limit" }, { status: 403, headers: { "retry-after": "60", "x-ratelimit-remaining": "42" } })
    ));
    await expectKind(fetchUserRepositories("token"), "rate_limit");
  });

  it("본문에 secondary rate limit 문구가 있는 403은 헤더가 없어도 rate limit이다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "You have exceeded a secondary rate limit. Please wait a few minutes." }, { status: 403, headers: { "x-ratelimit-remaining": "42" } })
    ));
    await expectKind(fetchUserRepositories("token"), "rate_limit");
  });

  // scope 부족이나 조직의 SSO 강제입니다. 복구가 다시 로그인이라 기존 auth_revoked를 씁니다.
  it("rate limit이 아닌 403은 auth_revoked로 분류한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(
      jsonResponse({ message: "Resource protected by organization SAML enforcement." }, { status: 403, headers: { "x-ratelimit-remaining": "42" } })
    ));
    await expectKind(fetchUserRepositories("token"), "auth_revoked");
  });

  it("429는 rate_limit이다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({}, { status: 429 })));
    await expectKind(fetchUserRepositories("token"), "rate_limit");
  });

  // /user/repos의 404는 Repository 없음이 아니므로 repo_not_found로 돌려 Repository 재선택을 안내하면 틀린 복구가 됩니다.
  it("404는 repo_not_found가 아니라 server_error다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, { status: 404 })));
    await expectKind(fetchUserRepositories("token"), "server_error");
  });

  it("422는 server_error다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ message: "Validation Failed" }, { status: 422 })));
    await expectKind(fetchUserRepositories("token"), "server_error");
  });

  it("fetch 자체가 실패하면 network다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
    await expectKind(fetchUserRepositories("token"), "network");
  });

  it("성공 응답의 JSON 파싱이 실패하면 network 오류로 바꾼다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{broken", { status: 200 })));
    await expectKind(fetchUserRepositories("token"), "network");
  });

  it("배열이 아닌 성공 응답은 server_error다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ message: "unexpected" })));
    await expectKind(fetchUserRepositories("token"), "server_error");
  });

  // 부분 목록은 특정 Repository가 없는 것처럼 보이게 하므로 이어 쓰지 않고 전체를 오류로 냅니다.
  it("두 번째 페이지가 실패하면 첫 페이지 결과를 돌려주지 않고 오류를 던진다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse([rawRepository(1)], { headers: { link: `<${REPOS_URL}?page=2>; rel="next"` } }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 429 })));

    const promise = fetchUserRepositories("token");
    await expectKind(promise, "rate_limit");
    await expect(promise).rejects.not.toHaveProperty("partialCommits", expect.anything());
  });
});

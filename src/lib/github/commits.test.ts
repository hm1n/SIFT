import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchAllCommits,
  fetchAuthenticatedUser,
  fetchAuthenticatedUserLogin,
  fetchAuthoredCommits,
  githubFetch,
} from "./commits";
import { GitHubFetchError } from "./errors";

const AUTH = { owner: "octocat", repo: "hello-world", token: "test-token" };
const COMMITS_URL = "https://api.github.com/repos/octocat/hello-world/commits";
const HEAD_SHA = "abc123headsha";

function rawCommit(i: number) {
  return {
    sha: `sha-${i}`,
    commit: {
      message: `commit message ${i}\n\nbody`,
      author: { name: `author-${i}`, date: `2026-01-${String((i % 28) + 1).padStart(2, "0")}` },
    },
    author: { login: `login-${i}` },
    parents: [{ sha: `parent-${i}` }],
  };
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

function mockRepoAndBranch(fetchMock: ReturnType<typeof vi.fn>, headSha = HEAD_SHA) {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
    .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
    .mockResolvedValueOnce(jsonResponse({ commit: { sha: headSha } }));
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("githubFetch", () => {
  it("전송 단계에서 한 번 실패한 요청을 다시 시도해 성공 응답을 그대로 돌려준다", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await githubFetch(COMMITS_URL, AUTH.token);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ default_branch: "main" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 응답을 받은 실패까지 다시 보내면 rate limit을 더 때리고 classifyErrorResponse의 분류가 흔들립니다.
  it.each([403, 404, 409, 422, 429] as const)("%s 응답은 다시 시도하지 않는다", async (status) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "failed" }, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(githubFetch(COMMITS_URL, AUTH.token)).resolves.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // 잡은 예외를 버리면 호출부에 network라는 분류만 남아, 같은 증상을 다시 조사할 때 원인을
  // 처음부터 재현해야 합니다(2026-09-15 GitHub 수집 실패 조사).
  it("재시도까지 실패하면 network 오류로 바꾸고 마지막 예외를 cause로 남긴다", async () => {
    const lastFailure = new TypeError("second failure");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("first failure"))
      .mockRejectedValueOnce(lastFailure);
    vi.stubGlobal("fetch", fetchMock);

    const error: GitHubFetchError = await githubFetch(COMMITS_URL, AUTH.token).catch((caught) => caught);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.kind).toBe("network");
    expect(error.cause).toBe(lastFailure);
    expect(error.message).toContain("2 attempts");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  // 재시도가 성공하면 사용자에게도 오류에도 아무것도 남지 않습니다. 이 한 줄이 유일한 흔적입니다.
  it("재시도한 경우에만 개발 서버에 연결 오류 코드를 한 줄 남긴다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const cause = Object.assign(new Error("sensitive original message"), {
      code: "UND_ERR_CONNECT_TIMEOUT",
    });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed", { cause }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }));
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(githubFetch(COMMITS_URL, AUTH.token)).resolves.toMatchObject({ status: 200 });

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("[githubFetch] retrying after transport failure", {
      url: COMMITS_URL,
      attempt: 1,
      elapsedMs: expect.any(Number),
      causeCode: "UND_ERR_CONNECT_TIMEOUT",
    });
    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(AUTH.token);
    expect(logged).not.toContain("sensitive original message");
  });

  // 마지막 시도에는 재시도가 없으므로 남길 것도 없습니다. 원인은 오류의 cause에 실려 나갑니다.
  it("마지막 시도의 실패는 로그로 남기지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(githubFetch(COMMITS_URL, AUTH.token)).rejects.toMatchObject({ kind: "network" });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("운영에서는 재시도해도 로그를 남기지 않는다", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(githubFetch(COMMITS_URL, AUTH.token)).rejects.toMatchObject({ kind: "network" });
    expect(log).not.toHaveBeenCalled();
  });
});

describe("fetchAllCommits", () => {
  it("커밋 수 상한 없이 여러 페이지를 끝까지 조회하고, 고정된 브랜치 head SHA로 페이지네이션한다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const page2 = Array.from({ length: 100 }, (_, i) => rawCommit(100 + i));
    const page3 = Array.from({ length: 50 }, (_, i) => rawCommit(200 + i));

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(
        jsonResponse(page2, { headers: { link: `<${COMMITS_URL}?page=3>; rel="next"` } })
      )
      .mockResolvedValueOnce(jsonResponse(page3));

    const commits = await fetchAllCommits(AUTH);

    expect(commits).toHaveLength(250);
    expect(commits[0]).toEqual({
      sha: "sha-0",
      title: "commit message 0",
      author: "login-0",
      date: "2026-01-01",
      parentCount: 1,
    });
    expect(fetchMock).toHaveBeenCalledTimes(6);

    const firstPageUrl = fetchMock.mock.calls[3][0] as string;
    expect(firstPageUrl).toContain(`sha=${HEAD_SHA}`);
    expect(firstPageUrl).toContain("author=octocat");
  });

  it("커밋이 하나도 없으면 빈 배열을 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(jsonResponse([]));

    const commits = await fetchAllCommits(AUTH);
    expect(commits).toEqual([]);
  });

  it("재확인해도 기본 브랜치명이 그대로인데 404면 실제로 빈 저장소로 본다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Branch not found" }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }));

    const commits = await fetchAllCommits(AUTH);
    expect(commits).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("조회 사이에 기본 브랜치가 바뀌어 404가 나면 저장소 정보를 다시 확인해 새 브랜치로 재시도한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Branch not found" }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "trunk" }))
      .mockResolvedValueOnce(jsonResponse({ commit: { sha: HEAD_SHA } }))
      .mockResolvedValueOnce(jsonResponse([]));

    const commits = await fetchAllCommits(AUTH);

    expect(commits).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const branchLookupUrl = fetchMock.mock.calls[4][0] as string;
    expect(branchLookupUrl).toContain("/branches/trunk");
  });

  it("재시도한 새 브랜치명도 404면 재시도를 더 하지 않고 빈 배열로 본다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Branch not found" }, { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "trunk" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Branch not found" }, { status: 404 }));

    const commits = await fetchAllCommits(AUTH);
    expect(commits).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("브랜치 head는 있지만 첫 커밋 목록 조회가 409이면 빈 저장소로 판별한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse({ message: "Git Repository is empty." }, { status: 409 })
    );

    const result = await fetchAuthoredCommits(AUTH);
    expect(result).toEqual({ commits: [], repositoryHasCommits: false });
  });

  it("첫 페이지 이후 409를 받으면 partial_failure로 처리하고 빈 배열을 성공으로 반환하지 않는다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(
        jsonResponse({ message: "Git Repository is empty." }, { status: 409 })
      );

    const error: GitHubFetchError = await fetchAllCommits(AUTH).catch((e) => e);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.kind).toBe("partial_failure");
    expect(error.partialCommits).toHaveLength(100);
    expect(error.cause).toBeUndefined();
  });

  it("일부 페이지 수집 뒤 호출 한도를 초과하면 원래 rate_limit 분류를 보존한다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          { message: "API rate limit exceeded" },
          { status: 403, headers: { "x-ratelimit-remaining": "0" } }
        )
      );

    const error: GitHubFetchError = await fetchAllCommits(AUTH).catch((caught) => caught);

    expect(error.kind).toBe("partial_failure");
    expect(error.partialCommits).toHaveLength(100);
    expect(error.cause).toMatchObject({ kind: "rate_limit" });
  });

  it("429 응답도 rate_limit 오류로 분류한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse({ message: "Too Many Requests" }, { status: 429 })
    );

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("Retry-After 헤더가 있는 2차(secondary) rate limit도 rate_limit 오류로 분류한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse(
        { message: "You have exceeded a secondary rate limit" },
        { status: 403, headers: { "x-ratelimit-remaining": "42", "retry-after": "60" } }
      )
    );

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("Retry-After 헤더 없이 본문 메시지로만 알 수 있는 2차 rate limit도 rate_limit 오류로 분류한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse(
        { message: "You have exceeded a secondary rate limit. Please wait before retrying." },
        { status: 403, headers: { "x-ratelimit-remaining": "42" } }
      )
    );

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("API 호출 한도를 초과하면 rate_limit 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0" } }
      )
    );

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("인증 권한이 취소되면 auth_revoked 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(
      jsonResponse({ message: "Bad credentials" }, { status: 401 })
    );

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "auth_revoked" });
  });

  it("Repository를 찾을 수 없으면 repo_not_found 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, { status: 404 }));

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "repo_not_found" });
  });

  it("페이지 조회 도중 오류가 나면 이미 조회한 커밋과 함께 partial_failure를 던진다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockRejectedValue(new Error("network down"));

    const error: GitHubFetchError = await fetchAllCommits(AUTH).catch((e) => e);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.kind).toBe("partial_failure");
    expect(error.partialCommits).toHaveLength(100);
    expect(error.cause).toMatchObject({ kind: "network" });
  });

  it("Repository 정보 응답을 해석할 수 없으면 network 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "network" });
  });

  it("기본 브랜치 응답을 해석할 수 없으면 network 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }))
      .mockResolvedValueOnce(jsonResponse({ default_branch: "main" }))
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "network" });
  });

  it("첫 페이지 응답 본문을 해석할 수 없으면 network 오류를 던진다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(new Response("not json", { status: 200 }));

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "network" });
  });

  it("페이지 응답 본문을 해석할 수 없으면 이미 조회한 커밋과 함께 partial_failure를 던진다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(new Response("not json", { status: 200 }));

    const error: GitHubFetchError = await fetchAllCommits(AUTH).catch((e) => e);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.kind).toBe("partial_failure");
    expect(error.partialCommits).toHaveLength(100);
    expect(error.cause).toMatchObject({ kind: "network" });
  });

  it("첫 페이지 커밋 형태가 잘못되면 타입이 있는 network 오류를 던진다", async () => {
    const malformed = { ...rawCommit(0), parents: undefined };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock).mockResolvedValueOnce(jsonResponse([malformed]));

    await expect(fetchAllCommits(AUTH)).rejects.toMatchObject({ kind: "network" });
  });

  it("후속 페이지 커밋 형태가 잘못되면 이미 조회한 커밋과 함께 partial_failure를 던진다", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => rawCommit(i));
    const malformed = { ...rawCommit(100), commit: undefined };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    mockRepoAndBranch(fetchMock)
      .mockResolvedValueOnce(
        jsonResponse(page1, { headers: { link: `<${COMMITS_URL}?page=2>; rel="next"` } })
      )
      .mockResolvedValueOnce(jsonResponse([malformed]));

    const error: GitHubFetchError = await fetchAllCommits(AUTH).catch((e) => e);

    expect(error).toBeInstanceOf(GitHubFetchError);
    expect(error.kind).toBe("partial_failure");
    expect(error.partialCommits).toHaveLength(100);
  });
});

describe("fetchAuthenticatedUserLogin", () => {
  it("GET /user 응답에서 PAT 소유자의 login을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthenticatedUserLogin(AUTH.token)).resolves.toBe("octocat");
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/user", expect.anything());
  });

  it("GET /user 응답에서 사용자 번호를 함께 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse({ id: 44727850, login: "octocat" })));

    await expect(fetchAuthenticatedUser(AUTH.token)).resolves.toEqual({ id: 44727850, login: "octocat" });
  });

  // 번호가 빠지거나 정수 범위를 벗어난 응답을 통과시키면 세션 쿠키에 쓸 수 없는 값이 실립니다.
  it.each([
    [{ login: "octocat" }],
    [{ id: 0, login: "octocat" }],
    [{ id: 1.5, login: "octocat" }],
    [{ id: Number.MAX_SAFE_INTEGER + 2, login: "octocat" }],
    [{ id: 44727850, login: "" }],
  ])("사용자 번호나 아이디가 온전하지 않은 %o 응답을 server_error로 변환한다", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(body)));

    await expect(fetchAuthenticatedUser(AUTH.token)).rejects.toMatchObject({ kind: "server_error" });
  });

  it.each([
    [404, "server_error"],
    [409, "server_error"],
    [401, "auth_revoked"],
    [403, "auth_revoked"],
    [429, "rate_limit"],
    [422, "server_error"],
  ] as const)("GET /user의 %s 응답을 %s 오류로 변환한다", async (status, kind) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "failed" }, { status }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthenticatedUserLogin(AUTH.token)).rejects.toMatchObject({ kind });
  });

  it("GET /user 성공 응답 JSON 파싱 실패를 타입이 있는 오류로 변환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("not json")));

    await expect(fetchAuthenticatedUserLogin(AUTH.token)).rejects.toMatchObject({
      kind: "network",
    });
  });
});

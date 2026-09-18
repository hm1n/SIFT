import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubOAuthConfigError,
  createGitHubAuthorizeUrl,
  createOAuthState,
  exchangeGitHubCode,
  getGitHubOAuthConfig,
  oauthStatesMatch,
  revokeGitHubGrant,
  type GitHubOAuthConfig,
} from "./oauth";

const config: GitHubOAuthConfig = { clientId: "client", clientSecret: "secret", redirectUri: "https://app.test/api/auth/github/callback" };

afterEach(() => vi.unstubAllGlobals());

describe("exchangeGitHubCode", () => {
  it("rejects a GitHub error body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad_verification_code" }), { status: 200 })));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow("bad_verification_code");
  });

  it("rejects a non-object body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json("nope")));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow("invalid body");
  });

  it("rejects a body without an access token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ token_type: "bearer" })));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow("no access token");
  });

  it("rejects an HTTP failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow("status 502");
  });

  // 설정이 틀린 경우는 다시 시도해도 같은 결과라 사용자에게 재시도를 권하면 안 됩니다.
  it.each(["incorrect_client_credentials", "redirect_uri_mismatch"])("classifies %s as a configuration error", async (errorCode) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: errorCode })));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow(GitHubOAuthConfigError);
  });

  it("keeps other GitHub errors retryable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "bad_verification_code" })));
    await expect(exchangeGitHubCode(config, "code")).rejects.not.toBeInstanceOf(GitHubOAuthConfigError);
  });

  it("rejects invalid JSON", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200 })));
    await expect(exchangeGitHubCode(config, "code")).rejects.toThrow("invalid JSON");
  });
});

describe("getGitHubOAuthConfig", () => {
  afterEach(() => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.GITHUB_OAUTH_REDIRECT_URI;
  });

  it("derives the redirect URI from the request origin", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    expect(getGitHubOAuthConfig("https://app.test/api/auth/github/login").redirectUri).toBe(
      "https://app.test/api/auth/github/callback"
    );
  });

  it("prefers the configured redirect URI", () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "client";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    process.env.GITHUB_OAUTH_REDIRECT_URI = "https://deploy.test/api/auth/github/callback";
    expect(getGitHubOAuthConfig("https://app.test/api/auth/github/login").redirectUri).toBe(
      "https://deploy.test/api/auth/github/callback"
    );
  });

  it.each(["GITHUB_OAUTH_CLIENT_ID", "GITHUB_OAUTH_CLIENT_SECRET"])(
    "throws a config error when %s is missing",
    (missing) => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "client";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
      delete process.env[missing];
      expect(() => getGitHubOAuthConfig("https://app.test/api/auth/github/login")).toThrow(GitHubOAuthConfigError);
    }
  );
});

describe("createGitHubAuthorizeUrl", () => {
  it("asks GitHub for read:user and repo scopes", () => {
    const url = new URL(createGitHubAuthorizeUrl(config, "state-value"));
    expect(url.searchParams.get("scope")).toBe("read:user repo");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-value");
  });
});

describe("oauthStatesMatch", () => {
  it("matches an identical state", () => {
    const state = createOAuthState();
    expect(oauthStatesMatch(state, state)).toBe(true);
  });

  it.each([
    ["a different state", "expected-state", "other-state"],
    ["a state of another length", "expected-state", "expected"],
    ["a missing cookie", undefined, "expected-state"],
    ["a missing query value", "expected-state", null],
  ])("rejects %s", (_label, expected, actual) => {
    expect(oauthStatesMatch(expected as string | undefined, actual as string | null)).toBe(false);
  });

  it("creates an unpredictable state", () => {
    expect(createOAuthState()).not.toBe(createOAuthState());
  });
});

describe("revokeGitHubGrant", () => {
  const CREDENTIALS = { GITHUB_OAUTH_CLIENT_ID: "client", GITHUB_OAUTH_CLIENT_SECRET: "secret" };

  function stubEnv(values: Record<string, string | undefined>): void {
    for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
  }

  function stubFetch(response: Response) {
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllEnvs());

  /**
   * 문서가 정한 계약입니다(`DELETE /applications/{client_id}/grant`, 2026-09-18 확인). 인증이 Basic이고
   * 사용자 토큰이 본문으로 갑니다. 이 셋 중 하나만 어긋나도 GitHub은 422나 401로 답하고, 그때 화면은
   * 데이터는 지워졌지만 권한이 남았다고 알리게 됩니다. 요청 모양을 테스트로 고정합니다.
   */
  it("client 자격으로 Basic 인증하고 사용자 토큰을 본문으로 보낸다", async () => {
    stubEnv(CREDENTIALS);
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "revoked" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/applications/client/grant");
    expect(init.method).toBe("DELETE");
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("client:secret").toString("base64")}`
    );
    expect(init.body).toBe(JSON.stringify({ access_token: "user-token" }));
  });

  /** 지울 grant가 없으면 권한도 남아 있지 않습니다. 목표가 이미 이뤄진 경우라 해제로 봅니다. */
  it("404는 이미 해제된 것으로 본다", async () => {
    stubEnv(CREDENTIALS);
    stubFetch(Response.json({ message: "Not Found" }, { status: 404 }));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "revoked" });
  });

  /** 사용자 토큰 문제가 아니라 서버 설정 문제입니다. 다시 시도해도 같습니다. */
  it("401은 client 자격 문제로 가른다", async () => {
    stubEnv(CREDENTIALS);
    stubFetch(Response.json({ message: "Bad credentials" }, { status: 401 }));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "failed", reason: "invalid_credentials" });
  });

  it.each([
    ["429", new Response(null, { status: 429 })],
    ["403과 x-ratelimit-remaining: 0", new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "0" } })],
    ["403과 Retry-After", new Response(null, { status: 403, headers: { "retry-after": "60" } })],
    [
      "403과 secondary rate limit 메시지",
      Response.json({ message: "You have exceeded a secondary rate limit" }, { status: 403 }),
    ],
  ])("%s는 요청 한도로 가른다", async (_name, response) => {
    stubEnv(CREDENTIALS);
    stubFetch(response);

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "failed", reason: "rate_limit" });
  });

  /** 한도가 아닌 403과 422, 5xx입니다. 사용자에게는 모두 "권한이 남았다"로 같습니다. */
  it.each([403, 422, 500])("%i는 거절로 묶는다", async (status) => {
    stubEnv(CREDENTIALS);
    stubFetch(Response.json({ message: "nope" }, { status }));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "failed", reason: "rejected" });
  });

  it("전송이 실패하면 network다", async () => {
    stubEnv(CREDENTIALS);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNRESET")));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "failed", reason: "network" });
  });

  /**
   * 자격이 없으면 GitHub을 부르지 않습니다. 던지지 않는 이유는 이 호출이 실패해도 데이터 삭제는
   * 끝나야 한다는 이슈 #145의 요구 때문입니다. 던지면 부르는 쪽이 그 예외를 놓친 순간 탈퇴 전체가
   * 500으로 끝나고, 이미 지운 데이터를 되살릴 방법은 없습니다.
   */
  it.each([
    ["client id가 없으면", { GITHUB_OAUTH_CLIENT_ID: undefined, GITHUB_OAUTH_CLIENT_SECRET: "secret" }],
    ["client secret이 없으면", { GITHUB_OAUTH_CLIENT_ID: "client", GITHUB_OAUTH_CLIENT_SECRET: undefined }],
  ])("%s 부르지 않고 config_missing이다", async (_name, env) => {
    stubEnv(env);
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    expect(await revokeGitHubGrant("user-token")).toEqual({ status: "failed", reason: "config_missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

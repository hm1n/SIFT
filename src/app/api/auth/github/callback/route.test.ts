import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { decryptGitHubSession, GITHUB_SESSION_KEY_ENV } from "@/lib/github/auth-session";
import { GET } from "./route";

const USER_ID = 44727850;

/**
 * 콜백은 토큰 교환과 `GET /user`를 차례로 부릅니다. 호출 순서가 아니라 주소로 나눠 응답을 정합니다.
 * 순서로 정하면 호출이 하나 늘거나 줄 때마다 모든 테스트가 같이 흔들립니다.
 */
function stubGitHub(options: { exchange?: () => Response; user?: () => Response } = {}) {
  const fetchMock = vi.fn((...args: Parameters<typeof fetch>) =>
    Promise.resolve(
      String(args[0]).startsWith("https://api.github.com/user")
        ? (options.user ?? (() => Response.json({ id: USER_ID, login: "octocat" })))()
        : (options.exchange ?? (() => Response.json({ access_token: "token" })))()
    )
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sessionCookieValue(response: Response): string {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("github_session="));
  return (cookie as string).slice("github_session=".length).split(";")[0];
}

beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "client-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "client-secret";
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 4).toString("base64");
});
afterEach(() => {
  delete process.env.GITHUB_OAUTH_CLIENT_ID;
  delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
  delete process.env[GITHUB_SESSION_KEY_ENV];
  vi.unstubAllGlobals();
});

function request(query: string, stateCookie = "state") {
  return new NextRequest(`https://app.test/api/auth/github/callback?${query}`, { headers: { cookie: `github_oauth_state=${stateCookie}` } });
}

describe("GitHub OAuth callback", () => {
  // 성공 표시 `?login=success`는 계측이 로그인 성공을 세는 유일한 근거입니다. 이 표시가 빠지면
  // `login_result`가 나가지 않고, 세션 유무로 대신 판정하면 새로고침까지 로그인 성공으로 세어집니다(이슈 #125).
  it("sets the session, deletes state, and redirects home with the login success marker", async () => {
    stubGitHub();
    const response = await GET(request("code=code&state=state"));
    const cookies = response.headers.getSetCookie();
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://app.test/?login=success");
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("github_session=");
    expect(cookies[0]).toContain("Max-Age=28800");
    expect(cookies[1]).toContain("github_oauth_state=");
    expect(cookies[1]).toContain("Max-Age=0");
  });

  it("maps a denied authorization to access_denied and deletes state", async () => {
    const response = await GET(request("error=access_denied&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=access_denied&login=failed");
    expect(response.headers.getSetCookie()).toEqual([expect.stringContaining("github_oauth_state=; ")]);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  // state가 우리 것이 아니면 쿠키를 지우지 않습니다. 지우면 크로스사이트 호출로 남의 로그인을 끊을 수 있습니다.
  it.each([
    ["a mismatched state", "code=code&state=wrong"],
    ["a missing state", "code=code"],
    ["an error without a state", "error=access_denied"],
  ])("keeps the state cookie on %s", async (_label, query) => {
    const response = await GET(request(query));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=state_mismatch&login=failed");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("maps missing OAuth configuration to config_missing", async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    const response = await GET(request("code=code&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=config_missing&login=failed");
  });

  it("maps a missing code to exchange_failed", async () => {
    const response = await GET(request("state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=exchange_failed&login=failed");
  });

  it("maps a missing session encryption key to config_missing", async () => {
    delete process.env[GITHUB_SESSION_KEY_ENV];
    stubGitHub();
    const response = await GET(request("code=code&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=config_missing&login=failed");
    expect(response.headers.get("set-cookie")).not.toContain("github_session=");
  });

  it("sends the exchange request to GitHub with the client secret", async () => {
    const fetchMock = stubGitHub();
    await GET(request("code=the-code&state=state"));
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/login/oauth/access_token",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Accept: "application/json" }) })
    );
    const body = String(fetchMock.mock.calls[0][1]?.body);
    expect(body).toContain("client_secret=client-secret");
    expect(body).toContain("code=the-code");
  });

  it("maps a client credential error to config_missing", async () => {
    stubGitHub({ exchange: () => Response.json({ error: "incorrect_client_credentials" }) });
    const response = await GET(request("code=code&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=config_missing&login=failed");
  });

  it("maps exchange failures to exchange_failed", async () => {
    stubGitHub({ exchange: () => new Response("", { status: 500 }) });
    const response = await GET(request("code=code&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=exchange_failed&login=failed");
    expect(response.headers.get("set-cookie")).toContain("github_oauth_state=; ");
  });

  it("puts the GitHub user id in the session cookie", async () => {
    const fetchMock = stubGitHub();
    const response = await GET(request("code=code&state=state"));
    expect(fetchMock).toHaveBeenCalledWith("https://api.github.com/user", expect.anything());
    expect(decryptGitHubSession(sessionCookieValue(response))).toEqual({ token: "token", githubUserId: USER_ID });
  });

  /**
   * `/user` 실패를 config_missing으로 보내면, GitHub이 잠시 답하지 않는 상황에 사용자가 서버 설정을
   * 고치라는 안내를 받습니다. config_missing은 우리 OAuth 설정과 암호화 키가 없을 때만 씁니다.
   */
  it.each([
    ["a 500 from GET /user", () => new Response("", { status: 500 })],
    ["a rate limited GET /user", () => Response.json({ message: "rate limited" }, { status: 429 })],
    ["a GET /user response without a user id", () => Response.json({ login: "octocat" })],
  ])("maps %s to exchange_failed without setting a session", async (_label, user) => {
    stubGitHub({ user });
    const response = await GET(request("code=code&state=state"));
    expect(response.headers.get("location")).toBe("https://app.test/?auth_error=exchange_failed&login=failed");
    expect(response.headers.getSetCookie()).not.toContainEqual(expect.stringContaining("github_session="));
  });
});

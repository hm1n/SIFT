import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encryptGitHubToken, GITHUB_SESSION_COOKIE, GITHUB_SESSION_KEY_ENV } from "@/lib/github/auth-session";
import { GET } from "./route";

function request(authenticated: boolean) {
  const cookie = authenticated ? `${GITHUB_SESSION_COOKIE}=${encryptGitHubToken("secret")}` : "";
  return new NextRequest("http://localhost/api/github/repositories", {
    method: "GET",
    headers: cookie ? { cookie } : {},
  });
}

function rawRepository(id: number) {
  return { id, name: `repo-${id}`, owner: { login: "octocat" }, private: false, language: "TypeScript", pushed_at: "2026-09-10T00:00:00Z" };
}

beforeEach(() => {
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 9).toString("base64");
});
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/github/repositories", () => {
  it("쿠키가 없으면 GitHub를 부르지 않고 auth_revoked 401을 반환한다", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(false));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { kind: "auth_revoked" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("세션 토큰으로 GitHub를 부르고 요약 목록을 반환한다", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json([rawRepository(1)]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request(true));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      repositories: [{ id: 1, owner: "octocat", name: "repo-1", visibility: "public", language: "TypeScript", pushedAt: "2026-09-10T00:00:00Z" }],
    });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer secret" } });
  });

  it("Repository가 없으면 빈 배열의 200을 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json([])));
    const response = await GET(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ repositories: [] });
  });

  it.each([
    ["401", Response.json({ message: "Bad credentials" }, { status: 401 }), 401, "auth_revoked"],
    ["primary rate limit 403", Response.json({}, { status: 403, headers: { "x-ratelimit-remaining": "0" } }), 429, "rate_limit"],
    ["secondary rate limit 403", Response.json({ message: "secondary rate limit" }, { status: 403 }), 429, "rate_limit"],
    ["권한 403", Response.json({ message: "SAML enforcement" }, { status: 403 }), 401, "auth_revoked"],
    ["429", Response.json({}, { status: 429 }), 429, "rate_limit"],
    ["404", Response.json({ message: "Not Found" }, { status: 404 }), 500, "server_error"],
    ["422", Response.json({ message: "Validation Failed" }, { status: 422 }), 500, "server_error"],
    ["깨진 JSON", new Response("{broken", { status: 200 }), 502, "network"],
  ] as const)("GitHub %s 응답을 오류 봉투로 바꾼다", async (_name, githubResponse, status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(githubResponse));

    const response = await GET(request(true));

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { kind } });
  });

  it("GitHub 연결 자체가 실패하면 network 502를 반환한다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
    const response = await GET(request(true));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { kind: "network" } });
  });
});

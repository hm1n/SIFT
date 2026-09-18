import { randomBytes, timingSafeEqual } from "node:crypto";
import { isGitHubRateLimited } from "./rate-limit";

export const GITHUB_OAUTH_STATE_COOKIE = "github_oauth_state";

const STATE_COOKIE_OPTIONS = "Path=/; HttpOnly; Secure; SameSite=Lax";

export function createOAuthStateCookie(state: string): string {
  return `${GITHUB_OAUTH_STATE_COOKIE}=${state}; ${STATE_COOKIE_OPTIONS}; Max-Age=600`;
}

/** state는 일회용이므로 콜백이 어떻게 끝나든 지웁니다. */
export function deleteOAuthStateCookie(): string {
  return `${GITHUB_OAUTH_STATE_COOKIE}=; ${STATE_COOKIE_OPTIONS}; Max-Age=0`;
}

/**
 * 사용자가 조치할 수 없는 서버 문제를 교환 실패와 구분합니다. 앞은 다시 시도해도 같은 결과이고
 * 뒤는 다시 시도할 값이 있습니다.
 */
export class GitHubOAuthConfigError extends Error {}

/** GitHub이 HTTP 200 본문으로 돌려주는 오류 중 서버 설정이 원인인 것입니다. */
const CONFIG_ERROR_CODES = new Set(["incorrect_client_credentials", "redirect_uri_mismatch"]);

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
export type GitHubOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string };

/**
 * OAuth App의 client id와 secret입니다. 둘 중 하나라도 없으면 `null`입니다.
 *
 * 두 환경변수를 읽는 자리를 이 함수 하나로 둡니다. 로그인은 없으면 던져야 하고(사용자가 할 수 있는
 * 일이 없는 서버 설정 문제입니다) 회원 탈퇴의 grant 해제는 없어도 데이터 삭제를 끝내야 해서, 두
 * 경로가 없을 때 하는 일이 다릅니다. 그 차이는 각자 정하게 하고 이름은 한 곳에 둡니다.
 */
function oauthAppCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getGitHubOAuthConfig(requestUrl: string): GitHubOAuthConfig {
  const credentials = oauthAppCredentials();
  if (credentials === null) throw new GitHubOAuthConfigError("GitHub OAuth configuration is missing");
  return { ...credentials, redirectUri: process.env.GITHUB_OAUTH_REDIRECT_URI ?? new URL("/api/auth/github/callback", new URL(requestUrl).origin).toString() };
}

/**
 * scope는 `read:user repo`입니다. `repo`는 OAuth App이 비공개 Repository를 읽을 수 있는 유일한 scope이고
 * 쓰기 권한도 함께 줍니다. `read:user` 하나만 요청하던 이전 결정(PR #73)은 비공개 Repository를 지원하지
 * 않기로 한 트레이드오프였습니다. PR #102 리뷰에서 지적된 뒤 `repo`로 넓히기로 다시 정했습니다.
 */
export function createGitHubAuthorizeUrl(config: GitHubOAuthConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({ client_id: config.clientId, redirect_uri: config.redirectUri, scope: "read:user repo", state }).toString();
  return url.toString();
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function oauthStatesMatch(expected: string | undefined, actual: string | null): boolean {
  if (!expected || !actual) return false;
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

export async function exchangeGitHubCode(config: GitHubOAuthConfig, code: string): Promise<string> {
  const response = await fetch(ACCESS_TOKEN_URL, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: config.redirectUri }),
  });
  if (!response.ok) throw new Error(`GitHub token exchange failed with status ${response.status}`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new Error("GitHub token exchange returned invalid JSON"); }
  if (typeof body !== "object" || body === null) throw new Error("GitHub token exchange returned an invalid body");
  if ("error" in body) {
    const errorCode = String(body.error);
    const message = `GitHub token exchange returned an error: ${errorCode}`;
    throw CONFIG_ERROR_CODES.has(errorCode) ? new GitHubOAuthConfigError(message) : new Error(message);
  }
  const token = "access_token" in body ? body.access_token : undefined;
  if (typeof token !== "string" || !token) throw new Error("GitHub token exchange returned no access token");
  return token;
}

/**
 * grant 해제의 결과입니다. 실패해도 회원 탈퇴는 계속 진행하므로 예외가 아니라 값으로 돌려줍니다.
 *
 * 실패 이유를 나누는 이유는 둘입니다. 사용자에게 다시 시도할 여지가 있는지 알려 주려면 한도 초과와
 * 서버 설정 누락을 갈라야 하고, Sentry에 남는 값으로 어느 쪽이 실제로 일어나는지 봐야 합니다.
 */
export type RevokeGrantFailure = "config_missing" | "invalid_credentials" | "rate_limit" | "rejected" | "network";

export type RevokeGrantResult = { status: "revoked" } | { status: "failed"; reason: RevokeGrantFailure };

const GRANT_URL = (clientId: string) =>
  `https://api.github.com/applications/${encodeURIComponent(clientId)}/grant`;

/**
 * 사용자가 이 OAuth App에 준 grant를 지웁니다(이슈 #145, 회원 탈퇴).
 *
 * 문서(`DELETE /applications/{client_id}/grant`, 2026-09-18 확인)가 정하는 계약입니다. 인증은 Basic이고
 * username이 client id, password가 client secret입니다. 사용자 토큰은 본문의 `access_token`으로 보냅니다.
 * 성공은 204이고 본문이 없습니다. grant를 지우면 그 사용자에게 발급된 이 App의 토큰이 모두 죽고
 * GitHub의 승인된 앱 목록에서도 사라집니다.
 *
 * 토큰 하나만 지우는 `DELETE /applications/{client_id}/token`을 쓰지 않습니다. 그 호출은 지금 브라우저의
 * 세션만 끊고 다른 기기에서 받아 둔 토큰은 남기므로, 권한을 끊었다고 말할 수 없습니다.
 *
 * 문서에 없는 상태 코드도 가립니다. 404는 지울 grant가 없는 경우입니다. 사용자가 GitHub 설정에서 이미
 * 해제했거나 토큰이 이미 죽은 것이고, 어느 쪽이든 "권한이 남지 않는다"는 목표는 이뤄져 있으므로
 * 해제로 봅니다. 401은 client id와 secret이 틀린 경우라 다시 시도해도 같습니다. 403과 429는
 * 요청 한도이므로 한도로 분류합니다. 그 밖(422와 5xx)은 거절로 묶습니다.
 *
 * 응답 본문을 읽지 않습니다. 성공이 204라 읽을 것이 없고, 실패 분류에 필요한 본문은 한도 판별이
 * 자기 안에서 try/catch로 읽습니다.
 */
export async function revokeGitHubGrant(token: string): Promise<RevokeGrantResult> {
  const credentials = oauthAppCredentials();
  if (credentials === null) return { status: "failed", reason: "config_missing" };

  let response: Response;
  try {
    response = await fetch(GRANT_URL(credentials.clientId), {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ access_token: token }),
    });
  } catch {
    return { status: "failed", reason: "network" };
  }

  if (response.status === 204 || response.status === 404) return { status: "revoked" };
  if (await isGitHubRateLimited(response)) return { status: "failed", reason: "rate_limit" };
  if (response.status === 401) return { status: "failed", reason: "invalid_credentials" };
  return { status: "failed", reason: "rejected" };
}

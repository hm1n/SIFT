import { createGitHubSessionCookie, encryptGitHubSession, type GitHubSession } from "@/lib/github/auth-session";
import { fetchAuthenticatedUser } from "@/lib/github/commits";
import { GitHubFetchError } from "@/lib/github/errors";
import {
  GITHUB_OAUTH_STATE_COOKIE,
  GitHubOAuthConfigError,
  deleteOAuthStateCookie,
  exchangeGitHubCode,
  getGitHubOAuthConfig,
  oauthStatesMatch,
} from "@/lib/github/oauth";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

/**
 * state가 일치하지 않으면 쿠키를 지우지 않습니다. 그 값은 우리가 시작한 로그인의 것이 아닙니다.
 * 지우면 아무나 이 엔드포인트를 크로스사이트로 호출해 진행 중인 남의 로그인을 끊을 수 있습니다.
 */
function redirect(request: Request, code?: string, clearState = true): Response {
  const headers = new Headers({ Location: new URL(code ? `/?auth_error=${code}` : "/", request.url).toString() });
  if (clearState) headers.append("Set-Cookie", deleteOAuthStateCookie());
  return new Response(null, { status: 302, headers });
}

export async function GET(request: NextRequest): Promise<Response> {
  const query = request.nextUrl.searchParams;
  // GitHub은 거부 콜백에도 state를 실어 보내므로 취소 흐름보다 먼저 검증할 수 있습니다.
  if (!oauthStatesMatch(request.cookies.get(GITHUB_OAUTH_STATE_COOKIE)?.value, query.get("state"))) {
    return redirect(request, "state_mismatch", false);
  }
  if (query.has("error")) return redirect(request, "access_denied");
  let session: GitHubSession;
  try {
    const config = getGitHubOAuthConfig(request.url);
    const code = query.get("code");
    if (!code) throw new Error("GitHub OAuth code is missing");
    const token = await exchangeGitHubCode(config, code);
    /**
     * 사용자 번호 조회를 쿠키를 굽는 단계와 나눠 둡니다. 아래 단계의 `server_error`는 암호화 키가
     * 없거나 32바이트가 아닌 경우뿐이라 `config_missing`이 맞지만, `/user` 실패의 `server_error`는
     * 로그인 설정 문제가 아닙니다. 한 갈래로 묶으면 GitHub이 잠시 답하지 않을 때 사용자가 서버
     * 설정을 고치라는 안내를 받습니다.
     */
    session = { token, githubUserId: (await fetchAuthenticatedUser(token)).id };
  } catch (error) {
    if (error instanceof GitHubOAuthConfigError) return redirect(request, "config_missing");
    return redirect(request, "exchange_failed");
  }
  try {
    /**
     * 성공도 실패처럼 쿼리로 표시합니다. 실패는 이미 `?auth_error=`로 돌아가는데 성공만 표시가
     * 없어서, 계측이 "세션이 있는 첫 렌더"를 로그인 성공으로 볼 수밖에 없었습니다. 세션 쿠키는
     * 8시간을 살고 새로고침마다 그 조건이 성립하므로 그 판정으로는 로그인 성공 수가 아니라 페이지
     * 로드 수가 세어집니다. 이 표시를 읽고 지우는 일은 `features/analytics/analytics-session.tsx`가
     * 합니다(이슈 #125).
     */
    const headers = new Headers({ Location: new URL("/?login=success", request.url).toString() });
    headers.append("Set-Cookie", createGitHubSessionCookie(encryptGitHubSession(session)));
    headers.append("Set-Cookie", deleteOAuthStateCookie());
    return new Response(null, { status: 302, headers });
  } catch (error) {
    return redirect(request, error instanceof GitHubFetchError && error.kind === "server_error" ? "config_missing" : "exchange_failed");
  }
}

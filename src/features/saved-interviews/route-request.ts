import type { NextRequest } from "next/server";
import { savedInterviewErrorResponse } from "./errors";
import { getGitHubSessionFromRequest, type GitHubSession } from "@/lib/github/auth-session";
import { GitHubFetchError } from "@/lib/github/errors";
import { reportServerError } from "@/lib/sentry/server";

/**
 * 저장 계층을 쓰는 라우트가 공통으로 하는 두 가지입니다. 세션에서 사용자 번호를 꺼내는 일과 본문을
 * 상한 안에서 읽어 JSON으로 푸는 일입니다.
 *
 * 이슈 #115에서는 인터뷰 라우트 안에 있었는데, 이슈 #116에서 분석 라우트가 생기면서 밖으로 꺼냈습니다.
 * 라우트마다 따로 쓰면 한쪽만 상한을 헤더로 먼저 보는 식으로 판정이 갈립니다.
 */

/** 세션에서 사용자 번호를 꺼냅니다. 꺼내지 못하면 그대로 돌려줄 응답을 냅니다. */
export function requireUserId(request: NextRequest): { userId: number } | { response: Response } {
  const session = requireSession(request);
  return "response" in session ? session : { userId: session.session.githubUserId };
}

/**
 * 세션을 그대로 꺼냅니다. 꺼내지 못하면 돌려줄 응답을 냅니다.
 *
 * 사용자 번호만 쓰는 라우트가 대부분이라 `requireUserId`가 먼저 있었습니다. 회원 탈퇴는 GitHub에
 * 준 권한을 해제하는 데 토큰이 필요해서(이슈 #145) 세션 전체를 받습니다. 같은 오류 판정을 두 번
 * 적지 않도록 번호를 꺼내는 쪽이 이 함수를 거칩니다.
 */
export function requireSession(request: NextRequest): { session: GitHubSession } | { response: Response } {
  try {
    return { session: getGitHubSessionFromRequest(request) };
  } catch (error) {
    if (error instanceof GitHubFetchError && error.kind === "auth_revoked") {
      return { response: savedInterviewErrorResponse("unauthorized", "GitHub 인증 세션이 필요합니다.") };
    }
    // 세션 쿠키가 있는데 암호화 키 설정이 없거나 32바이트가 아니면 여기로 옵니다. 사용자가 다시
    // 로그인해도 풀리지 않으므로 인증 실패와 갈라 둡니다. `experience-block` 라우트와 같습니다.
    return {
      response: reportServerError(
        error,
        savedInterviewErrorResponse("server_error", "서버 설정 문제로 요청을 처리하지 못했습니다.")
      ),
    };
  }
}

/**
 * 본문을 상한 안에서 읽어 JSON으로 풉니다.
 *
 * 선언한 길이를 먼저 봅니다. 본문을 다 읽은 뒤에야 거절하면 상한을 넘는 본문을 그만큼 읽습니다.
 * 선언한 길이는 보내는 쪽이 적는 값이라 믿을 수 없으므로, 읽은 뒤에 실제 바이트 수로 한 번 더 봅니다.
 */
export async function readJsonBody(
  request: NextRequest,
  maxBytes: number
): Promise<{ json: unknown } | { response: Response }> {
  const tooLarge = () => ({
    response: savedInterviewErrorResponse(
      "body_too_large",
      `요청 본문은 ${Math.floor(maxBytes / 1024)}KB 이하여야 합니다.`
    ),
  });

  if (Number(request.headers.get("content-length")) > maxBytes) return tooLarge();

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return tooLarge();

  try {
    return { json: JSON.parse(text) as unknown };
  } catch {
    return { response: savedInterviewErrorResponse("invalid_json", "요청 본문은 JSON이어야 합니다.") };
  }
}

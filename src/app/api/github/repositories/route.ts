import type { NextRequest } from "next/server";
import { errorResponse } from "@/lib/github/api-contract";
import { getGitHubTokenFromRequest } from "@/lib/github/auth-session";
import { fetchUserRepositories } from "@/lib/github/repositories";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 세션 사용자의 Repository 목록입니다. 다른 GitHub 라우트와 달리 owner·repo가 없는 GET이라 `readGitHubRouteRequest`를
 * 거치지 않고 쿠키에서 토큰만 읽습니다. 오류 봉투는 기존 라우트와 같은 `errorResponse`입니다.
 */
export async function GET(request: NextRequest): Promise<Response> {
  try {
    const token = getGitHubTokenFromRequest(request);
    const repositories = await fetchUserRepositories(token);
    return Response.json({ repositories });
  } catch (error) {
    return errorResponse(error);
  }
}

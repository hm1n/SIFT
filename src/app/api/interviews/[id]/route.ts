import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  toSavedInterviewError,
} from "@/features/saved-interviews/errors";
import { toStoredInterviewPayload } from "@/features/saved-interviews/payload";
import { getGitHubSessionFromRequest } from "@/lib/github/auth-session";
import { GitHubFetchError } from "@/lib/github/errors";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 저장된 인터뷰 하나를 복원하고 지웁니다(이슈 #115).
 *
 * 없는 인터뷰와 남의 인터뷰를 구분하지 않고 둘 다 `not_found`로 답합니다. 구분해 알려 주면 다른
 * 사람의 인터뷰가 있는지 없는지를 알 수 있게 됩니다. 저장 계층이 이미 둘을 구분하지 않습니다.
 */
const NOT_FOUND_MESSAGE = "그 인터뷰를 찾을 수 없습니다. 목록에서 다시 골라 주세요.";

function requireUserId(request: NextRequest): { userId: number } | { response: Response } {
  try {
    return { userId: getGitHubSessionFromRequest(request).githubUserId };
  } catch (error) {
    if (error instanceof GitHubFetchError && error.kind === "auth_revoked") {
      return { response: savedInterviewErrorResponse("unauthorized", "GitHub 인증 세션이 필요합니다.") };
    }
    return { response: savedInterviewErrorResponse("server_error", "서버 설정 문제로 요청을 처리하지 못했습니다.") };
  }
}

export async function handleGetInterview(
  request: NextRequest,
  id: string,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  try {
    const interview = await store.getInterview(id, session.userId);
    if (interview === null) return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
    return Response.json({ interview: toStoredInterviewPayload(interview) });
  } catch (error) {
    const mapped = toSavedInterviewError(error);
    return savedInterviewErrorResponse(mapped.kind, mapped.message);
  }
}

export async function handleDeleteInterview(
  request: NextRequest,
  id: string,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  try {
    const deleted = await store.deleteInterview(id, session.userId);
    if (!deleted) return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
    // 지운 뒤에 돌려줄 내용이 없습니다. 빈 객체를 싣는 것보다 본문이 없다는 것을 상태로 말합니다.
    return new Response(null, { status: 204 });
  } catch (error) {
    const mapped = toSavedInterviewError(error);
    return savedInterviewErrorResponse(mapped.kind, mapped.message);
  }
}

export async function GET(request: NextRequest, context: RouteContext<"/api/interviews/[id]">): Promise<Response> {
  return handleGetInterview(request, (await context.params).id);
}

export async function DELETE(request: NextRequest, context: RouteContext<"/api/interviews/[id]">): Promise<Response> {
  return handleDeleteInterview(request, (await context.params).id);
}

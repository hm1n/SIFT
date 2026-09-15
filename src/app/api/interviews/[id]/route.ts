import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  toSavedInterviewError,
} from "@/features/saved-interviews/errors";
import { toStoredInterviewPayload } from "@/features/saved-interviews/payload";
import {
  blockEditSentences,
  isBlockEditBody,
  parseBlockEditBody,
} from "@/features/saved-interviews/request";
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

/**
 * 끝난 인터뷰의 블록 문장을 고칩니다(이슈 #115).
 *
 * **끝난 인터뷰만 고칠 수 있습니다.** 진행 중인 인터뷰를 고쳐 두면 이어간 뒤 모델이 그 블록을
 * 건드리는 순간 `applyBlockUpdate`가 표시 문장을 통째로 갈아 끼워 고친 문장이 사라집니다. 사라질
 * 편집을 저장해 주는 것보다 받지 않는 편이 낫습니다.
 *
 * 저장 계층에 연산을 새로 만들지 않고 `appendTurn`에 빈 턴을 넘깁니다. 이력은 그대로 두고 블록
 * 상태와 버전만 바뀌며, 다른 탭이 먼저 저장한 경우를 막는 조건도 그 연산이 이미 들고 있습니다.
 *
 * 새 버전은 저장된 블록 버전보다 1 큽니다. 화면이 보낸 값이 아니라 방금 읽은 값에서 셉니다.
 */
async function handleBlockEdit(
  json: unknown,
  id: string,
  userId: number,
  store: SiftStore
): Promise<Response> {
  const parsed = parseBlockEditBody(json);
  if (!parsed.ok) return savedInterviewErrorResponse(parsed.kind, parsed.message);

  const interview = await store.getInterview(id, userId);
  if (interview === null) return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
  if (interview.status !== "completed") {
    return savedInterviewErrorResponse(
      "invalid_request",
      "인터뷰를 끝낸 뒤에만 블록 문장을 고칠 수 있습니다."
    );
  }
  if (interview.blockVersion !== parsed.body.expectedBlockVersion) {
    return savedInterviewErrorResponse(
      "version_conflict",
      "이 인터뷰가 다른 곳에서 먼저 바뀌었습니다. 최신 내용을 불러온 뒤에 다시 고쳐 주세요."
    );
  }

  const blockVersion = interview.blockVersion + 1;
  /*
   * 고친 블록의 미해소 충돌도 함께 지웁니다(PR #127 리뷰).
   *
   * 충돌은 모델이 낸 주장과 저장소 관찰이 어긋난 지점이라 특정 주장에 매여 있습니다. 사용자가 그 블록을
   * 자기 문장으로 바꾸면 그 주장은 화면에서 사라지는데, 충돌만 남기면 다시 열었을 때 쓴 적 없는 문장에
   * 대한 경고가 뜹니다. 화면은 편집 직후에만 충돌을 숨기므로(`effectiveConflicts`) 저장된 값에서
   * 지우지 않으면 그 성질이 다시 읽는 순간 깨집니다(설계 8절).
   *
   * 주장 자체는 남깁니다. 표시 문장이 더 이상 그 주장을 참조하지 않아 화면에 나오지 않고, 그 블록이
   * 무엇을 근거로 쌓였는지는 저장된 기록으로 남겨 두는 편이 낫습니다.
   */
  const editedClaimIds = new Set(
    interview.blockState.claims.filter((claim) => claim.block === parsed.body.block).map((claim) => claim.id)
  );
  const result = await store.appendTurn({
    githubUserId: userId,
    interviewId: id,
    turn: [],
    blockState: {
      ...interview.blockState,
      version: blockVersion,
      display: { ...interview.blockState.display, [parsed.body.block]: blockEditSentences(parsed.body) },
      conflicts: interview.blockState.conflicts.filter((conflict) => !editedClaimIds.has(conflict.claimId)),
    },
    progress: interview.progress,
    expectedBlockVersion: interview.blockVersion,
  });
  if (result === "not_found") return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
  if (result === "version_conflict") {
    return savedInterviewErrorResponse(
      "version_conflict",
      "이 인터뷰가 다른 곳에서 먼저 바뀌었습니다. 최신 내용을 불러온 뒤에 다시 고쳐 주세요."
    );
  }
  return Response.json({ blockVersion });
}

/**
 * 저장된 인터뷰 하나를 고칩니다(이슈 #115). 바꿀 수 있는 것은 둘입니다. 끝난 것으로 표시하는 것과
 * 끝난 인터뷰의 블록 문장을 고치는 것입니다.
 *
 * 둘 다 턴 저장에 얹지 않고 여기 둡니다. 끝내는 조작도 블록 편집도 답변 제출과 함께 오지 않아서 얹을
 * 요청이 없습니다. 저장 전용 경로를 새로 만들지 않는다는 Constraint는 이 한 자리에 모아 지킵니다.
 *
 * 상태를 되돌리는 값(`in_progress`)은 받지 않습니다. 끝낸 인터뷰를 다시 여는 조작이 화면에 없고,
 * 받아 두면 쓰지 않는 경로가 남습니다.
 */
export async function handlePatchInterview(
  request: NextRequest,
  id: string,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return savedInterviewErrorResponse("invalid_json", "요청 본문은 JSON이어야 합니다.");
  }

  try {
    if (isBlockEditBody(json)) return await handleBlockEdit(json, id, session.userId, store);

    if (typeof json !== "object" || json === null || (json as { status?: unknown }).status !== "completed") {
      return savedInterviewErrorResponse("invalid_request", 'status는 "completed"여야 합니다.');
    }
    const completed = await store.completeInterview(id, session.userId);
    if (!completed) return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
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

export async function PATCH(request: NextRequest, context: RouteContext<"/api/interviews/[id]">): Promise<Response> {
  return handlePatchInterview(request, (await context.params).id);
}

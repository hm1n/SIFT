import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  savedInterviewErrorResponseFor,
} from "@/features/saved-interviews/errors";
import {
  MAX_CREATE_INTERVIEW_BODY_BYTES,
  parseCreateInterviewBody,
} from "@/features/saved-interviews/request";
import { toInterviewListItemPayload } from "@/features/saved-interviews/payload";
import { readJsonBody, requireUserId } from "@/features/saved-interviews/route-request";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 저장된 인터뷰 목록과 인터뷰 만들기입니다(이슈 #115).
 *
 * 저장 계층을 매개변수로 받고 기본값으로 실제 구현을 씁니다. 테스트는 `createInMemoryStore()`를 넘겨
 * 데이터베이스 없이 돕니다. `experience-block` 라우트가 `GenerateBlockUpdate`를 받는 방식과 같습니다.
 */

export async function handleListInterviews(
  request: NextRequest,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  try {
    const interviews = await store.listInterviews(session.userId);
    return Response.json({ interviews: interviews.map(toInterviewListItemPayload) });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

export async function handleCreateInterview(
  request: NextRequest,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  const body = await readJsonBody(request, MAX_CREATE_INTERVIEW_BODY_BYTES);
  if ("response" in body) return body.response;

  const parsed = parseCreateInterviewBody(body.json);
  if (!parsed.ok) return savedInterviewErrorResponse(parsed.kind, parsed.message);

  const { analysisId, candidateKey, title, evidence } = parsed.body;

  try {
    const interviewId = await store.createInterview({
      githubUserId: session.userId,
      analysisId,
      candidateKey,
      title,
      evidence,
    });
    /**
     * 가리킨 분석이 없거나 남의 것입니다(이슈 #116).
     *
     * 이슈 #115에서는 이 자리에서 분석을 새로 저장하고 넘어갔습니다. 그 폴백을 없앴습니다. 저장 시점이
     * Stage B 직후로 옮겨 가면서 분석을 만드는 일은 이 요청의 몫이 아니게 됐고, 폴백이 남아 있으면
     * 확정 요청이 겹칠 때 같은 분석이 여러 줄로 쌓입니다(backlog 9번). 화면은 이 응답을 받으면
     * 분석을 다시 저장한 뒤 새 식별자로 다시 요청합니다.
     */
    if (interviewId === null) {
      return savedInterviewErrorResponse("not_found", "저장된 분석을 찾을 수 없습니다.");
    }
    return Response.json({ interviewId, analysisId });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

export function GET(request: NextRequest): Promise<Response> {
  return handleListInterviews(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return handleCreateInterview(request);
}

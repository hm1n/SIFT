import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  savedInterviewErrorResponseFor,
} from "@/features/saved-interviews/errors";
import { toStoredAnalysisPayload } from "@/features/saved-interviews/payload";
import { requireUserId } from "@/features/saved-interviews/route-request";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 저장된 분석 하나를 식별자로 읽습니다(이슈 #116). 저장된 인터뷰의 요약 화면에서 그 분석의 후보
 * 목록으로 갈 때 쓰는 경로입니다.
 *
 * 없는 분석과 남의 분석을 구분하지 않습니다. 구분해 알려 주면 남의 분석이 있는지 없는지를 알 수
 * 있게 됩니다(정의서 "남의 데이터에 닿지 않게 하는 방법").
 */
const NOT_FOUND_MESSAGE = "저장된 분석을 찾을 수 없습니다.";

export async function handleGetAnalysis(
  request: NextRequest,
  id: string,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  try {
    const analysis = await store.getAnalysis(id, session.userId);
    if (analysis === null) return savedInterviewErrorResponse("not_found", NOT_FOUND_MESSAGE);
    const payload = toStoredAnalysisPayload(analysis);
    // 저장된 값이 지금 화면이 그릴 수 있는 모양이 아닌 경우입니다. 이유는 `handleFindAnalysis`와 같습니다.
    if (payload === null) return savedInterviewErrorResponse("not_found", "저장된 분석을 읽을 수 없습니다.");
    return Response.json({ analysis: payload });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

export async function GET(request: NextRequest, context: RouteContext<"/api/analyses/[id]">): Promise<Response> {
  return handleGetAnalysis(request, (await context.params).id);
}

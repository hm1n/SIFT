import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  savedInterviewErrorResponseFor,
} from "@/features/saved-interviews/errors";
import { toStoredAnalysisPayload } from "@/features/saved-interviews/payload";
import { MAX_SAVE_ANALYSIS_BODY_BYTES, parseSaveAnalysisBody } from "@/features/saved-interviews/request";
import { readJsonBody, requireUserId } from "@/features/saved-interviews/route-request";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 저장된 분석을 만들고 찾는 경로입니다(이슈 #116).
 *
 * 이슈 #115는 저장 전용 경로를 새로 만들지 않는다는 제약을 지켜 분석 저장을 인터뷰 생성 요청에
 * 얹었습니다. 저장 시점을 정의서가 정한 자리(Stage B 성공 직후)로 옮기면 얹을 요청이 없습니다.
 * 그 시점에 오가는 요청은 Stage B 호출 하나뿐인데, 거기에 얹으면 분석 결과를 서버가 두 번
 * 조립하거나 모델 호출의 성공 여부에 저장이 묶입니다(backlog 7번과 같은 구조입니다).
 *
 * 저장 계층을 매개변수로 받고 기본값으로 실제 구현을 씁니다. 테스트는 `createInMemoryStore()`를 넘겨
 * 데이터베이스 없이 돕니다.
 */

export async function handleSaveAnalysis(
  request: NextRequest,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  const body = await readJsonBody(request, MAX_SAVE_ANALYSIS_BODY_BYTES);
  if ("response" in body) return body.response;

  const parsed = parseSaveAnalysisBody(body.json);
  if (!parsed.ok) return savedInterviewErrorResponse(parsed.kind, parsed.message);

  const { analysis } = parsed.body;
  try {
    const analysisId = await store.saveAnalysis({
      githubUserId: session.userId,
      repoOwner: analysis.repoOwner,
      repoName: analysis.repoName,
      contributionItems: analysis.contributionItems,
      candidates: analysis.candidates,
      stageASummary: analysis.stageASummary,
    });
    return Response.json({ analysisId });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

/**
 * 저장소 이름으로 저장된 분석을 찾습니다. 목록이 아니라 한 줄입니다.
 *
 * 목록을 내지 않는 이유는 저장된 분석을 훑어보는 화면이 없기 때문입니다. 분석에 닿는 자리는 둘이고
 * 둘 다 어느 분석인지가 이미 정해져 있습니다. Repository를 고르고 들어오는 경로는 그 저장소의 최신
 * 분석이고, 저장된 인터뷰의 요약 화면에서 들어오는 경로는 그 인터뷰의 `analysisId`입니다.
 */
export async function handleFindAnalysis(
  request: NextRequest,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  const owner = request.nextUrl.searchParams.get("owner");
  const repo = request.nextUrl.searchParams.get("repo");
  if (owner === null || owner === "" || repo === null || repo === "") {
    return savedInterviewErrorResponse("invalid_request", "owner와 repo가 필요합니다.");
  }

  try {
    const analysis = await store.getLatestAnalysisByRepo(session.userId, owner, repo);
    if (analysis === null) {
      return savedInterviewErrorResponse("not_found", "저장된 분석이 없습니다.");
    }
    const payload = toStoredAnalysisPayload(analysis);
    if (payload === null) {
      // 저장은 돼 있지만 지금 화면이 그릴 수 있는 모양이 아닙니다. 없는 것으로 답하면 사용자는 다시
      // 분석하면 된다고 알 수 있는데, 지금 화면이 못 그리는 것이라 그 안내가 맞습니다.
      return savedInterviewErrorResponse("not_found", "저장된 분석을 읽을 수 없습니다.");
    }
    return Response.json({ analysis: payload });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

export function POST(request: NextRequest): Promise<Response> {
  return handleSaveAnalysis(request);
}

export function GET(request: NextRequest): Promise<Response> {
  return handleFindAnalysis(request);
}

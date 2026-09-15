import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponse,
  toSavedInterviewError,
} from "@/features/saved-interviews/errors";
import {
  MAX_CREATE_INTERVIEW_BODY_BYTES,
  parseCreateInterviewBody,
} from "@/features/saved-interviews/request";
import { toInterviewListItemPayload } from "@/features/saved-interviews/payload";
import { getGitHubSessionFromRequest } from "@/lib/github/auth-session";
import { GitHubFetchError } from "@/lib/github/errors";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 저장된 인터뷰 목록과 인터뷰 만들기입니다(이슈 #115).
 *
 * 저장 계층을 매개변수로 받고 기본값으로 실제 구현을 씁니다. 테스트는 `createInMemoryStore()`를 넘겨
 * 데이터베이스 없이 돕니다. `experience-block` 라우트가 `GenerateBlockUpdate`를 받는 방식과 같습니다.
 */

/** 세션에서 사용자 번호를 꺼냅니다. 꺼내지 못하면 그대로 응답을 돌려줍니다. */
function requireUserId(request: NextRequest): { userId: number } | { response: Response } {
  try {
    return { userId: getGitHubSessionFromRequest(request).githubUserId };
  } catch (error) {
    if (error instanceof GitHubFetchError && error.kind === "auth_revoked") {
      return { response: savedInterviewErrorResponse("unauthorized", "GitHub 인증 세션이 필요합니다.") };
    }
    // 세션 쿠키가 있는데 암호화 키 설정이 없거나 32바이트가 아니면 여기로 옵니다. 사용자가 다시
    // 로그인해도 풀리지 않으므로 인증 실패와 갈라 둡니다. `experience-block` 라우트와 같습니다.
    return { response: savedInterviewErrorResponse("server_error", "서버 설정 문제로 요청을 처리하지 못했습니다.") };
  }
}

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
    const mapped = toSavedInterviewError(error);
    return savedInterviewErrorResponse(mapped.kind, mapped.message);
  }
}

export async function handleCreateInterview(
  request: NextRequest,
  store: SiftStore = neonStore()
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  const tooLarge = () =>
    savedInterviewErrorResponse(
      "body_too_large",
      `요청 본문은 ${Math.floor(MAX_CREATE_INTERVIEW_BODY_BYTES / 1024)}KB 이하여야 합니다.`
    );

  // 선언한 길이를 먼저 봅니다. 본문을 다 읽은 뒤에야 거절하면 상한을 넘는 본문을 그만큼 읽습니다.
  if (Number(request.headers.get("content-length")) > MAX_CREATE_INTERVIEW_BODY_BYTES) return tooLarge();

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_CREATE_INTERVIEW_BODY_BYTES) return tooLarge();

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return savedInterviewErrorResponse("invalid_json", "요청 본문은 JSON이어야 합니다.");
  }

  const parsed = parseCreateInterviewBody(json);
  if (!parsed.ok) return savedInterviewErrorResponse(parsed.kind, parsed.message);

  const { analysis, analysisId, candidateKey, title, evidence } = parsed.body;

  try {
    /**
     * 이미 저장한 분석이 있으면 그 줄에 붙입니다. 붙지 않으면 분석을 새로 저장하고 다시 붙입니다.
     *
     * 붙지 않는 경우는 둘입니다. 그 분석이 지워졌거나 남의 것입니다. 둘 다 지금 요청이 들고 온
     * 분석 결과로 새 줄을 만들면 되므로 오류로 돌려보내지 않습니다. 남의 분석 식별자를 보내도
     * 새로 만드는 것은 요청한 사람 소유의 줄이므로 남의 데이터에 닿지 않습니다.
     */
    if (analysisId !== undefined) {
      const existing = await store.createInterview({
        githubUserId: session.userId,
        analysisId,
        candidateKey,
        title,
        evidence,
      });
      if (existing !== null) return Response.json({ interviewId: existing, analysisId });
    }

    const savedAnalysisId = await store.saveAnalysis({
      githubUserId: session.userId,
      repoOwner: analysis.repoOwner,
      repoName: analysis.repoName,
      contributionItems: analysis.contributionItems,
      candidates: analysis.candidates,
      stageASummary: analysis.stageASummary,
    });
    const interviewId = await store.createInterview({
      githubUserId: session.userId,
      analysisId: savedAnalysisId,
      candidateKey,
      title,
      evidence,
    });
    if (interviewId === null) {
      // 방금 이 사용자 이름으로 만든 분석에 붙지 않는 경우입니다. 저장 계층의 판정이 어긋난 것이므로
      // 사용자가 다시 시도해 풀릴 문제가 아닙니다.
      return savedInterviewErrorResponse("server_error", "인터뷰를 만들지 못했습니다.");
    }
    return Response.json({ interviewId, analysisId: savedAnalysisId });
  } catch (error) {
    const mapped = toSavedInterviewError(error);
    return savedInterviewErrorResponse(mapped.kind, mapped.message);
  }
}

export function GET(request: NextRequest): Promise<Response> {
  return handleListInterviews(request);
}

export function POST(request: NextRequest): Promise<Response> {
  return handleCreateInterview(request);
}

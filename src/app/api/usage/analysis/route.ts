import type { NextRequest } from "next/server";
import {
  savedInterviewErrorResponseFor,
} from "@/features/saved-interviews/errors";
import { requireUserId } from "@/features/saved-interviews/route-request";
import { analysisUsageDate, DAILY_ANALYSIS_LIMIT } from "@/features/usage-limit/quota";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";

/**
 * 오늘 쓴 분석 횟수입니다(이슈 #142).
 *
 * Repository 선택 화면이 분석을 시작하기 전에 `오늘 분석 2/3회 사용`을 보여 주려면 횟수를 늘리지
 * 않고 읽는 자리가 필요합니다. Stage A 라우트의 검사에 얹을 수 없습니다. 그 검사는 곧 한 번을
 * 쓰는 것이라 화면을 그리는 것만으로 횟수가 줄어듭니다.
 *
 * **이 값은 안내용입니다.** 상한 판정은 Stage A 라우트가 질의 안에서 합니다. 화면이 이 값으로
 * 버튼을 막아도 다른 탭이 이미 썼거나 라우트를 직접 부르는 경로가 남으므로, 막는 책임은 끝까지
 * 서버에 있습니다. 화면의 차단은 헛걸음을 줄이는 것이지 상한을 집행하는 것이 아닙니다.
 *
 * 경로를 `/api/analyses/usage`가 아니라 여기에 둡니다. 그 아래에는 `[id]`가 있어 정적 구간과
 * 동적 구간이 한 자리에서 겹칩니다. 지금은 분석 식별자가 uuid라 부딪히지 않지만, 읽는 사람이
 * 둘의 우선순위를 알아야 하는 배치를 만들 이유가 없습니다.
 *
 * 저장 계층을 매개변수로 받고 기본값으로 실제 구현을 씁니다. 테스트는 `createInMemoryStore()`를
 * 넘겨 데이터베이스 없이 돕니다.
 */
export async function handleGetAnalysisUsage(
  request: NextRequest,
  store: SiftStore = neonStore(),
  now: () => number = Date.now
): Promise<Response> {
  const session = requireUserId(request);
  if ("response" in session) return session.response;

  const usageDate = analysisUsageDate(now());
  try {
    const used = await store.getAnalysisQuotaUsage(session.userId, usageDate);
    return Response.json({ used, limit: DAILY_ANALYSIS_LIMIT });
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }
}

export function GET(request: NextRequest): Promise<Response> {
  return handleGetAnalysisUsage(request);
}

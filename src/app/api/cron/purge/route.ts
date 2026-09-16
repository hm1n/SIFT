import type { NextRequest } from "next/server";
import { retentionCutoff } from "@/features/saved-interviews/retention";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";
import { DatabaseError } from "@/lib/db/client";
import { reportServerError } from "@/lib/sentry/server";

export const runtime = "nodejs";

/**
 * 90일 동안 열지 않은 인터뷰와, 딸린 인터뷰가 모두 사라진 분석을 지웁니다(이슈 #116).
 *
 * Vercel Cron이 하루에 한 번 부릅니다. Hobby 플랜은 cron을 하루 한 번까지만 허용하고 지정한 시각부터
 * 한 시간 안의 아무 때나 부르므로(2026-09-15 문서 확인), 정확한 시각에 기대지 않습니다. 기준은 호출
 * 시각에서 90일을 뺀 값이고 며칠 늦게 돌아도 결과가 같습니다.
 *
 * 인증은 `CRON_SECRET`으로 합니다. 값을 두면 Vercel이 `Authorization: Bearer <값>`을 함께 보냅니다.
 * 이 경로는 사용자 세션이 아니라 그 헤더로만 열립니다. 세션으로 열면 로그인한 누구나 남의 데이터까지
 * 지우는 정리를 돌릴 수 있습니다.
 *
 * **값이 없으면 열지 않습니다.** 없을 때 통과시키면 설정을 빠뜨린 배포에서 이 경로가 아무에게나
 * 열립니다. 지우는 일이라 되돌릴 수 없습니다.
 */
export async function handlePurge(request: NextRequest, store: SiftStore = neonStore()): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (secret === undefined || secret === "" || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const before = retentionCutoff();
  try {
    /**
     * 인터뷰를 먼저 지우고 분석을 지웁니다. 순서가 반대이면 이번 실행에서 마지막 인터뷰를 잃은 분석이
     * 다음 실행까지 하루 더 남습니다. 근거 스냅샷에 비공개 저장소의 코드가 들어 있으므로 하루라도
     * 덜 두는 편이 낫습니다.
     */
    const interviews = await store.purgeInterviewsOpenedBefore(before);
    const analyses = await store.purgeAnalysesWithoutInterviews(before);
    return Response.json({ before: before.toISOString(), interviews, analyses });
  } catch (error) {
    // cron은 실패해도 다시 부르지 않습니다. 다음 날 실행이 같은 줄을 다시 지우려 하므로 놓친 줄이
    // 영영 남지는 않습니다. 로그로 남겨 어느 실행이 실패했는지 알 수 있게 합니다.
    const message = error instanceof DatabaseError ? `${error.kind}: ${error.message}` : String(error);
    console.error(`정리 작업 실패: ${message}`);
    return reportServerError(
      error,
      Response.json({ error: { kind: "storage_failed", message: "정리 작업에 실패했습니다." } }, { status: 503 })
    );
  }
}

export function GET(request: NextRequest): Promise<Response> {
  return handlePurge(request);
}

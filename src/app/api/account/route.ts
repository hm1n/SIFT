import type { NextRequest } from "next/server";
/*
 * 오류 봉투와 세션 꺼내기를 `saved-interviews`에서 그대로 가져옵니다. 이름이 인터뷰 쪽이라 어색하지만
 * 베끼지 않습니다. `DatabaseError`를 `storage_failed`와 `server_error`로 가르는 규칙과 5xx만 Sentry로
 * 보내는 규칙이 그 두 모듈에 한 번 적혀 있고, 여기에 다시 적으면 한쪽만 고치게 됩니다. 이름을 옮기는
 * 일은 참조하는 라우트 넷과 문서를 함께 고쳐야 해서 이번 범위에서 뗐습니다(위키 backlog).
 */
import { savedInterviewErrorResponseFor } from "@/features/saved-interviews/errors";
import { requireSession } from "@/features/saved-interviews/route-request";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";
import { deleteGitHubSessionCookie } from "@/lib/github/auth-session";
import { revokeGitHubGrant, type RevokeGrantResult } from "@/lib/github/oauth";

export const runtime = "nodejs";

/**
 * 회원 탈퇴입니다(이슈 #145). 저장된 분석과 인터뷰를 모두 지우고, GitHub에 준 권한을 해제하고,
 * 세션 쿠키를 지웁니다.
 *
 * **대상은 세션의 사용자 번호뿐입니다.** 본문을 읽지 않습니다. 지울 대상을 요청이 지정할 수 있으면
 * 남의 번호를 적어 보낼 자리가 생기고, 그 자리를 막는 검사를 빠뜨리면 남의 데이터가 사라집니다.
 * 읽지 않는 편이 검사보다 확실합니다.
 *
 * **순서는 삭제 먼저, 해제 나중입니다.** 이슈가 "권한 해제가 실패해도 데이터 삭제는 끝나야 한다"고
 * 정했으므로 실패해도 되는 쪽을 뒤에 둡니다. 순서를 바꾸면 토큰이 죽은 뒤에 삭제가 실패하는 경우가
 * 생기고, 그때 사용자는 데이터가 남은 채로 아무것도 할 수 없는 상태가 됩니다.
 *
 * **삭제가 실패하면 쿠키를 남깁니다.** 지우지 못한 채로 로그아웃시키면 사용자가 다시 로그인하기 전까지
 * 무엇이 남았는지 볼 수 없고 다시 시도할 자리도 사라집니다.
 *
 * 응답은 `{ deleted, revoked }`입니다. `deleted`는 지운 분석 수이고 0이면 저장된 것이 없던 계정입니다.
 * `revoked`가 거짓이면 데이터는 지웠지만 권한이 남아 있다는 뜻이고, 화면이 그 사실을 사용자에게
 * 알립니다. 실패 이유는 응답에 싣지 않습니다. 사용자가 할 일은 이유와 무관하게 같고(GitHub 설정에서
 * 직접 해제), 서버 설정 문제를 브라우저까지 내보낼 이유가 없습니다. 이유는 서버 로그에 남깁니다.
 */
export async function handleDeleteAccount(
  request: NextRequest,
  store: SiftStore = neonStore(),
  revoke: (token: string) => Promise<RevokeGrantResult> = revokeGitHubGrant
): Promise<Response> {
  const session = requireSession(request);
  if ("response" in session) return session.response;

  let deleted: number;
  try {
    deleted = await store.deleteUserData(session.session.githubUserId);
  } catch (error) {
    return savedInterviewErrorResponseFor(error);
  }

  /*
   * 해제가 값 대신 예외로 끝나도 삭제는 이미 끝났습니다. 예외를 그대로 올리면 지운 데이터가 500으로
   * 보고되고 쿠키도 남습니다. 지금 구현(`revokeGitHubGrant`)은 전송 실패까지 값으로 돌려주지만 이
   * 함수는 매개변수로 들어오므로 계약을 여기서 한 번 더 막습니다.
   */
  const revocation = await revoke(session.session.token).catch(
    () => ({ status: "failed", reason: "network" }) as RevokeGrantResult
  );
  if (revocation.status === "failed") {
    // cron 정리와 같은 방식입니다. `reportServerError`는 5xx 응답에만 보내고 이 요청은 200이라
    // Sentry로는 가지 않습니다. 실패가 실제로 얼마나 일어나는지 볼 수단을 넓히는 일은 뗐습니다(위키 backlog).
    console.error(`GitHub 권한 해제 실패: ${revocation.reason}`);
  }

  return Response.json(
    { deleted, revoked: revocation.status === "revoked" },
    { headers: { "Set-Cookie": deleteGitHubSessionCookie() } }
  );
}

export function DELETE(request: NextRequest): Promise<Response> {
  return handleDeleteAccount(request);
}

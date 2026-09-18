/**
 * 회원 탈퇴 결과를 로그인 화면이 읽는 표시로 옮깁니다(이슈 #145).
 *
 * 탈퇴를 끝내면 계정 메뉴가 `/?withdrawn=<표시>`로 보냅니다. 화면을 갈아 끼우지 않고 주소로
 * 넘기는 이유는 세션 쿠키가 이미 사라져서 그 자리에 남아 있을 수 없기 때문입니다. 남아 있으면
 * 다음 요청이 모두 401로 답하는 화면을 사용자가 계속 보게 됩니다. `auth_error`가 쓰는 방식과
 * 같습니다.
 *
 * 표시는 넷입니다. 사용자가 알아야 할 것이 지울 데이터가 있었는지와 GitHub 연결이 실제로
 * 끊겼는지, 둘이기 때문입니다. 안내 문구는 `@/copy/auth`의 `WITHDRAWN_COPY`에 있습니다.
 */

/** 본문을 읽지 못했을 때의 표시입니다. 이유는 `withdrawnMarker` 주석에 있습니다. */
export const UNKNOWN_WITHDRAWAL_MARKER = "done_kept";

/**
 * 탈퇴 응답 본문을 표시로 옮깁니다.
 *
 * 응답이 기대한 모양이 아니면 지운 데이터는 있었고 연결은 남았다고 봅니다. 두 값 모두 사용자에게
 * 더 많은 일을 시키는 쪽입니다. 반대로 두면 연결이 남았는데도 끊겼다고 알리게 되고, 사용자는
 * 확인할 기회를 잃습니다. 탈퇴는 되돌릴 수 없어 다시 물어볼 수도 없습니다.
 */
export function withdrawnMarker(result: unknown): string {
  if (typeof result !== "object" || result === null) return UNKNOWN_WITHDRAWAL_MARKER;
  const { deleted, revoked } = result as { deleted?: unknown; revoked?: unknown };
  if (typeof deleted !== "number" || typeof revoked !== "boolean") return UNKNOWN_WITHDRAWAL_MARKER;
  return `${deleted === 0 ? "empty" : "done"}${revoked ? "" : "_kept"}`;
}

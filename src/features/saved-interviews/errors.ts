import { DatabaseError } from "@/lib/db/client";
import { reportServerError } from "@/lib/sentry/report";

/**
 * 저장된 인터뷰 경로가 내는 오류입니다. 화면이 무엇을 보일지 고르려면 종류가 필요합니다.
 *
 * `not_found`는 없는 인터뷰와 남의 인터뷰를 함께 가리킵니다. 둘을 나눠 알려 주면 다른 사람의
 * 인터뷰가 있는지 없는지를 알 수 있게 됩니다. 저장 계층이 이미 둘을 구분하지 않고 돌려줍니다.
 *
 * `storage_failed`와 `server_error`를 나눕니다. 데이터베이스가 잠시 답하지 않는 것은 다시 시도할
 * 여지가 있고, 접속 문자열이 없는 것은 사용자가 할 수 있는 일이 없습니다. 두 갈래를 묶으면 잠시
 * 끊긴 사용자에게 서버 설정을 고치라는 안내가 갑니다.
 */
export type SavedInterviewErrorKind =
  | "unauthorized"
  | "invalid_json"
  | "invalid_request"
  | "body_too_large"
  | "not_found"
  | "version_conflict"
  | "storage_failed"
  | "server_error";

const STATUS: Record<SavedInterviewErrorKind, number> = {
  unauthorized: 401,
  invalid_json: 400,
  invalid_request: 400,
  body_too_large: 413,
  not_found: 404,
  version_conflict: 409,
  storage_failed: 503,
  server_error: 500,
};

export function savedInterviewErrorStatus(kind: SavedInterviewErrorKind): number {
  return STATUS[kind];
}

export function savedInterviewErrorResponse(kind: SavedInterviewErrorKind, message: string): Response {
  return Response.json({ error: { kind, message } }, { status: savedInterviewErrorStatus(kind) });
}

/**
 * 저장 계층이 던진 오류를 화면이 가를 수 있는 종류로 옮깁니다. `DatabaseError`가 아닌 것은 우리가
 * 예상하지 못한 오류이므로 `server_error`로 둡니다.
 */
export function toSavedInterviewError(error: unknown): {
  kind: SavedInterviewErrorKind;
  message: string;
} {
  if (error instanceof DatabaseError && error.kind === "query_failed") {
    return { kind: "storage_failed", message: "저장소에 연결하지 못했습니다. 잠시 뒤에 다시 시도해 주세요." };
  }
  if (error instanceof DatabaseError) {
    return { kind: "server_error", message: "서버 설정 문제로 저장소를 쓸 수 없습니다." };
  }
  return { kind: "server_error", message: "저장 중에 알 수 없는 문제가 생겼습니다." };
}

/**
 * 저장 계층이 던진 오류를 응답으로 옮기면서 5xx만 Sentry로 보냅니다. 저장 계층을 쓰는 라우트의
 * 최상위 catch는 전부 이 함수 하나를 부릅니다.
 *
 * 이슈 #136에서 만들었습니다. 같은 세 줄(`toSavedInterviewError` 호출과 응답 생성)이 라우트 네 개에
 * 여덟 번 반복돼 있었고, 거기에 전송을 하나씩 얹으면 새 catch가 생길 때마다 빠뜨릴 자리가 남습니다.
 * 옮기는 규칙과 보내는 규칙을 한 자리에 둡니다.
 *
 * `storage_failed`(503)와 `server_error`(500)는 전송되고, 이 함수로 오지 않는 `not_found`(404)나
 * `invalid_request`(400) 같은 사용자 입력 문제는 애초에 예외가 아니라 값으로 갈라져 나갑니다.
 */
export function savedInterviewErrorResponseFor(error: unknown): Response {
  const mapped = toSavedInterviewError(error);
  return reportServerError(error, savedInterviewErrorResponse(mapped.kind, mapped.message));
}

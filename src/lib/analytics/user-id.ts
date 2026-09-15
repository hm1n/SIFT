import { createHmac } from "node:crypto";

/**
 * GA4 `user_id`를 만듭니다. 서버에서만 부릅니다.
 *
 * GitHub 사용자 번호를 그대로 보내지 않는 이유입니다. 이 번호를 GitHub 공개 API에 넣으면 계정
 * 아이디가 그대로 나오므로, 원본을 보내면 이슈 #125가 금지한 GitHub 로그인 아이디를 사실상 함께
 * 보내는 것이 됩니다. HMAC은 서버만 아는 비밀값을 섞어 되돌릴 수 없는 값으로 바꾸므로, 같은
 * 사용자는 언제나 같은 값이 나와 재방문과 기기 간 집계는 그대로 되고 그 값에서 GitHub 계정으로
 * 돌아갈 방법은 없습니다.
 */

/**
 * 비밀값의 환경변수 이름입니다.
 *
 * `NEXT_PUBLIC_` 접두사를 붙이지 않습니다. 붙이면 Next.js가 클라이언트 번들에 인라인해 누구나 같은
 * 해시를 계산할 수 있고, 그러면 변환의 의미가 사라집니다. 이 모듈이 `node:crypto`를 가져오는 것도
 * 서버 전용이라는 경계를 컴파일 단계에서 드러내기 위해서입니다.
 *
 * 값이 바뀌면 같은 사용자가 다른 사람으로 집계되므로 유출 사고가 아닌 한 교체하지 않습니다.
 */
export const GA_USER_ID_SECRET_ENV = "GA_USER_ID_HMAC_SECRET";

/**
 * 비밀값이 없거나 공백뿐이면 null입니다. 측정 ID가 없을 때와 같은 판정이고, 계측만 익명으로
 * 떨어질 뿐 로그인과 화면은 그대로 동작해야 합니다.
 *
 * 결과는 64자 16진 문자열이라 GA4의 파라미터 값 100자 제한 안에 들어갑니다.
 */
export function toAnalyticsUserId(githubUserId: number): string | null {
  const secret = process.env[GA_USER_ID_SECRET_ENV]?.trim();
  if (!secret) return null;
  return createHmac("sha256", secret).update(String(githubUserId)).digest("hex");
}

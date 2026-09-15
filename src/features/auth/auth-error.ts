import { AUTH_ERROR_COPY } from "@/copy/auth";

/**
 * OAuth 라우트가 `?auth_error=`로 돌려보내는 오류 종류의 계측 값입니다. 종류는 콜백 라우트와 로그인
 * 라우트가 정합니다. 화면 안내는 `@/copy/auth`의 `AUTH_ERROR_COPY`이고, 판정을 그 표에 붙여 두어
 * 분류가 늘 때 안내와 계측이 함께 늘어나게 합니다.
 *
 * 이 파일도 `AUTH_ERROR_COPY`를 가져오는 `@/copy/auth`도 `"use client"`가 붙은 파일에 두지 않습니다. `src/app/page.tsx`가 서버 컴포넌트인데 `login_result`의
 * 분류를 만들려고 `toAuthErrorParam`을 부릅니다. 클라이언트 모듈의 함수를 서버에서 부르면 Next.js가
 * 렌더 자체를 500으로 끊습니다. 2026-09-15에 프로덕션 빌드를 실제로 띄워 보고 잡았고, 모듈 그래프가
 * 하나인 vitest에서는 드러나지 않았습니다.
 */

/**
 * 계측에 실을 `auth_error` 값입니다. 표에 없는 값은 `unknown`으로 묶습니다.
 *
 * 주소창의 쿼리는 아무 값이나 들어올 수 있습니다. 그대로 보내면 GA4 디멘션에 임의 문자열이 쌓여
 * 분류로 쓸 수 없게 되고 파라미터 값 100자 제한도 보장되지 않습니다. 판정 근거를 화면 안내표와 같은
 * `AUTH_ERROR_COPY`에 두어 분류가 늘 때 둘이 함께 늘어나게 합니다.
 */
export function toAuthErrorParam(value: string): string {
  return Object.hasOwn(AUTH_ERROR_COPY, value) ? value : "unknown";
}

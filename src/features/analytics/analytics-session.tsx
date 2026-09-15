"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { setAnalyticsUser, trackEvent } from "./events";

/** 로그인 결과입니다. 세션 유무를 아는 쪽이 서버이므로 `page.tsx`가 판정해서 넘깁니다. */
export type LoginResult = { readonly success: true } | { readonly success: false; readonly errorKind: string };

export interface AnalyticsSessionProps {
  /** `githubUserId`를 HMAC으로 변환한 값입니다. 로그인 전이거나 비밀값이 없으면 null입니다. */
  userId: string | null;
  /** 이번 진입이 로그인 직후일 때만 값이 있습니다. */
  loginResult?: LoginResult;
}

/**
 * 로그인 경계의 계측입니다. 화면을 그리지 않습니다.
 *
 * 하는 일이 둘입니다. 공통 파라미터 `user_id`를 세우고, 로그인 직후라면 `login_result`를 한 번
 * 보냅니다. 한 컴포넌트에 둔 이유는 순서 때문입니다. `user_id`를 먼저 세워야 `login_result`가 그
 * 값을 달고 나갑니다.
 *
 * `login_result`를 "세션이 있는 첫 렌더"로 판정하지 않습니다. 세션 쿠키는 8시간을 살고 새로고침과
 * 로그아웃 갱신마다 서버가 이 페이지를 다시 실행하므로, 그 판정은 로그인 성공 수가 아니라 페이지
 * 로드 수를 세게 됩니다. "세션이 있다"는 "방금 로그인했다"의 대리 지표입니다. 대신 OAuth 콜백이
 * 성공 리다이렉트에 붙여 주는 `?login=success`를 봅니다. 실패가 이미 `?auth_error=`로 오고 있어
 * 성공과 실패가 같은 방식으로 갈립니다.
 */
export function AnalyticsSession({ userId, loginResult }: AnalyticsSessionProps) {
  const router = useRouter();
  const reportedRef = useRef(false);

  useEffect(() => {
    setAnalyticsUser(userId);
  }, [userId]);

  useEffect(() => {
    if (!loginResult || reportedRef.current) return;
    reportedRef.current = true;
    trackEvent(
      loginResult.success
        ? { name: "login_result", success: true }
        : { name: "login_result", success: false, error_kind: loginResult.errorKind }
    );
    // 성공 표시는 한 번 쓰고 지웁니다. 남겨 두면 새로고침이 같은 로그인을 다시 세고 주소창에도
    // 계속 보입니다. 실패 표시(`auth_error`)는 지우지 않습니다. 로그인 화면이 그 값으로 오류
    // 안내를 그리므로 지우면 안내가 사라집니다.
    if (loginResult.success) router.replace("/");
  }, [loginResult, router]);

  return null;
}

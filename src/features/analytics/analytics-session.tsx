"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { clearFlow, setAnalyticsUser, trackEvent } from "./events";

/** 로그인 결과입니다. 세션 유무를 아는 쪽이 서버이므로 `page.tsx`가 판정해서 넘깁니다. */
export type LoginResult = { readonly success: true } | { readonly success: false; readonly errorKind: string };

export interface AnalyticsSessionProps {
  /** `githubUserId`를 HMAC으로 변환한 값입니다. 로그인 전이거나 비밀값이 없으면 null입니다. */
  userId: string | null;
  /**
   * 세션이 있는지입니다. `userId`로 대신 판단하지 않습니다. HMAC 비밀값이 없거나 쿠키를 풀지
   * 못하면 로그인한 사용자도 `userId`가 null이라, 그 값으로 로그아웃을 판정하면 로그인 중에
   * 분석 묶음을 지우게 됩니다.
   */
  signedIn: boolean;
  /** 이번 진입이 로그인 직후일 때만 값이 있습니다. */
  loginResult?: LoginResult;
  /** 계측을 마친 뒤 남길 주소입니다. 일회성 표시만 빠집니다. `page.tsx`가 만듭니다. */
  urlAfterReport?: string;
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
 * 로드 수를 세게 됩니다. "세션이 있다"는 "방금 로그인했다"의 대리 지표입니다. 대신 OAuth 라우트가
 * 붙여 주는 일회성 표시 `?login=`을 성공과 실패 모두에 씁니다.
 *
 * 표시는 한 번 읽고 지웁니다. 남겨 두면 새로고침이 같은 로그인을 다시 세고 주소창에도 계속
 * 보입니다. 지울 때 `auth_error`는 남깁니다. 로그인 화면이 그 값으로 오류 안내를 그리므로 함께
 * 지우면 안내가 사라집니다. 어느 쿼리를 남길지는 `page.tsx`가 정해 `urlAfterReport`로 넘깁니다.
 */
export function AnalyticsSession({ userId, signedIn, loginResult, urlAfterReport }: AnalyticsSessionProps) {
  const router = useRouter();
  const reportedRef = useRef(false);

  useEffect(() => {
    setAnalyticsUser(userId);
    /**
     * 로그아웃이면 분석 묶음도 함께 지웁니다. 로그아웃은 새로고침 없이 서버 컴포넌트만 다시 그려
     * `RepositoryFlow`가 통째로 내려가는데, 그때 `navigate`를 지나지 않으므로 `flow_id`와 저장소
     * 문맥이 gtag에 남습니다. 지우지 않으면 뒤이어 그려지는 로그인 화면의 `login_view`와
     * `login_start`가 지난 분석의 묶음에 붙습니다(PR #129 리뷰).
     *
     * 세션 경계를 아는 곳이 여기입니다. 흐름을 시작한 적이 없으면 `clearFlow`가 걸러냅니다.
     */
    if (!signedIn) clearFlow();
  }, [userId, signedIn]);

  useEffect(() => {
    if (!loginResult || reportedRef.current) return;
    reportedRef.current = true;
    trackEvent(
      loginResult.success
        ? { name: "login_result", success: true }
        : { name: "login_result", success: false, error_kind: loginResult.errorKind }
    );
    if (urlAfterReport) router.replace(urlAfterReport);
  }, [loginResult, router, urlAfterReport]);

  return null;
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { trackEvent } from "@/features/analytics/events";
import { toAuthErrorParam } from "./auth-error";
import { useAuthTransition } from "@/components/shell/auth-transition";
import { StatusScreen } from "@/components/shell/status-screen";
import { AUTH_ERROR_COPY, LOGIN_COPY, WITHDRAWN_COPY, WITHDRAWN_GRANT_GUIDE } from "@/copy/auth";
import styles from "./unauthenticated-screen.module.css";

export interface UnauthenticatedScreenProps {
  /** `page.tsx`가 `searchParams.auth_error`에서 읽어 넘기는 오류 종류입니다. 표에 없는 값은 안내로 취급하지 않습니다. */
  authError?: string;
  /**
   * 회원 탈퇴를 끝낸 직후의 표시입니다(이슈 #145). `page.tsx`가 `searchParams.withdrawn`에서 읽어
   * 넘기고, `WITHDRAWN_COPY`에 있는 값만 안내로 취급합니다. 주소창의 쿼리는 아무 값이나 올 수
   * 있으므로 `auth_error`와 같은 기준을 씁니다.
   */
  withdrawn?: string;
  /**
   * 기본 상태에서 그릴 화면입니다. `page.tsx`가 랜딩을 서버에서 그려 넘깁니다(이슈 #149).
   *
   * 여기서 직접 import하지 않는 이유입니다. 이 컴포넌트는 인증 중 상태를 구독해야 해서
   * 클라이언트인데, 랜딩은 정적 마크업이 많아 함께 클라이언트가 되면 그만큼이 JS 번들에 실립니다.
   * 서버에서 그려 넘기면 마크업은 그대로 오고 번들은 이 파일만큼만 늘어납니다.
   */
  children: ReactNode;
}

/**
 * 세션이 없을 때의 화면입니다. 상태 셋 중 무엇을 그릴지 가릅니다.
 *
 * 이슈 #149에서 이름이 `LoginScreen`에서 바뀌었습니다. 기본 상태가 로그인 카드에서 랜딩으로
 * 바뀌면서 이 컴포넌트가 하는 일이 "로그인 화면을 그리는 것"이 아니라 "세션 없는 진입의 상태를
 * 가르는 것"이 되었습니다. 현재 계약은 `llm-wiki/wiki/2026-09-10-GitHub-로그인-진입-화면.md`입니다.
 *
 * 세션 여부는 서버가 쿠키를 읽어 가르므로 이 화면은 인증 상태를 들고 있지 않습니다. 상태는 셋입니다.
 * 기본 화면(`children`)이 Empty 역할이고, 로그인 링크를 누른 뒤 브라우저가 로그인 라우트로 이동하기
 * 전까지가 Loading(AUTHENTICATING), `auth_error` 쿼리가 있으면 Error(ERROR / AUTH)입니다. Loading과
 * Error는 공용 `StatusScreen`으로 그립니다.
 *
 * 인증 중 상태는 layout의 `AuthTransitionProvider`가 들고 있습니다. 헤더의 로그인 링크로 시작한
 * 인증도 이 화면이 AUTHENTICATING으로 그려야 하므로, 인증 중 판정을 오류 판정보다 앞에 둡니다.
 */
export function UnauthenticatedScreen({ authError, withdrawn, children }: UnauthenticatedScreenProps) {
  const router = useRouter();
  const { isAuthenticating } = useAuthTransition();
  // 개발 모드의 StrictMode는 effect를 두 번 실행합니다. 한 번 들어온 화면을 두 번 세지 않습니다.
  const viewReportedRef = useRef(false);

  // 퍼널의 첫 마디입니다. 세 상태(기본·인증 중·오류) 가운데 무엇을 그리든 화면에 들어온 것은 한 번이므로
  // 마운트에 한 번만 보냅니다. `다시 시도`로 오류 쿼리를 지우는 전환은 같은 진입 안에서 일어납니다.
  useEffect(() => {
    if (viewReportedRef.current) return;
    viewReportedRef.current = true;
    trackEvent({
      name: "login_view",
      ...(authError === undefined ? {} : { auth_error: toAuthErrorParam(authError) }),
    });
  }, [authError]);

  if (isAuthenticating) {
    return (
      <StatusScreen
        kind="loading"
        code="Authenticating"
        label={LOGIN_COPY.authenticatingLabel}
        sub={LOGIN_COPY.authenticatingSub}
      />
    );
  }

  if (authError && Object.hasOwn(AUTH_ERROR_COPY, authError)) {
    return (
      <StatusScreen
        kind="error"
        code="ERROR / AUTH"
        label={LOGIN_COPY.errorLabel}
        sub={AUTH_ERROR_COPY[authError]}
        // 디자인대로 랜딩으로 돌아갑니다. 쿼리를 지우면 서버가 오류 없는 화면을 다시 그립니다.
        action={{ label: LOGIN_COPY.tryAgain, onClick: () => router.replace("/") }}
      />
    );
  }

  /**
   * 탈퇴 안내입니다. 셋 중 기본 화면에만 그립니다. 인증 중과 오류는 앞에서 먼저 돌려주므로 여기까지
   * 오지 않고, 탈퇴한 직후에는 그 둘에 해당할 일도 없습니다.
   */
  const withdrawalNotice =
    withdrawn !== undefined && Object.hasOwn(WITHDRAWN_COPY, withdrawn) ? WITHDRAWN_COPY[withdrawn] : undefined;

  return (
    <>
      {withdrawalNotice ? (
        <div className={styles.noticeArea}>
          <p className={styles.notice} role="status">
            {withdrawalNotice.text}
            {/*
              연결이 남은 경우에만 할 일을 덧붙입니다. 남았다는 사실만 알리고 끝내면 사용자가 할 수
              있는 일이 없습니다. GitHub 설정은 이 서비스 밖이라 새 탭으로 엽니다.
            */}
            {withdrawalNotice.grantKept ? (
              <>
                {" "}
                {WITHDRAWN_GRANT_GUIDE.lead}
                <a
                  className={styles.noticeLink}
                  href={WITHDRAWN_GRANT_GUIDE.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {WITHDRAWN_GRANT_GUIDE.link}
                </a>
                {WITHDRAWN_GRANT_GUIDE.tail}
              </>
            ) : null}
          </p>
        </div>
      ) : null}
      {children}
    </>
  );
}

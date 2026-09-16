"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackEvent } from "@/features/analytics/events";
import { toAuthErrorParam } from "./auth-error";
import { LoginLink, useAuthTransition } from "@/components/shell/auth-transition";
import { SiftMark } from "@/components/shell/sift-mark";
import { StatusScreen } from "@/components/shell/status-screen";
import { AUTH_ERROR_COPY, LOGIN_COPY } from "@/copy/auth";
import styles from "./login-screen.module.css";

export interface LoginScreenProps {
  /** `page.tsx`가 `searchParams.auth_error`에서 읽어 넘기는 오류 종류입니다. 표에 없는 값은 안내로 취급하지 않습니다. */
  authError?: string;
}

/**
 * 세션이 없을 때의 진입 화면입니다. 디자인 파일 `App.tsx`의 `LoginScreen`과 `AuthLoadingScreen`, `ERROR / AUTH` 상태를 옮겼습니다.
 *
 * 세션 여부는 서버가 쿠키를 읽어 가르므로 이 화면은 인증 상태를 들고 있지 않습니다. 화면 상태는 셋입니다.
 * 기본 화면이 Empty 역할이고, 로그인 링크를 누른 뒤 브라우저가 로그인 라우트로 이동하기 전까지가 Loading(AUTHENTICATING),
 * `auth_error` 쿼리가 있으면 Error(ERROR / AUTH)입니다. Loading과 Error는 공용 `StatusScreen`으로 그립니다.
 *
 * 인증 중 상태는 layout의 `AuthTransitionProvider`가 들고 있습니다. 헤더의 로그인 링크로 시작한 인증도 이 화면이
 * AUTHENTICATING으로 그려야 하므로, 인증 중 판정을 오류 판정보다 앞에 둡니다.
 */
export function LoginScreen({ authError }: LoginScreenProps) {
  const router = useRouter();
  const { isAuthenticating } = useAuthTransition();
  // 개발 모드의 StrictMode는 effect를 두 번 실행합니다. 한 번 들어온 화면을 두 번 세지 않습니다.
  const viewReportedRef = useRef(false);

  // 퍼널의 첫 마디입니다. 세 상태(기본·인증 중·오류) 가운데 무엇을 그리든 화면에 들어온 것은 한 번이므로
  // 마운트에 한 번만 보냅니다. `Try again`으로 오류 쿼리를 지우는 전환은 같은 진입 안에서 일어납니다.
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
        // 디자인대로 로그인 화면으로 돌아갑니다. 쿼리를 지우면 서버가 오류 없는 화면을 다시 그립니다.
        action={{ label: LOGIN_COPY.tryAgain, onClick: () => router.replace("/") }}
      />
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.graphic}>
          <div className={styles.placeholder} aria-hidden="true">
            <SiftMark size={40} />
          </div>
        </div>
        <div className={styles.copy}>
          <h1 className={styles.title}>{LOGIN_COPY.title[0]}<br />{LOGIN_COPY.title[1]}</h1>
          <p className={styles.description}>{LOGIN_COPY.description[0]}<br />{LOGIN_COPY.description[1]}</p>
        </div>
        <div className={styles.actions}>
          <LoginLink variant="primary" className={styles.login} iconSize={16}>{LOGIN_COPY.continueWithGitHub}</LoginLink>
          <p className={styles.terms}>{LOGIN_COPY.terms}</p>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { LoginLink, useAuthTransition } from "@/components/shell/auth-transition";
import { SiftMark } from "@/components/shell/sift-mark";
import { StatusScreen } from "@/components/shell/status-screen";
import styles from "./login-screen.module.css";

/**
 * OAuth 라우트가 `?auth_error=`로 돌려보내는 오류 종류별 안내입니다. 종류는 콜백 라우트와 로그인 라우트가 정합니다.
 * 이슈 #94 Constraint대로 종류를 합쳐 한 문구로 만들지 않습니다. 제목은 디자인의 한 문장으로 고정하고 여기 문구를 sub에 씁니다.
 */
export const AUTH_ERROR_COPY: Record<string, string> = {
  access_denied: "You cancelled the GitHub authorization. You can log in again.",
  state_mismatch: "We couldn't verify the login request. Start the login again from the beginning.",
  exchange_failed: "GitHub authentication didn't complete. Try again in a moment.",
  config_missing: "The server has no GitHub login configuration. A server administrator needs to complete the setup.",
};

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

  if (isAuthenticating) {
    return (
      <StatusScreen
        kind="loading"
        code="Authenticating"
        label="Connecting to GitHub..."
        sub="Redirecting you to GitHub to authorize access."
      />
    );
  }

  if (authError && Object.hasOwn(AUTH_ERROR_COPY, authError)) {
    return (
      <StatusScreen
        kind="error"
        code="ERROR / AUTH"
        label="Unable to connect to GitHub."
        sub={AUTH_ERROR_COPY[authError]}
        // 디자인대로 로그인 화면으로 돌아갑니다. 쿼리를 지우면 서버가 오류 없는 화면을 다시 그립니다.
        action={{ label: "Try again", onClick: () => router.replace("/") }}
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
          <h1 className={styles.title}>Turn your code into experiences<br />worth talking about.</h1>
          <p className={styles.description}>Analyze your GitHub history and prepare<br />for technical interviews with real evidence.</p>
        </div>
        <div className={styles.actions}>
          <LoginLink variant="primary" className={styles.login} iconSize={16}>Continue with GitHub</LoginLink>
          <p className={styles.terms}>By continuing you agree to our terms</p>
        </div>
      </div>
    </div>
  );
}

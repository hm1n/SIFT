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
  access_denied: "GitHub 권한 승인을 취소했습니다. 다시 로그인할 수 있습니다.",
  state_mismatch: "로그인 요청을 확인하지 못했습니다. 처음부터 다시 로그인해 주세요.",
  exchange_failed: "GitHub 인증이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.",
  config_missing: "서버에 GitHub 로그인 설정이 없습니다. 서버 관리자가 설정을 마쳐야 합니다.",
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
        label="GitHub에 연결 중..."
        sub="권한 승인을 위해 GitHub으로 이동합니다."
      />
    );
  }

  if (authError && Object.hasOwn(AUTH_ERROR_COPY, authError)) {
    return (
      <StatusScreen
        kind="error"
        code="ERROR / AUTH"
        label="GitHub에 연결할 수 없습니다."
        sub={AUTH_ERROR_COPY[authError]}
        // 디자인대로 로그인 화면으로 돌아갑니다. 쿼리를 지우면 서버가 오류 없는 화면을 다시 그립니다.
        action={{ label: "다시 시도", onClick: () => router.replace("/") }}
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
          <h1 className={styles.title}>코드를 이야기할 가치가 있는<br />경험으로 만듭니다.</h1>
          <p className={styles.description}>GitHub 기록을 분석해 실제 근거로<br />기술 면접을 준비합니다.</p>
        </div>
        <div className={styles.actions}>
          <LoginLink variant="primary" className={styles.login} iconSize={16}>GitHub으로 계속하기</LoginLink>
          <p className={styles.terms}>계속하면 이용약관에 동의하는 것입니다</p>
        </div>
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackEvent } from "@/features/analytics/events";
import { toAuthErrorParam } from "./auth-error";
import { LoginLink, useAuthTransition } from "@/components/shell/auth-transition";
import { SiftMark } from "@/components/shell/sift-mark";
import { StatusScreen } from "@/components/shell/status-screen";
import { AUTH_ERROR_COPY, LOGIN_COPY, WITHDRAWN_COPY, WITHDRAWN_GRANT_GUIDE } from "@/copy/auth";
import styles from "./login-screen.module.css";

export interface LoginScreenProps {
  /** `page.tsx`가 `searchParams.auth_error`에서 읽어 넘기는 오류 종류입니다. 표에 없는 값은 안내로 취급하지 않습니다. */
  authError?: string;
  /**
   * 회원 탈퇴를 끝낸 직후의 표시입니다(이슈 #145). `page.tsx`가 `searchParams.withdrawn`에서 읽어
   * 넘기고, `WITHDRAWN_COPY`에 있는 값만 안내로 취급합니다. 주소창의 쿼리는 아무 값이나 올 수
   * 있으므로 `auth_error`와 같은 기준을 씁니다.
   */
  withdrawn?: string;
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
export function LoginScreen({ authError, withdrawn }: LoginScreenProps) {
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

  /**
   * 탈퇴 안내입니다. 셋 중 기본 화면에만 그립니다. 인증 중과 오류는 앞에서 먼저 돌려주므로 여기까지
   * 오지 않고, 탈퇴한 직후에는 그 둘에 해당할 일도 없습니다.
   */
  const withdrawalNotice =
    withdrawn !== undefined && Object.hasOwn(WITHDRAWN_COPY, withdrawn) ? WITHDRAWN_COPY[withdrawn] : undefined;

  return (
    <div className={styles.screen}>
      {withdrawalNotice ? (
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
      ) : null}
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
          {/*
            동의 문장의 `이용약관`만 링크입니다. 처리방침은 동의 대상이 아니라 같은 문장에 넣지
            않습니다. 작성지침 Part 02가 개인정보 처리방침은 동의를 얻어야 하는 문서가 아니라고
            밝히고 있습니다. 처리방침 링크는 이 화면 아래의 푸터가 답니다(이슈 #141).
          */}
          <p className={styles.terms}>
            {LOGIN_COPY.termsSentence.lead}
            <Link className={styles.termsLink} href="/terms">{LOGIN_COPY.termsSentence.link}</Link>
            {LOGIN_COPY.termsSentence.tail}
          </p>
        </div>
      </div>
    </div>
  );
}

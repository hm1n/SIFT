"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { GLOBAL_ERROR_COPY } from "@/copy/shell";
import { ButtonLink } from "@/components/shell/button";
import { StatusScreen } from "@/components/shell/status-screen";
import styles from "./global-error.module.css";
import "./globals.css";

/**
 * 화면을 그리다 잡히지 않은 오류가 났을 때 그립니다(이슈 #136).
 *
 * 이 파일이 없으면 App Router의 기본 바운더리가 오류를 잡아 빈 화면을 그리고 끝납니다. 오류가
 * React 안에서 잡히므로 `window.onerror`가 일어나지 않고, 브라우저 Sentry의 전역 핸들러도 그것을
 * 보지 못합니다. 이슈 #81이 클라이언트 SDK를 붙여 두었는데도 렌더 오류가 한 건도 수집되지 않은
 * 이유입니다. 여기서 직접 `captureException`을 불러 그 구멍을 막습니다.
 *
 * `global-error`는 루트 레이아웃까지 대체하므로 `<html>`과 `<body>`를 직접 그려야 합니다. 레이아웃이
 * 걷히면서 헤더와 폰트 설정도 함께 사라지므로 `globals.css`를 여기서 다시 싣습니다.
 *
 * 돌아갈 자리를 `<a>`로 둡니다. 헤더가 없어 홈으로 가는 링크가 화면에 남지 않고, 라우터 자체가
 * 무너진 상태일 수 있어 클라이언트 네비게이션 대신 문서를 새로 엽니다.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body>
        <StatusScreen
          kind="error"
          code={GLOBAL_ERROR_COPY.code}
          label={GLOBAL_ERROR_COPY.label}
          sub={GLOBAL_ERROR_COPY.sub}
          action={{ label: GLOBAL_ERROR_COPY.retry, onClick: reset }}
        />
        <p className={styles.home}>
          <ButtonLink href="/" variant="ghost">
            {GLOBAL_ERROR_COPY.home}
          </ButtonLink>
        </p>
      </body>
    </html>
  );
}

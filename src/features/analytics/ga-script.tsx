import Script from "next/script";
import { resolveMeasurementId } from "@/lib/analytics/ga";

/**
 * gtag 스크립트를 싣습니다. 측정 ID가 없으면 아무것도 그리지 않으므로 네트워크 요청이 일어나지
 * 않습니다. 이슈 #125의 Definition of Done인 "측정 ID 없이 빌드하고 실행했을 때 네트워크 요청이
 * 발생하지 않는 것"을 이 분기가 보장합니다.
 *
 * 두 조각으로 나뉘는 이유입니다.
 *
 * 부트스트랩은 `next/script`가 아니라 평범한 인라인 `<script>`입니다. 서버가 그린 HTML 안에서 파싱
 * 순서대로 실행되므로 hydration 전에 `window.gtag`가 존재합니다. `next/script`의 기본 전략인
 * `afterInteractive`는 hydration이 얼마간 진행된 뒤 클라이언트에서 주입되는데, 로그인 화면이
 * 마운트되며 보내는 `login_view`가 그보다 먼저 일어나 퍼널의 첫 마디를 통째로 잃습니다.
 * `beforeInteractive`도 쓰지 않았습니다. Next.js 16.3.1 문서
 * (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/script.md`)가 이 전략을 봇
 * 탐지기나 쿠키 동의 관리자 같은 임계 스크립트로 한정하고 있습니다.
 *
 * 라이브러리 본체는 `afterInteractive`로 싣습니다. 같은 문서가 애널리틱스와 태그 매니저를 이
 * 전략의 예로 듭니다. 부트스트랩이 쌓아 둔 `dataLayer`를 나중에 도착한 라이브러리가 순서대로
 * 처리하므로, 그 사이에 보낸 이벤트는 유실되지 않습니다.
 */
export function GoogleAnalyticsScript() {
  const measurementId = resolveMeasurementId();
  if (!measurementId) return null;

  // `resolveMeasurementId`가 영숫자와 하이픈만 통과시키므로 문자열 리터럴을 깨는 값이 들어올 수 없습니다.
  const bootstrap = [
    "window.dataLayer = window.dataLayer || [];",
    "function gtag(){window.dataLayer.push(arguments);}",
    "window.gtag = gtag;",
    "gtag('js', new Date());",
    `gtag('config', '${measurementId}');`,
  ].join("");

  return (
    <>
      {/* 인라인 스크립트에는 id가 필요합니다(Next.js 16.3.1 `scripts.md`). */}
      <script id="ga-bootstrap" dangerouslySetInnerHTML={{ __html: bootstrap }} />
      <Script
        id="ga-library"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
        strategy="afterInteractive"
      />
    </>
  );
}

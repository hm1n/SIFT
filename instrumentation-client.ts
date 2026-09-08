/**
 * 브라우저 Sentry 클라이언트를 초기화합니다. hydration 전에 실행되므로 클라이언트 런타임 오류와
 * pageload 트랜잭션을 처음부터 잡습니다.
 *
 * 이슈 #81 범위입니다. 첫 수집 대상은 브라우저의 Core Web Vitals(LCP, CLS, INP, FCP, TTFB)와
 * 클라이언트 런타임 오류입니다. 서버 사이드 트레이싱, Session Replay, Profiling, Source Map
 * 업로드는 각각 후속 이슈로 분리했습니다. 설정 내용과 확인 절차는
 * `llm-wiki/wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.
 *
 * 최상위에 동기 코드만 둡니다. Next.js 16.3.1 문서
 * (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md`)에
 * 따르면 이 파일에서 시작한 비동기 작업은 hydration 전에 끝나는 것이 보장되지 않습니다.
 *
 * `Sentry.init`을 try/catch로 감싸지 않습니다. Next.js 문서는 감싸기를 권하지만 이 프로젝트는
 * 도달 불가능한 방어 코드를 금지합니다. `@sentry/core`의 `dsnFromString`은 DSN 형식이 틀리면
 * `console.error`를 남기고 undefined를 돌려주며 예외를 던지지 않습니다. 잘못된 DSN은 이벤트
 * 전송만 조용히 멈추고 hydration을 막지 않습니다.
 */
import * as Sentry from "@sentry/nextjs";
import { resolveSentryClientOptions } from "@/lib/sentry/client-options";

// DSN이 없으면 초기화하지 않습니다. 로컬 개발과 테스트에서 Sentry로 이벤트가 나가지 않아야
// 합니다. 판정 근거와 회귀 테스트는 `src/lib/sentry/client-options.ts`에 있습니다.
/**
 * CLS를 standalone span으로 보냅니다. 기본값으로 두면 이 프로젝트에서 CLS를 사실상 못 잡습니다.
 *
 * `@sentry/browser` 10.73.0의 `webVitalsIntegration`은 standalone span이 꺼져 있을 때 CLS를
 * pageload 트랜잭션의 measurement로만 싣습니다. 그 트랜잭션은 로드 직후 idle 시점에 끝나므로,
 * 트랜잭션이 끝난 뒤에 생긴 레이아웃 변화는 어디에도 기록되지 않습니다.
 *
 * 이 앱은 라우트가 `/` 하나이고 저장소 분석부터 인터뷰까지 전부 같은 페이지의 상태 전이입니다.
 * 스트리밍이 화면을 미는 시점은 로드보다 수십 초에서 수 분 뒤입니다. 즉 기본값으로는 이슈 #81의
 * Goal인 "스트리밍이 일어나는 경로의 CLS 조회"가 성립하지 않습니다.
 *
 * 프로덕션 빌드로 실측해 확인했습니다. 기본값에서는 로드 직후의 시프트만 pageload measurement로
 * 잡히고 3초 뒤의 시프트는 사라졌습니다. 이 옵션을 켜면 두 경우 모두 `ui.webvital.cls` span으로
 * 옵니다. 절차는 `scripts/measure-sentry-web-vitals.mts`에 있습니다.
 *
 * SDK가 `_experiments`로 분류한 실험 옵션이라 다음 메이저 업그레이드에서 이름이 바뀔 수 있습니다.
 * `browserTracingIntegration`을 옵션과 함께 넘기면 기본 통합 대신 이 인스턴스가 쓰이고, 나머지
 * 기본 통합은 그대로 남습니다.
 */
const options = resolveSentryClientOptions();
if (options) {
  Sentry.init({
    ...options,
    integrations: [
      Sentry.browserTracingIntegration({ _experiments: { enableStandaloneClsSpans: true } }),
    ],
  });
}

// App Router 네비게이션을 트랜잭션으로 잡습니다. `Sentry.init`을 부르지 않은 경우에도 이 함수는
// 클라이언트가 없으면 아무 일도 하지 않으므로 조건 없이 export합니다.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

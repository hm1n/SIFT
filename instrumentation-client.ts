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
 * 판정과 초기화는 `src/lib/sentry/client.ts`에 있습니다. 이 파일은 import만으로 SDK를 초기화하는
 * 부수 효과 파일이라 테스트가 로드할 수 없고, 이슈 #81의 제약도 jsdom에서 이 파일을 로드하지
 * 않도록 요구합니다. 그래서 검증이 필요한 로직을 전부 그쪽에 두고 여기서는 호출만 합니다.
 */
import * as Sentry from "@sentry/nextjs";
import { initSentryClient } from "@/lib/sentry/client";

initSentryClient();

// App Router 네비게이션을 트랜잭션으로 잡습니다. 초기화하지 않은 경우에도 이 함수는 등록된
// 핸들러가 없으면 그냥 반환하므로 조건 없이 export합니다.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

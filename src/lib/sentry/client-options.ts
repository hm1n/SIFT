/**
 * 브라우저 Sentry 클라이언트를 초기화할지, 초기화한다면 어떤 옵션으로 할지를 한 곳에서
 * 결정합니다.
 *
 * 이슈 #81 배경입니다. 이 프로젝트의 프론트엔드 핵심 챌린지는 AI Streaming 중의 렌더링 성능과
 * 스크롤 UX인데 실사용 지표를 재는 수단이 없었습니다. 지금까지의 성능 판단은 로컬 실측에만
 * 의존했으므로 실제 사용자 환경의 LCP나 INP를 알 수 없었습니다. Core Web Vitals를 운영 환경에서
 * 모으는 것이 이 모듈의 목적입니다.
 *
 * 판정 로직을 `instrumentation-client.ts`에서 떼어 이 모듈에 둡니다. 이유가 둘입니다. 첫째,
 * `instrumentation-client.ts`는 최상위에서 `Sentry.init`을 부르는 side effect 파일이라 테스트가
 * import하는 것만으로 SDK를 초기화합니다. 둘째, 이슈 #81의 제약이 jsdom 환경에서 그 파일을
 * 로드하지 않도록 요구합니다. 판정만 순수 함수로 떼어 두면 "DSN이 없으면 초기화하지 않는다"는
 * 제약에 회귀 테스트를 붙일 수 있습니다.
 *
 * 환경변수를 모듈 최상단이 아니라 함수 호출 시점에 읽습니다. 테스트가 `process.env`를 바꿔 가며
 * 여러 경우를 확인할 수 있어야 합니다.
 */

/**
 * 초기 `tracesSampleRate`입니다.
 *
 * Web Vitals는 pageload 트랜잭션의 measurement로 실려 오므로 이 값이 0이면 지표가 아예 오지
 * 않습니다. `browserTracingIntegration`은 `@sentry/nextjs`의 기본 통합이라 따로 켤 필요가
 * 없고, 실제 스위치는 이 값 하나입니다.
 *
 * 트래픽 규모가 정해지지 않았으므로 전량 수집으로 시작합니다. 이슈 #81의 작업 원칙이 추측성
 * 조정을 금지하므로, 실사용 이벤트 양을 보고 나서 낮춥니다. 결정 근거는
 * `llm-wiki/wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.
 */
export const SENTRY_INITIAL_TRACES_SAMPLE_RATE = 1;

export interface SentryClientOptions {
  readonly dsn: string;
  readonly tracesSampleRate: number;
}

/**
 * `NEXT_PUBLIC_SENTRY_DSN`이 없거나 공백뿐이면 null입니다. 그때 호출자는 `Sentry.init`을 부르지
 * 않으므로 로컬 개발과 테스트에서 이벤트가 밖으로 나가지 않습니다.
 *
 * `NEXT_PUBLIC_` 접두사를 쓰는 이유입니다. DSN을 읽는 쪽이 브라우저입니다. 이 값은 Sentry가
 * 공개를 전제로 발급하는 수집 엔드포인트라 클라이언트 번들에 실려도 무해합니다. 반대로 auth
 * token 계열은 서버 전용이며 이 모듈이 다루지 않습니다.
 *
 * 접두사가 붙은 값은 Next.js가 빌드 시점에 번들로 인라인합니다. 런타임 환경변수로 주입해도
 * 브라우저가 읽지 못하므로 DSN은 빌드 파이프라인에 있어야 합니다.
 */
export function resolveSentryClientOptions(): SentryClientOptions | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim();
  if (!dsn) return null;
  return { dsn, tracesSampleRate: SENTRY_INITIAL_TRACES_SAMPLE_RATE };
}

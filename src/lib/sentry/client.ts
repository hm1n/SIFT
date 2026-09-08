import * as Sentry from "@sentry/nextjs";

/**
 * 브라우저 Sentry 클라이언트를 초기화합니다. `instrumentation-client.ts`가 이 함수 하나만
 * 부릅니다.
 *
 * 초기화 자체를 이 모듈에 두는 이유입니다. `instrumentation-client.ts`는 최상위에서 부수 효과를
 * 내는 파일이라 테스트가 import하는 것만으로 SDK가 초기화되고, 이슈 #81의 제약이 jsdom 환경에서
 * 그 파일을 로드하지 않도록 요구합니다. 초기화를 함수로 떼어 두면 SDK를 mock해서 DSN 판정과
 * 예외 격리와 실험 옵션 배선을 모두 회귀 테스트로 고정할 수 있습니다.
 *
 * 환경변수를 모듈 최상단이 아니라 함수 호출 시점에 읽습니다. 테스트가 `process.env`를 바꿔 가며
 * 여러 경우를 확인할 수 있어야 합니다.
 */

/**
 * 초기 `tracesSampleRate`입니다.
 *
 * Web Vitals는 pageload 트랜잭션의 measurement로 실려 오므로 이 값이 0이면 지표가 아예 오지
 * 않습니다. `browserTracingIntegration`은 `@sentry/nextjs`의 기본 통합이라 따로 켤 필요가 없고,
 * 실제 스위치는 이 값 하나입니다.
 *
 * 트래픽 규모가 정해지지 않았으므로 전량 수집으로 시작합니다. 이슈 #81의 작업 원칙이 추측성
 * 조정을 금지하므로, 실사용 이벤트 양을 보고 나서 낮춥니다. 결정 근거는
 * `llm-wiki/wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.
 */
export const SENTRY_INITIAL_TRACES_SAMPLE_RATE = 1;

/**
 * `NEXT_PUBLIC_SENTRY_DSN`이 없거나 공백뿐이면 null입니다.
 *
 * `NEXT_PUBLIC_` 접두사를 쓰는 이유입니다. DSN을 읽는 쪽이 브라우저입니다. 이 값은 Sentry가
 * 공개를 전제로 발급하는 수집 엔드포인트라 클라이언트 번들에 실려도 무해합니다. auth token
 * 계열은 서버 전용이며 이 모듈이 다루지 않습니다.
 *
 * 접두사가 붙은 값은 Next.js가 빌드 시점에 클라이언트 번들로 인라인합니다. 런타임 환경변수로
 * 주입해도 브라우저가 읽지 못하므로 DSN은 빌드 파이프라인에 있어야 합니다.
 */
export function resolveSentryDsn(): string | null {
  return process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || null;
}

/**
 * DSN이 없으면 아무 일도 하지 않고 false를 돌려줍니다. 로컬 개발과 테스트에서 Sentry로 이벤트가
 * 나가지 않아야 합니다.
 *
 * CLS를 standalone span으로 보냅니다. 기본값으로 두면 SDK가 CLS를 pageload 트랜잭션이 끝나는
 * 시점에 그 트랜잭션의 measurement로만 싣고, 끝난 뒤에 생긴 레이아웃 변화는 버립니다. 이 앱은
 * 라우트가 `/` 하나이고 스트리밍이 화면을 미는 시점은 로드보다 수십 초에서 수 분 뒤이므로,
 * 기본값으로는 이슈 #81의 Goal인 "스트리밍이 일어나는 경로의 CLS 조회"가 성립하지 않습니다.
 * 실측 근거와 절차는 `llm-wiki/wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.
 *
 * 이 옵션은 `Sentry.init`이 아니라 `browserTracingIntegration`의 인자로 넘겨야 동작합니다. SDK가
 * `_experiments`로 분류한 실험 옵션이라 업그레이드에서 이름이 바뀔 수 있고, 그때는 CLS가 조용히
 * 사라집니다. 회귀 테스트가 이 배선을 고정하고, `scripts/measure-sentry-web-vitals.mts`가
 * 브라우저에서 CLS span 도착을 확인합니다.
 *
 * 전체를 try/catch로 감쌉니다. 이 코드는 hydration 전에 실행되므로 여기서 던진 예외는 앱
 * 초기화를 막습니다. 잘못된 DSN 하나는 `dsnFromString`이 `console.error`만 남기고 예외를 던지지
 * 않는 것을 확인했지만, 그 사실이 `Sentry.init`과 통합 생성 전체가 어떤 입력에도 던지지 않는다는
 * 근거는 아닙니다. 제3자 SDK의 초기화 실패가 앱을 멈추게 하지 않도록 격리합니다.
 */
export function initSentryClient(): boolean {
  const dsn = resolveSentryDsn();
  if (!dsn) return false;
  try {
    Sentry.init({
      dsn,
      tracesSampleRate: SENTRY_INITIAL_TRACES_SAMPLE_RATE,
      integrations: [
        Sentry.browserTracingIntegration({ _experiments: { enableStandaloneClsSpans: true } }),
      ],
    });
    return true;
  } catch (error) {
    // 계측이 죽는 것은 앱이 죽는 것보다 낫습니다. 원인을 콘솔에 남깁니다.
    console.error("[sentry] 클라이언트 초기화에 실패했습니다.", error);
    return false;
  }
}

/**
 * 서버와 엣지 런타임의 Sentry를 초기화하고 Next.js가 잡은 요청 오류를 Sentry로 넘깁니다.
 *
 * 이슈 #136 범위입니다. 이슈 #81이 브라우저만 계측해 서버에는 SDK가 아예 없었습니다. 배포된 라우트가
 * 전부 서버 실행인데 `Sentry.init`이 불린 적이 없어 서버 오류가 한 건도 수집되지 않았습니다.
 *
 * 이 파일만으로는 수집되지 않습니다. `onRequestError`는 핸들러 밖으로 던져진 오류만 받는데 이 앱의
 * 라우트는 모두 최상위 `try/catch`로 오류를 잡아 타입 있는 응답으로 바꿉니다. 실제 수집은 각 라우트의
 * catch에 붙인 `reportServerError`가 합니다. 여기서 잡는 것은 Server Component 렌더 오류처럼 라우트
 * 밖에서 던져진 것입니다.
 *
 * 최상위에 동기 코드만 둡니다. `register()`는 서버가 요청을 받기 전에 한 번 실행됩니다.
 *
 * 초기화는 `src/lib/sentry/server.ts`에, 전송 판정은 `src/lib/sentry/report.ts`에 있습니다. 이 파일은
 * import만으로 SDK를 초기화하는 부수 효과 파일이라 테스트가 로드할 수 없습니다. 이슈 #81의 제약을
 * 이어받아 검증이 필요한 로직을 전부 그쪽에 두고 여기서는 호출만 합니다. `instrumentation-client.ts`가
 * 같은 구조입니다.
 *
 * 모듈을 둘로 나눈 이유는 라우트가 전송 함수를 부르기 때문입니다. 라우트를 부르는 jsdom 테스트가
 * 서버 SDK를 함께 싣지 않도록, SDK를 정적으로 import하는 파일을 `server.ts` 하나로 묶고 라우트는
 * SDK를 모르는 `report.ts`만 import합니다.
 */
import * as Sentry from "@sentry/nextjs";
import { initSentryServer } from "@/lib/sentry/server";

export function register(): void {
  /**
   * 런타임마다 한 번씩 부릅니다.
   *
   * `@sentry/nextjs`는 번들러 조건(`node`, `edge-light`)에 따라 서로 다른 빌드로 해소되므로 import는
   * 하나로 두고 분기는 `NEXT_RUNTIME`으로 합니다. 두 런타임은 프로세스가 달라 한쪽의 초기화가 다른
   * 쪽에 닿지 않습니다.
   *
   * 지금 이 저장소의 라우트 16개는 전부 `runtime = "nodejs"`이고 `proxy.ts`도 없어 엣지 갈래는
   * 실행되지 않습니다. 그래도 남겨 두는 이유는 엣지에서 도는 코드가 생기는 순간 계측이 다시 비게
   * 되는데 그 사실이 드러나지 않기 때문입니다. 실행 경로가 없어 배포에서 확인하지 못한 갈래라는
   * 것을 `llm-wiki/wiki/2026-09-16-sentry-서버-계측.md`에 적어 두었습니다.
   */
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    initSentryServer();
  }
}

/**
 * Next.js가 요청 처리 중에 잡은 오류를 Sentry로 넘깁니다.
 *
 * SDK가 제공하는 함수를 그대로 씁니다. 이 함수는 라우트 경로와 HTTP 메서드, Next.js가 분류한
 * 오류 맥락(`routerKind`, `routeType`)을 이벤트에 붙입니다. 헤더와 쿠키는 `sendDefaultPii`가 꺼져
 * 있어 실리지 않습니다.
 */
export const onRequestError = Sentry.captureRequestError;

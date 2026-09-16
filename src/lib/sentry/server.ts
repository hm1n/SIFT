import * as Sentry from "@sentry/nextjs";

/**
 * 서버와 엣지 런타임의 Sentry 초기화와 서버 오류 전송을 담습니다.
 *
 * `initSentryServer`는 루트 `instrumentation.ts`가 부르고, `reportServerError`는 각 라우트의 최상위
 * catch가 부릅니다.
 *
 * `src/lib/sentry/client.ts`와 같은 이유로 초기화를 이 모듈에 둡니다. `instrumentation.ts`는
 * import만으로 SDK를 초기화하는 부수 효과 파일이라 테스트가 로드할 수 없습니다. 이슈 #81의 제약을
 * 이슈 #136이 그대로 이어받아 계측 진입 파일을 테스트가 직접 로드하지 않도록 요구합니다. 검증이
 * 필요한 로직을 전부 여기에 두고 진입 파일에서는 호출만 합니다.
 *
 * 라우트가 이 모듈을 import하므로 라우트를 부르는 테스트는 SDK를 함께 싣습니다. jsdom 환경에서는
 * 서버 빌드를 로드하다 `@sentry/server-utils`의 번들러 플러그인에서 깨지므로, 그런 테스트는
 * `vi.mock("@sentry/nextjs", ...)`로 SDK를 가려야 합니다. `save-contract.test.tsx`가 그 경우입니다.
 *
 * 환경변수를 모듈 최상단이 아니라 함수 호출 시점에 읽습니다. 테스트가 `process.env`를 바꿔 가며
 * 여러 경우를 확인할 수 있어야 합니다.
 */

/**
 * 서버 Sentry DSN입니다. 없거나 공백뿐이면 null입니다.
 *
 * `SENTRY_DSN`을 먼저 보고 없으면 `NEXT_PUBLIC_SENTRY_DSN`으로 내려갑니다. 두 값은 같은 Sentry
 * 프로젝트를 가리키므로 공개 DSN 하나만 설정한 배포에서도 서버 이벤트가 나갑니다. 서버 전용 이름을
 * 따로 두는 이유는 나중에 서버 이벤트를 다른 프로젝트로 나눌 때 배포 설정만 바꾸면 되게 하려는
 * 것입니다.
 *
 * DSN은 Sentry가 공개를 전제로 발급하는 수집 엔드포인트라 어느 쪽 이름을 써도 비밀값이 아닙니다.
 * auth token 계열은 서버 전용이며 이 모듈이 다루지 않습니다.
 */
export function resolveServerSentryDsn(): string | null {
  return process.env.SENTRY_DSN?.trim() || process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || null;
}

/**
 * DSN이 없으면 아무 일도 하지 않고 false를 돌려줍니다. 로컬 개발과 테스트에서 Sentry로 이벤트가
 * 나가지 않아야 합니다. 초기화하지 않으면 SDK에 client가 없고, client가 없는 `captureException`은
 * 아무 일도 하지 않으므로 `reportServerError`까지 조용해집니다.
 *
 * `sendDefaultPii`를 명시적으로 끕니다. 기본값도 꺼짐이지만 기본값에 기대지 않습니다. 이 옵션이
 * 켜지면 SDK가 요청 헤더와 쿠키를 이벤트에 싣는데, 이 앱의 세션 쿠키에는 암호화된 GitHub 토큰이
 * 들어 있습니다. 이슈 #136의 제약이 DSN 외의 비밀값이 이벤트에 실리지 않을 것을 요구하므로 값을
 * 코드에 적어 회귀 테스트로 고정합니다.
 *
 * `tracesSampleRate`를 0으로 둡니다. 이번 범위는 오류 수집이고 서버 트랜잭션 샘플링 비율 조정은
 * 이슈 #136의 Non-goal입니다. 실사용 이벤트 양을 보기 전에는 추측으로 켜지 않습니다. 이 값이 0이어도
 * `captureException`은 그대로 동작합니다.
 *
 * 전체를 try/catch로 감쌉니다. `register()`는 서버가 요청을 받기 전에 실행되므로 여기서 던진 예외는
 * 앱 기동을 막습니다. 제3자 SDK의 초기화 실패가 앱을 멈추게 하지 않도록 격리합니다.
 * `src/lib/sentry/client.ts`가 같은 이유로 같은 격리를 합니다.
 */
export function initSentryServer(): boolean {
  const dsn = resolveServerSentryDsn();
  if (!dsn) return false;
  try {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
    return true;
  } catch (error) {
    // 계측이 죽는 것은 앱이 죽는 것보다 낫습니다. 원인을 서버 로그에 남깁니다.
    console.error("[sentry] Server initialization failed.", error);
    return false;
  }
}

/**
 * 오류 응답을 그대로 돌려주면서 status가 500 이상일 때만 Sentry로 보냅니다.
 *
 * 오류 종류를 하나씩 열거하지 않고 status 하나로 가릅니다. 각 라우트가 이미 오류 종류를 status로
 * 옮기고 있으므로, 그 매핑을 한 번 더 베끼면 두 곳이 어긋날 자리가 생깁니다. 이 기준이면
 * `unauthorized`(401), `invalid_json`(400), `body_too_large`(413), `invalid_request`(422),
 * `not_found`(404), `version_conflict`(409)는 자동으로 빠지고 `server_error`(500),
 * `storage_failed`(503), LLM 실패 계열(502, 503, 504)만 남습니다. 사용자 입력 문제를 빼는 이유는
 * Issues가 실제 장애만 담아야 하기 때문입니다.
 *
 * 응답을 만든 뒤에 그 응답을 넘기는 모양인 이유입니다. 각 라우트의 오류 응답 생성 함수는 오류 종류와
 * 문구만 받는 것이 많아 원본 오류 객체를 잃습니다. 스택트레이스가 없으면 Sentry Issue가 재현 조건을
 * 담지 못하므로, 판정은 만들어진 응답의 status로 하고 전송은 catch가 쥐고 있는 원본 오류로 합니다.
 *
 * 응답을 그대로 통과시킵니다. 이슈 #136의 제약이 기존 오류 응답 계약을 바꾸지 않을 것을 요구합니다.
 * `kind`와 `message`와 status 조합은 이 함수를 거쳐도 달라지지 않고, Sentry 전송은 곁들이는 부수
 * 효과입니다.
 *
 * 전송 실패를 삼킵니다. 계측이 던지면 사용자가 받을 오류 응답까지 사라집니다.
 */
export function reportServerError(error: unknown, response: Response): Response {
  if (response.status < 500) return response;
  try {
    Sentry.captureException(error);
  } catch (reportError) {
    console.error("[sentry] Failed to capture a server error.", reportError);
  }
  return response;
}

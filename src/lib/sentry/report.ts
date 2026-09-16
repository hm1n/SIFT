/**
 * 서버 오류를 Sentry로 보낼지 가리고 보냅니다. 라우트가 import하는 쪽입니다.
 *
 * **이 파일은 `@sentry/nextjs`를 import하지 않습니다.** 라우트가 이 함수를 부르므로 라우트를 부르는
 * 테스트는 전부 이 모듈을 함께 싣습니다. 여기서 SDK를 정적으로 import하면 jsdom 환경의 테스트가 서버
 * 빌드를 로드하다 `@sentry/server-utils`의 번들러 플러그인에서 깨집니다
 * (`save-contract.test.tsx`가 훅과 라우트를 한 파일에서 돌립니다). 이슈 #81의 제약이 계측 코드를
 * jsdom에 싣지 않을 것을 요구하고 이슈 #136이 그 제약을 이어받습니다.
 *
 * 그래서 전송 함수를 주입받습니다. SDK를 아는 쪽은 `src/lib/sentry/server.ts` 하나이고, 그 모듈은
 * 루트 `instrumentation.ts`만 import합니다.
 */

/**
 * 서버 오류를 Sentry로 보내는 기준 status입니다.
 *
 * 오류 종류를 하나씩 열거하지 않고 이 값 하나로 가릅니다. 각 라우트가 이미 오류 종류를 status로
 * 옮기고 있으므로, 그 매핑을 한 번 더 베끼면 두 곳이 어긋날 자리가 생깁니다. 이 기준이면
 * `unauthorized`(401), `invalid_json`(400), `body_too_large`(413), `invalid_request`(422),
 * `not_found`(404), `version_conflict`(409)는 자동으로 빠지고 `server_error`(500),
 * `storage_failed`(503), LLM 실패 계열(502, 503, 504)만 남습니다.
 *
 * 사용자 입력 문제를 빼는 이유는 Issues가 실제 장애만 담아야 하기 때문입니다. 잘못된 요청은 사용자가
 * 고칠 수 있고 서버가 할 일은 없습니다.
 */
export const SENTRY_SERVER_ERROR_MIN_STATUS = 500;

export type ServerErrorReporter = (error: unknown) => void;

/**
 * 등록한 전송 함수를 `globalThis`에 답니다. 모듈 지역 변수로 두면 동작하지 않습니다.
 *
 * Next.js는 `instrumentation.ts`와 각 라우트를 서로 다른 번들로 만듭니다. 두 번들이 같은 파일을
 * import해도 모듈 인스턴스가 따로 생기므로, `register()`가 등록한 값을 라우트 쪽 사본은 보지 못합니다.
 * 2026-09-16에 `next start`로 실측했습니다. `register()`는 실행되는데 5xx 경로에서 읽은 값이 계속
 * null이라 이벤트가 한 건도 나가지 않았습니다. 경위는
 * `llm-wiki/raw/2026-09-16-sentry-서버-계측-session-log.md`에 있습니다.
 *
 * 프로세스는 하나이므로 `globalThis`는 두 번들이 함께 봅니다. Sentry SDK 자신도 같은 이유로 클라이언트
 * 상태를 `globalThis.__SENTRY__`에 둡니다. `Symbol.for`를 쓰면 다른 코드와 키가 부딪히지 않습니다.
 */
const REPORTER_KEY = Symbol.for("sift.sentry.serverErrorReporter");

type ReporterCarrier = { [REPORTER_KEY]?: ServerErrorReporter | null };

function currentReporter(): ServerErrorReporter | null {
  return (globalThis as ReporterCarrier)[REPORTER_KEY] ?? null;
}

/**
 * 전송 함수를 등록합니다. `initSentryServer()`가 초기화에 성공했을 때만 부릅니다.
 *
 * 등록하지 않으면 `reportServerError`가 아무 일도 하지 않습니다. DSN이 없는 환경에서 이벤트가 나가지
 * 않아야 한다는 제약이 호출 여부가 아니라 구조로 지켜집니다.
 *
 * 테스트가 되돌릴 수 있도록 null을 받습니다.
 */
export function setServerErrorReporter(next: ServerErrorReporter | null): void {
  (globalThis as ReporterCarrier)[REPORTER_KEY] = next;
}

/**
 * 오류 응답을 그대로 돌려주면서 5xx일 때만 Sentry로 보냅니다.
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
  if (response.status < SENTRY_SERVER_ERROR_MIN_STATUS) return response;
  const reporter = currentReporter();
  if (reporter === null) return response;
  try {
    reporter(error);
  } catch (reportError) {
    console.error("[sentry] Failed to capture a server error.", reportError);
  }
  return response;
}

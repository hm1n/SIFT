/**
 * GA4 전송부입니다. 측정 ID 판정과 gtag 호출만 담당하고 이벤트 어휘는 모릅니다.
 *
 * 어휘를 여기 두지 않는 이유입니다. 이벤트 이름과 파라미터 값은 `LoadingPhase`나 `EmptyKind` 같은
 * 화면 도메인 타입에서 유도하는데, 그 타입은 `features/`에 있습니다. `lib/`이 `features/`를
 * 가져오면 의존 방향이 뒤집히므로 어휘는 `features/analytics/events.ts`에 두고 여기는 문자열과
 * 원시값만 받습니다.
 *
 * 환경변수를 모듈 최상단이 아니라 호출 시점에 읽습니다. `lib/sentry/client.ts`와 같은 이유로,
 * 테스트가 `process.env`를 바꿔 가며 여러 경우를 확인할 수 있어야 합니다.
 */

/** GA4가 받는 파라미터 값입니다. 객체와 배열은 싣지 않습니다. */
export type GaParamValue = string | number | boolean;

/**
 * 값이 `undefined`인 항목은 전송 직전에 빠집니다. 선택 파라미터(`auth_error`처럼 있을 때만 싣는
 * 값)를 부르는 쪽에서 조건부로 조립하지 않아도 되게 하려는 것입니다. GA4에 `undefined`를 그대로
 * 보내면 문자열 "undefined"가 디멘션 값으로 쌓입니다.
 */
export type GaParams = Readonly<Record<string, GaParamValue | undefined>>;

function withoutUndefined(params: GaParams): Record<string, GaParamValue> {
  return Object.fromEntries(
    Object.entries(params).filter((entry): entry is [string, GaParamValue] => entry[1] !== undefined)
  );
}

type Gtag = (command: "event" | "set" | "config" | "js", ...args: unknown[]) => void;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: Gtag;
  }
}

/**
 * 측정 ID의 환경변수 이름입니다. `.env.example`과 문서가 같은 이름을 가리키도록 상수로 둡니다.
 *
 * 값을 읽을 때는 이 상수를 쓰지 않고 `process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID`를 그대로 씁니다.
 * Next.js는 이 표현을 빌드 시점에 문자열로 치환하는데, `process.env[변수]` 형태는 치환 대상이
 * 아니라 브라우저에서 언제나 undefined가 됩니다.
 */
export const GA_MEASUREMENT_ID_ENV = "NEXT_PUBLIC_GA_MEASUREMENT_ID";

/**
 * `NEXT_PUBLIC_GA_MEASUREMENT_ID`가 없거나 공백뿐이면 null입니다. 로컬 개발과 테스트의 정상
 * 상태이므로 콘솔에 경고를 남기지 않습니다(이슈 #125 제약).
 *
 * `NEXT_PUBLIC_` 접두사를 쓰는 이유입니다. 읽는 쪽이 브라우저이고 Next.js가 빌드 시점에 클라이언트
 * 번들로 인라인하므로 값이 빌드 파이프라인에 있어야 합니다. 측정 ID는 페이지 소스에 그대로 실리는
 * 공개 값이라 클라이언트 번들에 들어가도 무해합니다. HMAC 비밀값은 반대이고
 * `lib/analytics/user-id.ts`가 서버에서만 다룹니다.
 */
export function resolveMeasurementId(): string | null {
  const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim();
  if (!measurementId) return null;
  // 측정 ID는 인라인 부트스트랩 스크립트 본문에 문자열로 박힙니다. 형식을 벗어난 값을 그대로 넣으면
  // 환경변수가 스크립트를 깨거나 코드를 끼워 넣는 통로가 됩니다. GA4 측정 ID는 `G-` 뒤에 영숫자이고
  // 그 바깥 문자가 있으면 설정이 잘못된 것이므로 값이 없는 것과 같이 다룹니다.
  return /^[A-Za-z0-9-]+$/.test(measurementId) ? measurementId : null;
}

/**
 * gtag 호출을 한 곳으로 모읍니다. 이 함수 밖에서 `window.gtag`를 부르지 않습니다.
 *
 * 세 가지를 여기서 한꺼번에 막습니다. 측정 ID가 없으면 아무 일도 하지 않고, 스크립트가 로드되지
 * 않아 `window.gtag`가 없으면 그냥 반환하며, gtag가 던지면 삼킵니다. 광고 차단기나 네트워크
 * 정책으로 스크립트가 막히는 경우는 오류가 아니라 정상 경로입니다. 인터뷰 도중 계측 예외로 대화가
 * 끊기면 잃는 것이 훨씬 큽니다.
 *
 * 전송 실패를 보정하지 않습니다. 재전송 큐도 로컬 버퍼도 두지 않습니다. 이 계측의 용도는 비율
 * 비교이고 전수 정확도가 필요한 값이 아닙니다(이슈 #125 제약).
 */
function callGtag(command: "event" | "set", ...args: unknown[]): void {
  if (!resolveMeasurementId()) return;
  try {
    if (typeof window === "undefined") return;
    const gtag = window.gtag;
    if (!gtag) return;
    gtag(command, ...args);
  } catch {
    // 계측이 죽는 것이 화면이 죽는 것보다 낫습니다. 여기서 삼키고 화면으로 올리지 않습니다.
  }
}

/** 이벤트 하나를 보냅니다. 결과를 기다리지 않고 화면은 성공 여부를 받지 않습니다. */
export function sendGaEvent(name: string, params: GaParams): void {
  callGtag("event", name, withoutUndefined(params));
}

/**
 * 이후 모든 이벤트에 붙는 공통 파라미터를 세웁니다. `user_id`, `flow_id`, `repo_visibility`,
 * `repo_language`가 여기로 갑니다.
 *
 * 우리 쪽에 공통 파라미터 맵을 따로 들고 매 전송에 합치지 않고 gtag의 `set`을 씁니다. gtag가 이미
 * 같은 일을 하고, 맵을 따로 두면 두 곳이 어긋날 수 있습니다. 스크립트가 아직 로드되지 않았어도
 * 호출 순서는 dataLayer에 그대로 쌓이므로 뒤따르는 이벤트가 값을 놓치지 않습니다.
 *
 * 값이 null이면 그 파라미터를 지웁니다. 저장소를 바꿔 `flow_id`를 비울 때 씁니다.
 */
export function setGaParams(params: Readonly<Record<string, GaParamValue | null>>): void {
  callGtag("set", params);
}

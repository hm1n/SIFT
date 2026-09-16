---
날짜: 2026-09-16
주제: 이슈 #136 서버 Sentry 계측과 오류 수집 경로 연결
결론 문서: wiki/2026-09-16-sentry-서버-계측.md
이어받는 자료: raw/2026-09-08-sentry-클라이언트-계측-session-log.md
---

# 이슈 #136 서버 계측 세션 로그

## 이 세션에서 한 일

이슈 #136을 읽고 계획을 세운 뒤 구현하고, 자체 리뷰로 설계를 한 번 되돌렸습니다. 커밋 일곱 개를
만들었습니다.

## 1. 계획 단계에서 이슈 본문과 달랐던 것

이슈 본문은 최상위 catch 네 곳을 적었습니다. 코드를 훑어보니 같은 성격의 catch가 13개 파일 18곳에
있었습니다. 넷만 고치면 나머지 14곳이 그대로 조용하므로 전부 배선하기로 했습니다.

이슈 Approach가 요구한 엣지 런타임 초기화는 지금 도달 경로가 없습니다. 라우트 16개가 전부
`runtime = "nodejs"`이고 Next.js 16에서 미들웨어가 이름을 바꾼 `proxy.ts`도 없습니다. `AGENTS.md`의
"호출 순서" 규칙이 도달 불가능한 방어 코드를 지적하라고 정하고 있어 계획 보고에 올렸고, 이슈가
명시한 항목이므로 넣되 확인하지 못한 사실을 기록하기로 했습니다.

`node_modules/next/dist/docs/`가 이 워크트리에 없었습니다. `next dev`가 생성하는 디렉터리인데 아직
돌리지 않은 상태였습니다. 규약은 `next/dist/server/instrumentation/types.d.ts`와
`next-app-loader`를 직접 읽어 확인했습니다. `register()`와 `onRequestError`의 시그니처, 그리고
`global-error` 규약이 모두 유효했습니다.

## 2. 첫 번째 막힘 - jsdom 테스트가 서버 SDK를 로드하다 깨짐

라우트에 `reportServerError`를 배선한 뒤 전체 테스트를 돌리자 한 파일이 깨졌습니다.

```
FAIL  src/features/experience-block/save-contract.test.tsx
TypeError: The URL must be of scheme file
 ❯ fileURLToPath ...@apm-js-collab/code-transformer-bundler-plugins/dist/esm/webpack.mjs:5:34
 ❯ Module.<anonymous> ...@sentry/server-utils/build/cjs/orchestrion/bundler/webpack.js:5:17
```

훅과 route를 한 파일에서 돌리는 jsdom 테스트라, route가 끌어온 서버 SDK를 jsdom 환경에서 로드하다
번들러 플러그인에서 멈춘 것이었습니다.

여기서 선택지가 둘이었습니다. 깨진 테스트에 SDK mock을 넣는 방법과, 라우트가 SDK를 아예 모르게
모듈을 나누는 방법입니다. 이슈 #81의 제약이 jsdom에 계측 코드를 싣지 않도록 요구하는 것을 근거로
후자를 골랐습니다. SDK를 아는 `server.ts`와 SDK를 모르는 `report.ts`로 나누고, 전송 함수를
`initSentryServer()`가 등록하면 라우트가 꺼내 쓰는 주입 방식으로 이었습니다.

**이 판단이 뒤에서 뒤집힙니다.** 5절입니다.

## 3. 두 번째 막힘 - 단위 테스트는 통과하는데 이벤트가 0건

주입 방식으로 전체 테스트와 lint와 typecheck가 모두 통과했습니다. 그런데 실제로 이벤트가 나가는지
확인하지 않은 상태였으므로 로컬에서 확인 절차를 만들었습니다. Sentry 계정이 없어 가짜 수집 서버를
127.0.0.1:9999에 띄우고 DSN을 그쪽으로 돌렸습니다.

첫 실행 결과가 이랬습니다.

```
=== 4xx: no auth header ===       status=401
=== 5xx: DATABASE_URL 없음 ===     status=503
=== envelopes received ===        0
```

응답은 기대대로인데 envelope이 0건이었습니다. 처음에는 `instrumentation.ts`를 Next.js가 못 찾은
것으로 의심해 `.next/server/instrumentation.js`가 만들어졌는지 확인했습니다. 만들어져 있었습니다.

원인을 좁히려고 진단 로그를 두 자리에 넣고 다시 빌드했습니다.

```
[diag] reporter registered                ← register()에서
[diag] reportServerError 503 NO REPORTER  ← 라우트에서
```

`register()`는 실행되었는데 라우트가 읽은 값은 계속 null이었습니다. Next.js가 `instrumentation.ts`와
각 라우트를 서로 다른 번들로 만들어 같은 파일의 모듈 인스턴스가 둘 생긴 것이었습니다. 등록 위치를
`globalThis`로 옮겨 고쳤고, 다시 확인하니 envelope 1건에 `"type":"DatabaseError"`와 한국어 오류 문구,
프레임이 달린 `stacktrace`가 실려 왔습니다.

**단위 테스트로는 잡을 수 없는 종류였습니다.** 테스트는 한 번들 안에서 돌아 인스턴스가 하나뿐이고,
판정 로직 자체는 처음부터 옳았습니다. 실행 중인 서버에 요청을 보내 보지 않았다면 이 상태로 PR을
올렸을 것입니다.

## 4. 확인한 것

로컬 `next start`로 세 가지를 확인했습니다.

| 경우 | envelope |
| --- | --- |
| DSN 있음, 4xx(401) | 0건 |
| DSN 있음, 5xx(503) | 1건, `DatabaseError` + stacktrace |
| DSN 없음, 5xx(503) | 0건 |

비밀값 점검도 같은 envelope 본문으로 했습니다. `cookie`, `authorization`, `Bearer`, cron secret 값
네 가지를 찾아 전부 0건이었습니다.

## 5. 자체 리뷰가 2절의 판단을 뒤집음

커밋 네 개를 만든 뒤 ponytail 리뷰를 돌렸습니다. 과잉 설계만 보는 리뷰이고 지적이 여섯 건
나왔습니다. 그중 첫 번째가 2절에서 고른 주입 방식이었습니다.

지적의 요지는 이랬습니다. 전송 함수를 `globalThis`에 보관하는 것은 Sentry SDK가 자기 client를
`globalThis.__SENTRY__`에 두는 것과 똑같은 일이고, SDK를 그대로 부르면 3절의 문제 자체가 생기지
않는다는 것이었습니다. 즉 2절에서 피하려던 것(jsdom 테스트 한 곳)의 값이 3절에서 치른 값보다
작았습니다.

되돌리면서 잃는 것을 두 가지로 정리해 사용자에게 보고하고 결정을 받았습니다.

- DSN이 없을 때 조용한 것이 우리 코드의 구조가 아니라 SDK의 동작에 기대게 됩니다.
- 앞으로 라우트를 부르는 jsdom 테스트마다 SDK mock이 필요하고, 빠뜨리면 2절의 오류가 납니다.

되돌리는 쪽으로 결정이 나서 `report.ts`와 `report.test.ts`를 지우고 `server.ts` 하나로 합쳤습니다.
첫 번째 우려는 실측으로 닫았습니다. DSN 없이 5xx를 세 번 내도 envelope이 0건이고 SDK가 경고도 남기지
않았습니다. 두 번째는 지금 해당하는 파일이 하나뿐이고 위키 6절에 mock 예시를 적어 두었습니다.

## 6. 자체 리뷰의 나머지 다섯 건

전부 반영했습니다.

- 읽는 곳이 한 군데뿐인 상수 `SENTRY_SERVER_ERROR_MIN_STATUS`와 그 값이 500인지 확인하는 테스트를
  지우고 숫자를 그 자리에 적었습니다.
- `instrumentation.ts`의 `NEXT_RUNTIME` 분기는 두 갈래가 같은 일을 하고 `register()`가 브라우저에서
  불리지 않으므로 지웠습니다.
- 라우트 여덟 개를 훑던 테스트를 실제로 갈라지는 지점 세 개로 줄였습니다.
- `global-error.tsx`의 인라인 스타일을 CSS 모듈로 옮겼습니다.
- 한 자리에서만 필요한 `cause ?? new Error(...)` 대체 처리를 지우고 그 자리에서 오류를 직접
  넘기게 했습니다.

정리 커밋은 138줄 추가에 302줄 삭제로 순 164줄이 줄었습니다. 전체 스위트 실행 시간도 오히려
짧아졌습니다. import 합계가 206~245초에서 151~194초가 되었습니다.

## 7. 접은 대안

- **라우트의 `try/catch`를 걷어내 예외를 밖으로 흘리고 `onRequestError`만 쓰기.** `AGENTS.md`의 작업
  원칙이 모든 핵심 흐름에 Error 상태를 요구합니다. 이슈 본문도 같은 이유로 접었습니다.
- **`onRequestError`만 붙이고 라우트를 그대로 두기.** 라우트가 예외를 던지지 않으므로 수집 건수가
  0입니다.
- **공용 오류 응답 생성 함수 안에서 전송하기.** `savedInterviewErrorResponse`처럼 오류 종류와 문구만
  받는 함수가 많아 원본 오류 객체를 잃습니다. 스택트레이스 없는 Issue는 재현 조건을 담지 못합니다.
- **엣지 초기화를 빼기.** 지금 도달 경로가 없다는 점에서 후보였지만, 이슈가 명시한 항목이고 엣지가
  생기는 순간 계측이 다시 비는 것이 드러나지 않으므로 남겼습니다.

## 8. 범위 밖이지만 함께 고친 것

전체 테스트가 회차마다 다른 화면 테스트 하나씩을 떨어뜨렸습니다. 아홉 번 중 두 번이었습니다. 이
브랜치가 건드리지 않은 파일이고 정리 뒤 스위트가 오히려 빨라진 것을 확인해 원인이 아님을 먼저
가렸습니다.

그대로 두면 이 PR의 CI가 빨개져 리뷰어가 실패 원인을 이 PR로 오해할 수 있어, 사용자 결정을 받고 함께
고쳤습니다. 원인이 자리마다 달라 셋으로 나뉘었습니다. 상세는 backlog 19번에 있습니다. 전체 스위트를
여섯 번 연속 돌려 전부 통과하는 것을 확인했습니다.

## 9. 남은 것

- 배포 환경에서 5xx와 클라이언트 렌더 오류가 Sentry Issues에 도착하는지 확인. 이슈 #136의
  Definition of Done 두 항목입니다.
- Vercel 서버리스에서 응답 뒤 함수가 동결되기 전에 전송이 끝나는지 확인. backlog 14번입니다.

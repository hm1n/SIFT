---
출처: Issue #81 구현 세션. 프로덕션 빌드를 Playwright chromium으로 통과시킨 실측 포함
확인 날짜: 2026-09-08
관련: wiki/2026-09-08-sentry-클라이언트-계측.md, wiki/2026-09-08-sentry-계측-후속-backlog.md, raw/2026-09-02-브라우저-화면-전-구간-실측.md
---

# Sentry 클라이언트 계측을 넣은 세션

## 이 문서가 담는 것

Issue #81을 구현하면서 무엇을 재고 무엇을 시도했고 무엇이 실패했는지를 시간순으로 적습니다.
확정된 설정과 측정값은 `wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.

## 착수 전에 막힌 것

`node_modules`가 깨져 있었습니다. `npm ls next`가 `invalid: "16.3.1"`을 냈고
`node_modules/next/package.json`이 없었습니다. `AGENTS.md`는 코드를 쓰기 전에
`node_modules/next/dist/docs/`의 해당 문서를 읽으라고 요구하는데 그 디렉터리도 없었습니다.

`npm install`이 "up to date, audited 555 packages"를 출력했지만 실제로는 복구가 일어났습니다.
설치 전 `node_modules` 항목이 435개였고 설치 후 555개입니다. 복구 뒤 `package.json`과 `dist/docs`가
모두 생겼습니다.

이 상태가 어떻게 생겼는지는 확인하지 못했습니다. 워크트리 생성 과정에서 부분 복사가 일어났을
가능성이 있지만 근거가 없습니다.

## 이슈 전제를 확인하면서 고친 것

패키지를 설치하기 전에 `npm pack @sentry/nextjs@10.73.0`으로 tarball만 내려 내용을 확인했습니다.
프로젝트에 의존성을 넣기 전에 API가 이슈 설명대로인지 보려는 것이었습니다. 다섯 개를 고쳤습니다.

첫째, `browserTracingIntegration`은 이슈가 "켜면"이라고 쓴 것과 달리 이미 기본 통합입니다.
`build/cjs/client/index.js`의 `getDefaultIntegrations`가 tracing 플래그가 tree-shake로 죽지 않는 한
항상 넣습니다. 실제 스위치는 `tracesSampleRate`가 0보다 큰지 하나입니다.

둘째, Source Map을 끄는 옵션 이름은 `sourcemaps.disable`입니다. `build/types/config/types.d.ts`에
있습니다.

셋째, Next.js 16.3에 `instrumentationClientInject`가 새로 생겼고 문서가 `withSentry` 같은 래퍼를
예로 듭니다. 그래서 Sentry가 이미 그 통로를 쓰는지 확인했습니다. 패키지 617개 파일 전체와 GitHub
코드 검색 모두 0건입니다. 쓰지 않습니다. 루트 `instrumentation-client.ts`를 직접 써야 합니다.

넷째, `.env` 예시 파일이 없었고 `.gitignore`의 `.env*`가 `.env.example`까지 무시합니다.
`!.env.example` 부정 규칙을 함께 넣지 않으면 파일이 커밋되지 않습니다. 이슈 Tasks가 이 단계를
빠뜨렸습니다.

다섯째, 이슈 Approach의 "실행 스크립트에 변수를 추가한다"는 대상이 없습니다. `package.json`
scripts에 환경변수를 주입하는 자리가 없습니다.

FCP는 이슈가 맞았습니다. Sentry Performance Score가 LCP 30, INP 30, FCP 15, CLS 15, TTFB 10퍼센트로
다섯 개를 모두 씁니다.

## 되돌린 결정 1. `Sentry.init`을 try/catch로 감싸는 것

Next.js 문서가 이 파일의 코드를 try/catch로 감싸기를 권합니다. 하지만 이 프로젝트는 도달 불가능한
방어 코드를 금지합니다. 그래서 `Sentry.init`이 실제로 던질 수 있는지 확인했습니다.

`@sentry/core`의 `dsnFromString`은 DSN 형식이 틀리면 `console.error`를 남기고 undefined를 돌려주며
예외를 던지지 않습니다. 잘못된 DSN은 전송만 조용히 멈추고 hydration을 막지 않습니다. 도달하지
않는 catch이므로 넣지 않았습니다.

## 되돌린 결정 2. `release: { create: false }`

첫 프로덕션 빌드가 auth token이 없다는 경고를 남겼습니다. 타입 정의에 `release.create` 옵션이
있어서 넣고 다시 빌드했습니다. **경고가 그대로 남았습니다.**

원인을 찾았습니다. `handleRunAfterProductionCompile`이 `createRelease()`를 조건 없이 부르고,
`@sentry/bundler-plugin-core`의 `createRelease()`가 `options.release.name`과 개발 모드와 auth token을
차례로 검사하며 반환합니다. auth token 검사가 `create` 값보다 먼저 반환하므로 이 옵션에 도달하지
않습니다.

`AGENTS.md`의 호출 순서 규칙에 걸리는 경우입니다. 앞 단계가 먼저 반환해 뒤 설정이 도달 불가능해집니다.
옵션을 빼고 그 이유를 코드 주석과 위키에 남겼습니다.

`silent: true`로 경고를 지우는 것도 접었습니다. 경고 하나를 지우려고 Sentry 빌드 로그를 전부 끄면
이후의 실제 경고까지 가려집니다.

## 고친 것. 루트 import deprecation

`npm run typecheck`가 경고를 냈습니다.

```
[@sentry/nextjs] Importing `withSentryConfig` from `@sentry/nextjs` is deprecated and will stop
working in v11. Import it from `@sentry/nextjs/config` instead
```

`AGENTS.md`가 deprecation 경고를 따르라고 정하고 있어 `@sentry/nextjs/config`로 옮겼습니다.

## 확인 절차를 세 번 고친 경위

### 1차. 파서가 지표를 못 찾음

첫 실행 결과가 `measurement 이름: connection.rtt, ttfb, ttfb.requestTime`이었고 LCP와 FCP가 없었습니다.
계측이 안 되는 것으로 보였습니다.

envelope 원본을 파일로 떠서 열어 보니 `"lcp":{"value":440,"unit":"millisecond"}`가 들어 있었습니다.
같은 빌드에서 회차마다 결과가 달랐습니다. pageload 트랜잭션이 끝나는 시점과 지표가 보고되는 시점이
경쟁하고 있었습니다.

그래서 확인 절차를 결정적으로 바꿨습니다. 로드 뒤에 충분히 기다린 다음 상호작용과 레이아웃 변화를
만들고, envelope 항목마다 `op`와 `measurements`를 따로 출력하게 했습니다.

### 2차. 링크 클릭이 멈춤

INP를 만들려면 실제 상호작용이 필요합니다. 미인증 첫 화면에는 입력도 버튼도 없고 GitHub 로그인
링크 하나뿐이었습니다. `page.route`로 `/api/auth/github/login`을 abort하고 링크를 클릭했습니다.

**스크립트가 300초 타임아웃까지 멈췄습니다.** Playwright의 클릭이 네비게이션 완료를 기다리는데
요청이 abort되어 끝나지 않았습니다.

`document`에 capture 단계 클릭 리스너를 붙여 `preventDefault`만 하는 방식으로 바꿨습니다. 클릭은
실제 입력으로 남고 네비게이션은 시작되지 않습니다. 이 방식으로 INP가 `ui.interaction.click` span의
measurement로 왔습니다.

### 3차. CLS가 계속 없음

LCP, FCP, TTFB, INP가 다 나온 뒤에도 CLS만 없었습니다. 레이아웃 시프트를 만드는 시점을 바꿔
가설을 확인했습니다.

| 시프트 시점 | 기본 설정 결과 |
| --- | --- |
| 로드 직후 | pageload measurement에 `cls` 있음 |
| 로드 3초 뒤 | 없음 |

`webVitalsIntegration`을 읽어 원인을 확인했습니다. standalone span이 꺼져 있으면 CLS를 pageload
트랜잭션이 끝나는 시점에 그 트랜잭션의 measurement로만 싣습니다. 끝난 뒤의 시프트는 버립니다.

이 앱은 라우트가 `/` 하나이고 스트리밍이 화면을 미는 시점은 로드보다 한참 뒤입니다. 즉 기본값으로는
Issue #81의 Goal이 성립하지 않습니다.

`_experiments.enableStandaloneClsSpans`를 `Sentry.init` 옵션에 넣고 다시 빌드했습니다. **바뀌지
않았습니다.** `browserTracingIntegration.js`가 이 값을 `Sentry.init` 옵션이 아니라 통합 자신의
인자에서 읽습니다. `browserTracingIntegration({ _experiments: { enableStandaloneClsSpans: true } })`로
옮기니 로드 직후와 3초 뒤 두 경우 모두 `ui.webvital.cls` span으로 왔습니다.

이 과정에서 `client-options.ts`를 한 번 되돌렸습니다. 처음에는 `_experiments`를
`SentryClientOptions`에 넣었는데, 통합 인자로 옮기면서 그 모듈은 순수 데이터만 돌려주도록 되돌리고
통합 배선은 `instrumentation-client.ts`로 옮겼습니다. 이렇게 두면 DSN 판정에만 회귀 테스트를 붙일
수 있습니다.

## 측정

### Core Web Vitals 전송 경로

DSN을 넣은 프로덕션 빌드에서 envelope 5건을 열어 확인했습니다.

```
item op=pageload transaction=/ measurements=connection.rtt,fcp,fp,lcp,ttfb,ttfb.requestTime
item op=ui.interaction.click measurements=inp
item op=ui.webvital.cls measurements=cls
```

DSN을 뺀 빌드에서 같은 절차를 돌려 envelope 요청 0건을 확인했습니다.

### 초기화 비용

`instrumentation-client.ts`에 `performance.mark`를 임시로 넣어 `Sentry.init` 구간을 10회 재고
표시를 지웠습니다. 21.5, 22.2, 23.3, 23.6, 24.5, 26.1, 26.2, 26.8, 26.9, 33.3밀리초입니다.

`performance.mark`는 모듈 평가 비용을 담지 않으므로 Next.js 자신의 측정과 비교했습니다. `next dev`를
DSN과 함께 띄우고 페이지를 세 번 로드하니 매번 경고가 나왔습니다.

```
[Client Instrumentation Hook] Slow execution detected: 42ms
[Client Instrumentation Hook] Slow execution detected: 22ms
[Client Instrumentation Hook] Slow execution detected: 24ms
```

**Next.js 경고 기준 16밀리초를 넘습니다.** 두 측정이 비슷하므로 파일 비용은 거의 전부 `Sentry.init`
비용입니다.

옵션을 줄이지 않았습니다. Issue #81의 제약이 추측으로 옵션을 조정하지 말라고 정하고 있고, 무엇을
줄이면 얼마가 줄어드는지 아직 재지 않았습니다. backlog 2번으로 넘겼습니다.

### 첫 로드 JS

같은 빌드 설정에서 `instrumentation-client.ts`만 빼고 다시 빌드해 비교했습니다. Playwright가
`/_next/static/` 아래 JS 응답의 비압축 바이트를 더한 값입니다.

| 빌드 | 첫 로드 static JS |
| --- | --- |
| Sentry 클라이언트 포함 | 1,456,285바이트, 1,422.2 KB |
| `instrumentation-client.ts` 제거 | 1,224,557바이트, 1,195.9 KB |
| 증가분 | 231,728바이트, 226.3 KB, 18.9퍼센트 |

이 측정은 이슈 Tasks에 없습니다. 계획 보고 때 제안해 승인을 받고 함께 쟀습니다. 비압축 크기이므로
실제 전송량과 다릅니다.

## 재지 못한 것

- **Sentry 화면을 보지 못했습니다.** organization과 project와 DSN이 없어 envelope 단계까지만
  확인했습니다.
- **인터뷰 화면에서 재지 못했습니다.** 인터뷰 화면에 닿으려면 GitHub 토큰과 실제 API 호출 3분 이상이
  필요합니다. 라우트가 `/` 하나라 SDK 동작은 화면과 무관하지만, 스트리밍이 실제로 만드는 CLS 크기는
  재지 못했습니다.
- **레이아웃 시프트를 앱이 만들지 않았습니다.** 확인 절차가 요소를 직접 넣어 시프트를 만듭니다.
  전송 경로 확인이 목적이고 CLS 수치는 성능 근거로 쓰지 않습니다.
- **압축 전송량과 파싱 비용을 재지 못했습니다.** 번들 증가분은 비압축 기준입니다.

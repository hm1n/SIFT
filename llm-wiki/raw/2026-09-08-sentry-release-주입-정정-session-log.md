---
출처: ChatGPT `gpt-5.6-sol` 리뷰 세션의 지적을 받아 `@sentry/nextjs` 10.73.0 소스와 프로덕션 빌드 산출물로 확인
확인 날짜: 2026-09-08
관련: raw/2026-09-08-sentry-클라이언트-계측-session-log.md, wiki/2026-09-08-sentry-클라이언트-계측.md, wiki/2026-09-08-sentry-계측-후속-backlog.md
---

# Sentry release 주입 판단을 정정한 세션

## 무엇을 정정합니까

`raw/2026-09-08-sentry-클라이언트-계측-session-log.md`의 "되돌린 결정 2. `release: { create: false }`"
절이 틀렸습니다. 그 절은 이 옵션을 도달 불가능한 설정으로 판단해 뺐다고 적었습니다. **옵션은
도달합니다.** 규칙에 따라 그 파일은 고치지 않고 이 파일로 정정합니다.

같은 세션 로그의 "되돌린 결정 1. `Sentry.init`을 try/catch로 감싸는 것"도 근거가 좁았습니다. 아래
3절에 적습니다.

## 어떻게 알았습니까

PR 업로드 전 코드 리뷰를 ChatGPT `gpt-5.6-sol` 세션으로 돌렸습니다. `codex exec`에 read-only
샌드박스, reasoning effort high, 프롬프트 첫 줄에 `/ponytail full`을 넣었습니다. codex 쪽에 ponytail
스킬이 없어 로컬 마켓플레이스를 등록해 플러그인을 설치했습니다.

리뷰가 `next.config.ts`를 P1으로 지적했습니다. 옵션을 생략하면 SDK가 Git SHA를 자동 탐색해
`_sentryRelease`로 번들에 주입한다는 내용이었습니다.

## 확인 1. 소스

`@sentry/nextjs/build/cjs/config/withSentryConfig/getFinalConfigObjectUtils.js`입니다.

```js
function resolveReleaseName(userSentryOptions) {
  const shouldCreateRelease = userSentryOptions.release?.create !== false;
  return shouldCreateRelease
    ? userSentryOptions.release?.name ?? node.getSentryRelease() ?? buildTime.getGitRevision()
    : userSentryOptions.release?.name;
}
```

`create`가 false면 자동 탐색 세 갈래가 전부 끊기고 `release.name`만 남습니다. 이름을 주지 않았으므로
`releaseName`이 undefined가 됩니다. 그러면 `buildTime.js`의 `if (releaseName)` 가지가 통과하지 않아
`_sentryRelease`가 빌드 타임 변수에 들어가지 않습니다.

**앞 세션의 오류는 관찰 대상을 잘못 고른 것입니다.** auth token 경고가 사라지는지만 보고 옵션이
아무 일도 하지 않는다고 결론했습니다. 경고는 `createRelease()` 안에서 auth token 검사가 `create`
값보다 먼저 반환하므로 이 옵션과 무관하게 남습니다. 그 사실은 맞았고, 거기서 "옵션이 도달하지
않는다"로 넓힌 것이 틀렸습니다. 경고 억제와 release 이름 해소는 서로 다른 경로입니다.

## 확인 2. 빌드 산출물

옵션 없이 만든 프로덕션 빌드의 클라이언트 청크에 커밋 SHA가 리터럴로 박혀 있었습니다.

```
release:"d7d6ee695d8d966778085282812f41ef70641ab1"
```

`release: { create: false }`를 넣고 다시 빌드하니 같은 자리가 값이 아니라 조회로 남았습니다.

```
release:E.default.env._sentryRelease||j._sentryRelease
```

클라이언트 청크 20개에서 SHA 검색이 0건입니다.

## 왜 P1으로 판정했습니까

이슈 #81의 Non-goal이 "Releases와 Source Map 업로드는 다루지 않습니다"입니다. 옵션을 빼 둔 상태는
release 값을 모든 이벤트에 붙이므로 범위 밖 기능을 절반만 켜 둔 것이 됩니다. 커밋 SHA가 공개
클라이언트 번들에 실리는 것도 의도한 바가 아닙니다. AGENTS.md 등급 표의 "핵심 요구사항 위반"에
해당해 이번 PR에서 고쳤습니다.

리뷰는 이 지적에 회귀 테스트를 요구했습니다. 프로덕션 빌드 산출물을 읽어야 하는 검사라 vitest
스위트에 넣을 수 없습니다. `scripts/measure-sentry-web-vitals.mts`가 이미 프로덕션 빌드를 전제하므로
그 안에 넣었습니다. 옵션을 임시로 빼고 빌드해 검사가 실제로 실패하는 것까지 확인했습니다.

## 확인 3. try/catch 근거를 좁힌 것

앞 세션은 잘못된 DSN이 `dsnFromString`에서 `console.error`만 남기고 던지지 않는 것을 확인한 뒤,
`Sentry.init` 전체가 던지지 않는다고 결론했습니다. 확인한 것보다 넓은 주장이었습니다. 리뷰가 P2로
지적했고 동의했습니다.

`instrumentation-client.ts`는 hydration 전에 실행되므로 여기서 던진 예외는 앱 초기화를 막습니다.
제3자 SDK가 어떤 입력에도 던지지 않는다는 것을 증명할 수 없으므로 격리하는 편이 맞습니다. 수정이
세 줄이라 이번 PR에 함께 넣었습니다.

같은 성격으로 리뷰가 짚지 않은 곳을 직접 훑었습니다. `captureRouterTransitionStart`가 초기화 없이도
무해하다는 주석은 확인 결과 맞습니다. 핸들러가 없으면 그냥 반환합니다. 위키에 있던 "auth token을
넣지 않는 것만으로도 업로드는 일어나지 않는다"는 문장은 확인하지 않은 주장이었고
`sourcemaps.disable`을 켠 상태에서는 무의미하므로 뺐습니다.

## 모듈을 합친 경위

try/catch에 회귀 테스트를 붙이려면 초기화가 함수 안에 있어야 합니다. `instrumentation-client.ts`는
import만으로 부수 효과를 내는 파일이고 이슈 제약이 jsdom에서 그 파일을 로드하지 않도록 요구하므로
테스트가 직접 부를 수 없습니다.

그래서 `src/lib/sentry/client-options.ts`를 `src/lib/sentry/client.ts`로 합쳤습니다.
`initSentryClient()` 하나가 DSN 판정과 초기화와 예외 격리를 담고, `instrumentation-client.ts`는 그
함수를 부르고 `onRouterTransitionStart`만 export합니다.

이 변경이 리뷰의 P3도 일부 받아들인 것입니다. 리뷰는 옵션 모듈이 실제 `Sentry.init` guard와 실험
옵션 배선을 검증하지 못한다고 지적했고 그것은 사실이었습니다. 다만 모듈을 지우고
`instrumentation-client.ts`에 직접 넣으라는 제안은 받지 않았습니다. 리뷰가 제시한 대안 테스트가 SDK를
mock해 그 파일을 직접 import하는 방식이라 이슈 제약을 그대로 위반합니다. 모듈을 하나로 합치면 파일
수는 리뷰가 원한 만큼 줄고 테스트는 실제 초기화를 검증합니다.

테스트 9건이 DSN 세 가지 무효 입력, 유효 DSN의 init 인자, 실험 옵션이 통합 인자로 가는 것,
`Sentry.init`이 던질 때와 통합 생성이 던질 때 예외가 새지 않는 것을 고정합니다.

## 확인 절차를 다시 만든 경위

리뷰가 `scripts/measure-sentry-web-vitals.mts`를 P1으로 지적했습니다. 세 가지가 겹쳐 있었습니다.
measurement와 op를 item 구분 없이 전역으로 합쳐 세는 것, 기대 지표가 하나도 없어도 종료 코드가 0인
것, 고정 대기로 도착을 추정하는 것입니다.

**P2로 내려 판정했습니다.** 제품 코드가 아니라 개발용 확인 스크립트이고 잘못된 결과가 사용자에게
가지 않습니다. 다만 전역 집계는 AGENTS.md의 판별 기준 위반입니다. `op.includes(vital)` 매칭이라 값이
없는 span만 와도 통과합니다. 수정 비용이 작아 예외 조항으로 이번 PR에 넣었습니다.

고정 대기를 조건 대기로 바꾸는 것은 처음에 후속으로 분리하려 했다가 이번에 함께 고쳤습니다. 종료
코드만 붙이고 대기를 그대로 두면 게이트가 산발적으로 실패해 신뢰할 수 없습니다. pageload envelope가
실제로 도착한 뒤에 레이아웃을 밀고, 기대 조합이 모두 모일 때까지 제한 시간 안에서 기다리게
했습니다.

## 최종 확인

세 경우를 실제로 돌렸습니다.

| 실행 | 종료 코드 |
| --- | --- |
| DSN 있는 빌드에 `on` 모드 | 0, 지표 다섯 개 모두 수집 |
| DSN 없는 빌드에 `off` 모드 | 0, envelope 요청 0건 |
| DSN 없는 빌드에 `on` 모드 | 1, 지표 다섯 개 모두 없음으로 실패 |

`release: { create: false }`를 임시로 빼고 빌드해 release 검사도 1로 실패하는 것을 확인했습니다.

## 재지 못한 것

- **Sentry 화면은 여전히 보지 못했습니다.** organization과 project와 DSN이 없어 envelope 단계까지만
  확인했습니다.
- **리뷰어의 머지 불가 판정 근거 하나는 샌드박스 산물입니다.** 전체 테스트와 `next typegen`이 EPERM
  으로 실패했다고 적혔는데 read-only 샌드박스로 돌린 결과입니다. 이 세션에서 직접 돌린 결과는
  통과입니다.

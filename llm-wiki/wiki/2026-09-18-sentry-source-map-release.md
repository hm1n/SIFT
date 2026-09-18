---
확인 날짜: 2026-09-18
근거: raw/2026-09-18-sentry-source-map-release-session-log.md, next.config.ts, next.config.test.ts, scripts/measure-sentry-web-vitals.mts, .env.example
---

# Sentry Source Map 업로드와 release 연결

## 결론

**Source Map을 Sentry로 올리고 브라우저에는 남기지 않습니다.** 이슈 #144 범위입니다. 이슈 #81과
#136이 클라이언트와 서버 오류를 모으는 데까지만 해서, 오류가 들어와도 스택이 번들 기준이라 어느
코드인지 드러나지 않고 release가 없어 어느 배포인지도 가려지지 않았습니다.

**설정은 `next.config.ts` 네 줄입니다.**

```ts
export const sentryBuildOptions = {
  org: "hm1n",
  project: "sift",
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
} as const satisfies SentryBuildOptions;
```

이슈 #81이 넣었던 `sourcemaps: { disable: true }`와 `release: { create: false }`를 지운 것이
이번 변경의 전부입니다. 나머지는 SDK의 기본값이 맡습니다.

**이 프로젝트는 Turbopack 경로를 탑니다.** Next.js 16의 `next build`는 번들러 플래그가 없으면
`TURBOPACK` 환경변수를 세우고 Turbopack으로 빌드하고, `@sentry/nextjs`가 같은 변수를 읽어 경로를
가릅니다. webpack 경로를 전제한 설정과 문서는 이 프로젝트에 해당하지 않습니다.

## 브라우저에 맵이 남지 않는 이유

Turbopack 경로에서 Source Map 업로드가 켜지면 SDK가 `productionBrowserSourceMaps`를 자동으로
켭니다. 맵이 브라우저가 받을 수 있는 자리에 생긴다는 뜻입니다. 같은 조건에서 SDK가
`deleteSourcemapsAfterUpload`도 `true`로 세우고, 빌드 훅이 업로드 뒤 `.next/static`의 맵을 지운
다음 `sourceMappingURL` 주석까지 떼어냅니다.

**이 자동 동작은 조건부입니다.** `productionBrowserSourceMaps`를 직접 설정하면 뒤따르는
`deleteSourcemapsAfterUpload` 기본값이 서지 않고 맵이 그대로 남습니다. 그래서 값을 명시합니다.

삭제 대상은 `.next/static`뿐입니다. 서버 맵은 브라우저에 노출되지 않으므로 남고, 덕분에 서버
스택도 원래 위치를 가리킵니다. Turbopack 프로덕션 빌드가 서버 맵을 내는 것은 실측으로
확인했습니다. `experimental.serverSourceMaps`는 필요 없습니다.

업로드가 건너뛰어져도 삭제는 돕니다. auth token이 없는 로컬 프로덕션 빌드에서도 맵이 남지
않습니다.

## release가 이벤트에 붙는 경로

`release.create`가 기본값(켜짐)이면 `resolveReleaseName`이 이름을 해소하고, 그 이름이
`next.config`의 `env._sentryRelease`로 들어갑니다. Next.js의 `env`는 클라이언트와 서버 번들
양쪽에 인라인되므로 번들러와 무관하게 동작하고, SDK의 client와 server와 edge `init`이 그 값을
`release` 기본값으로 읽습니다.

이름은 Vercel에서 `VERCEL_GIT_COMMIT_SHA`, 로컬에서 `git rev-parse HEAD`입니다.
`SENTRY_RELEASE`를 넣으면 그 값이 우선합니다.

**이슈 #81의 결정이 뒤집혔습니다.** #81은 Releases가 범위 밖이라 release 값이 이벤트에 붙지
않아야 했고, 그래서 `release.create`를 껐습니다. 이번 이슈는 배포를 구분하는 것이 목표이므로
같은 동작이 의도한 결과가 됩니다. #81이 그 동작을 막으려고 만든 검사도 함께 뒤집었습니다.
아래 "확인 절차"를 봅니다.

## auth token

`SENTRY_AUTH_TOKEN`으로 받습니다. 서버 전용 비밀값이고 빌드 시점에 필요합니다.
Organization Auth Token(`sntrys_`로 시작)을 권장하고, 개인 토큰을 쓸 때 필요한 권한은
`project:releases`와 `org:read`입니다.

**토큰이 없어도 빌드는 끝납니다.** SDK가 업로드와 Release 생성을 건너뛰고 경고만 남깁니다.
예외를 던지지 않습니다. 로컬 빌드와 토큰을 넣지 않은 환경의 정상 상태입니다. 그 빌드로 올라간
배포는 스택이 번들 기준이고 이벤트에 release가 붙지 않습니다.

**org와 project는 코드에 적습니다.** 환경변수 폴백(`SENTRY_ORG`, `SENTRY_PROJECT`)이 있지만, 그
값이 빠지면 빌드가 성공하면서 업로드만 조용히 사라집니다. 둘 다 비밀값이 아닙니다.

`silent`는 켜지 않습니다. 경고 하나를 지우려고 Sentry 빌드 로그를 전부 끄면 이후의 실제 경고까지
가려집니다.

## 확인 절차

`next.config.test.ts`가 설정이 되돌아가는 것을 막습니다. 이 설정은 프로덕션 빌드에서만 효과가
드러나므로 되돌려도 일반 테스트는 빨개지지 않습니다. 그래서 `TURBOPACK`을 세운 상태로
`next.config`를 import해 `withSentryConfig`가 만든 결과를 검사합니다.

- `productionBrowserSourceMaps`가 `true`인지. 꺼지면 `undefined`가 됩니다.
- `compiler.runAfterProductionCompile`이 함수인지. 업로드와 삭제를 도는 훅입니다.
- `env._sentryRelease`에 release 이름이 있는지. `release.create`를 끄면 사라집니다.
- `sourcemaps.deleteSourcemapsAfterUpload`가 `true`로 명시돼 있는지.

`scripts/measure-sentry-web-vitals.mts`의 `checkReleaseInjected()`는 프로덕션 빌드 산출물을 읽어
release 이름이 클라이언트 청크에 실제로 실렸는지 확인합니다. 이슈 #81 시점에는 같은 자리에서
**실리지 않았는지**를 확인했습니다. 기대가 뒤집힌 검사입니다.

**기대값은 `.next/required-server-files.json`의 `config.env._sentryRelease`에서 읽습니다.** 빌드가
확정한 값이라 검사 대상과 기대값의 출처가 하나입니다. 확인 시점에 `SENTRY_RELEASE`와 Git revision을
다시 읽으면 빌드 뒤에 커밋을 하나만 더 쌓아도 값이 달라져, 멀쩡히 주입된 빌드를 실패로 보고합니다.
2026-09-18 자체 리뷰에서 지적받아 고쳤고, 고친 뒤 빌드 기록과 HEAD가 다른 상태에서 통과하는 것을
확인했습니다.

## 실측 (2026-09-18, auth token 없음)

- 빌드 성공. 경고는 `Will not create release.`와 `Will not upload source maps.` 두 줄.
- `.next/static`의 `.map` 0개, `sourceMappingURL`을 담은 `.js` 0개.
- `.next/server`의 `.map` 139개.
- 커밋 SHA가 클라이언트 청크 1개와 서버 청크 4개에 인라인.

## 확인 필요

- 프로덕션 Sentry Issue의 스택이 원래 코드 위치를 가리키는지. 실제 배포와 오류가 필요합니다.
- 이벤트에 붙은 release로 배포 사이가 갈리는지.
- 토큰을 넣은 프로덕션 빌드 로그에 auth token 경고가 사라지는지.

## 이번에 하지 않은 것

- `tracesSampleRate`는 0으로 둡니다. 이슈 #136의 결정을 유지합니다.
- 수집하는 오류의 범위를 넓히지 않았습니다. `reportServerError`의 5xx 기준 그대로입니다.
- Sentry 알림 규칙은 다루지 않았습니다.
- preview 배포의 업로드를 끄지 않았습니다. preview도 릴리즈를 만들고 맵을 올려 할당량을 씁니다.
  실사용 양을 보기 전에 추측으로 끄지 않고 backlog로 남겼습니다.

# Sentry Source Map 업로드와 release 연결 세션 로그

작성: 2026-09-18
대상 이슈: #144
이어받는 자료: `raw/2026-09-08-sentry-release-주입-정정-session-log.md`, `wiki/2026-09-08-sentry-클라이언트-계측.md`, `wiki/2026-09-16-sentry-서버-계측.md`

## 1. 시작 지점

`next.config.ts`가 `sourcemaps: { disable: true }`와 `release: { create: false }`로 둘을 끄고
있었습니다. 이슈 #81의 결정이고, 그 시점에는 Releases와 Source Map 업로드가 범위 밖이었습니다.

이슈 #144가 남긴 미확인 항목이 하나 있었습니다. "Source Map을 Sentry로 올리고 브라우저에
노출하지 않는 것이 `@sentry/nextjs`가 제공하는 옵션으로 되는지 확인이 필요합니다."

## 2. SDK 내부를 읽어 확인한 것

`@sentry/nextjs` 10.73.0을 읽었습니다.

`node_modules/next/dist/lib/bundler.js`의 `parseBundlerArgs`가 번들러 플래그가 하나도 없으면
`process.env.TURBOPACK = 'auto'`를 세우고 Turbopack을 고릅니다. Next.js 16.3.1의 `next build`가
그 경로입니다. `@sentry/nextjs`의 `detectActiveBundler()`가 같은 환경변수를 읽으므로 이 프로젝트는
Turbopack 경로를 탑니다. 이 사실이 이후 판단을 전부 가릅니다. webpack 경로를 전제한 문서와 설정은
이 프로젝트에 맞지 않습니다.

`getFinalConfigObjectBundlerUtils.js`의 `maybeEnableTurbopackSourcemaps`가 Turbopack 경로에서
다음 순서로 동작합니다.

1. `sourcemaps.disable`이 켜져 있으면 아무 일도 하지 않습니다.
2. 사용자가 `productionBrowserSourceMaps`를 설정했으면 아무 일도 하지 않습니다.
3. 아니면 `productionBrowserSourceMaps = true`로 켭니다.
4. 사용자가 `sourcemaps.deleteSourcemapsAfterUpload`를 설정했으면 거기서 멈춥니다.
5. 아니면 그 값을 `true`로 세웁니다.

`handleRunAfterProductionCompile.js`가 업로드 뒤 `deleteArtifacts()`로 `.next/static`의 맵을
지우고, SRI를 켜지 않았으면 `stripSourceMappingURLComments()`로 `sourceMappingURL` 주석까지
떼어냅니다. 삭제 대상 패턴은 `createFilesToDeleteAfterUploadPattern`이 만들고 `static` 아래로
한정됩니다. 서버 맵은 남습니다.

**그래서 미확인 항목의 답은 "된다"입니다.** 기본값만으로도 됩니다. 다만 3번과 4번이 조건부라서,
누군가 `productionBrowserSourceMaps`를 직접 설정하면 5번이 실행되지 않고 맵이 그대로 남습니다.
그래서 `deleteSourcemapsAfterUpload: true`를 명시하기로 했습니다.

`deleteArtifacts()`는 업로드 성공 여부와 무관하게 돕니다. auth token이 없어 업로드를 건너뛴
빌드에서도 맵은 지워집니다. 토큰 없는 로컬 프로덕션 빌드가 소스를 흘리지 않습니다.

release 주입 경로도 읽었습니다. `resolveReleaseName`이 이름을 해소하고,
`buildTime.js`의 `setUpBuildTimeVariables`가 그 이름을 `userNextConfig.env._sentryRelease`로
넣습니다. Next.js의 `env`는 클라이언트와 서버 번들 양쪽에 인라인되므로 번들러와 무관하게
동작합니다. `generateValueInjectionRules`에는 release가 없어서 한때 Turbopack에서는 주입되지
않는 줄 알았는데, 주입 경로가 loader가 아니라 `env`였습니다.

auth token이 없을 때의 동작은 `@sentry/bundler-plugin-core`의 `createRelease()`와
`canUploadSourceMaps()`가 `logger.warn` 뒤 `return`하는 것으로 끝납니다. 던지지 않습니다.

`normalizeUserOptions`가 `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`을 폴백으로 읽습니다.
셋 다 환경변수로만 둘 수 있지만, org와 project가 빠지면 `No org provided. Will not upload source
maps.`로 빌드가 성공하면서 업로드만 사라집니다. 비밀값이 아니므로 코드에 적기로 했습니다.

## 3. 실측

auth token 없이 `npm run build`를 돌렸습니다.

- 빌드가 성공했습니다. 경고는 두 줄입니다. `Will not create release.`와 `Will not upload source maps.`
- `.next/static`의 `.map` 파일 0개. `sourceMappingURL`을 담은 `.js` 0개.
- `.next/server`의 `.map` 파일 139개. Turbopack 프로덕션 빌드가 서버 맵을 냅니다.
  `experimental.serverSourceMaps`를 따로 켤 필요가 없었습니다.
- 커밋 SHA `a60bd0a...`가 클라이언트 청크 1개와 서버 청크 4개에 인라인됐습니다.

`node scripts/measure-sentry-web-vitals.mts http://localhost:3101 off`도 통과했습니다.
`release 주입: 있음 — release 이름 a60bd0ae...이 chunks\36nlhm2hdjzql.js에 있습니다.`

## 4. 이슈에 없던 작업 하나

`scripts/measure-sentry-web-vitals.mts`의 `checkReleaseNotInjected()`가 **커밋 SHA가 클라이언트
번들에 없어야 통과**하는 검사였습니다. 이슈 #81의 Non-goal을 고정한 검사입니다. 이번 이슈가 그
기대를 뒤집었으므로 이 검사는 이제 정상 동작을 실패로 보고합니다.

이슈 Tasks에 없는 항목이지만 같은 계약이 뒤집힌 자리이므로 함께 고쳤습니다. `checkReleaseInjected()`로
바꾸고 기대를 반대로 세웠습니다. 기대하는 이름은 SDK의 해소 순서를 따라 `SENTRY_RELEASE`가 있으면
그 값, 없으면 Git revision입니다. git revision을 읽을 수 없을 때 이전 구현은 통과시켰는데
(`ok: true`) 이제는 실패로 보고합니다. 확인할 수 없는 것을 통과로 두면 검사가 아닙니다.

## 5. 접은 것

- **`silent: true`로 경고 지우기.** 이슈 Constraints가 금지합니다. 토큰을 넣어 원인을 없앱니다.
- **`org`와 `project`를 환경변수로 두기.** 값이 빠져도 빌드가 성공해서 업로드만 조용히 사라집니다.
- **`experimental.serverSourceMaps` 추가.** 실측에서 서버 맵이 이미 나왔습니다. 필요 없는 옵션입니다.
- **preview 배포의 업로드 끄기.** preview도 릴리즈를 만들고 맵을 올려 Sentry 할당량을 씁니다.
  실사용 전에는 양을 모르므로 추측으로 끄지 않고 backlog로 남겼습니다.

## 6. 남은 것

이슈의 Definition of Done 가운데 앞 두 줄은 실제 배포 뒤에 닫힙니다. auth token 발급, Vercel
환경변수 등록, 프로덕션에서 오류를 내 Sentry Issue의 스택과 release를 확인하는 것이 남았습니다.

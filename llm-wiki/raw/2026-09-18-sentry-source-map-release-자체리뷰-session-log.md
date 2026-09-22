# Sentry Source Map release 자체 리뷰 세션 로그

작성: 2026-09-18
대상 이슈: #144
이어받는 자료: `raw/2026-09-18-sentry-source-map-release-session-log.md`

## 1. 라운드 정보

PR을 올리기 전 자체 리뷰입니다. 구현과 테스트와 lint와 typecheck를 끝낸 뒤 한 번 돌렸습니다.
지적은 2건이고 라운드는 1회입니다.

- 스스로 돌린 ponytail 리뷰: 1건 (테스트 파일의 모듈 로드 경로 불일치)
- 다른 세션의 리뷰: 1건 (`checkReleaseInjected()`의 기대값 계산, P2)

merge blocker로 판정한 P0과 P1은 없었습니다.

## 2. ponytail 리뷰에서 나온 것

`next.config.test.ts`의 네 번째 테스트만 헬퍼를 쓰지 않고 `import("./next.config")`를 직접
불렀습니다. `afterEach`의 `resetModules` 뒤라 그 테스트만 `TURBOPACK` 없이 config를 한 번 더
평가했습니다. 읽는 값이 번들러와 무관해 결과는 맞았지만 같은 모듈을 두 조건으로 읽는 구조였습니다.
헬퍼가 `{ config, options }`를 함께 돌려주게 바꾸고 중복된 `resetModules`를 지웠습니다.

**지우려다 남긴 것이 하나 있습니다.** `as const satisfies SentryBuildOptions`를 군더더기로 보고
빼려 했는데, 실제로 확인하니 옵션 키 오타를 이 절만 잡습니다. `telemetri`로 바꾸면 `TS2561`이
나오고, `satisfies`를 빼면 컴파일이 통과합니다. 객체를 변수로 넘기면 호출부의 excess property
검사가 걸리지 않기 때문입니다. 오타 난 Sentry 옵션은 조용히 무시되는 종류라 남겼습니다.

## 3. 다른 세션 리뷰에서 나온 것

`checkReleaseInjected()`가 기대하는 release 이름을 확인 시점의 `SENTRY_RELEASE`와 Git HEAD로 다시
계산했습니다. 빌드 시점의 입력과 같다는 보장이 없어 멀쩡히 주입된 빌드를 실패로 보고할 수 있습니다.

**같은 성격의 결함을 찾다가 후보 하나를 기각했습니다.** `staticDir`이 `.next`를 상수로 박고 있어
같은 계열로 보였지만, 빌드 메타데이터 파일 자체가 `.next` 아래 있어 경로의 시작점은 어차피
상수입니다. `distDir`을 메타데이터에서 읽는 것은 형식만 갖춘 코드라 넣지 않았습니다.

등급은 P2에 동의했고 예외 조항 가운데 "수정 비용이 매우 작은 경우"로 이번 PR에서 반영했습니다.
빌드가 이미 `.next/required-server-files.json`에 `config.env._sentryRelease`를 적어 두고 있어서
값을 다시 만드는 부분을 그 파일을 읽는 것으로 바꾸면 끝났습니다.

실패 경로도 둘로 갈랐습니다. 빌드가 이름을 정하지 못한 경우와 이름은 있는데 번들에 없는 경우는
볼 자리가 다릅니다.

## 4. 고친 뒤 확인

고친 직후 커밋을 하나 쌓아 HEAD를 `9c9b426`으로 옮기고, 빌드가 `65a0bdb`를 기록한 상태에서
스크립트를 돌렸습니다. 통과했습니다. 이전 구현이었다면 이 조건에서 실패했을 것이고, 지적받은
false negative의 실제 재현입니다.

## 5. 회귀 테스트를 넣지 못한 이유

검사 함수가 고정 경로의 실제 파일시스템을 읽습니다. 하네스를 만들려면 경로 주입으로 스크립트를
다시 설계해야 해서 "수정 비용이 매우 작다"는 예외 근거와 어긋납니다. backlog 8번이 같은 사유로
이미 열려 있어 이 건을 그 항목에 적었습니다.

ponytail 리뷰에서 나온 테스트 로드 경로 문제는 `next.config.test.ts` 4건이 그대로 회귀 테스트
역할을 합니다.

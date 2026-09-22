---
확인 날짜: 2026-09-08
근거: raw/2026-09-08-sentry-클라이언트-계측-session-log.md, wiki/2026-09-08-sentry-클라이언트-계측.md
---

# Sentry 계측 후속 backlog

## 문서 목적

Issue #81을 구현하면서 이번 범위 밖으로 넘긴 항목을 기록합니다. 별도 GitHub Issue는 만들지
않습니다. 확정된 설정과 측정값은 `wiki/2026-09-08-sentry-클라이언트-계측.md`에 있고, 그 과정은
`raw/2026-09-08-sentry-클라이언트-계측-session-log.md`에 있습니다.

## 1. Sentry 화면에서 지표 최종 확인

envelope 단계까지만 확인했습니다. Sentry organization과 project, DSN이 없어 Sentry Performance
화면에 LCP, CLS, INP가 실제로 그려지는 것을 보지 못했습니다.

DSN이 생기면 `scripts/measure-sentry-web-vitals.mts`의 가로채기를 끄고 같은 절차를 한 번 더 돌려
화면까지 확인합니다.

**2026-09-16에 서버 쪽이 여기 붙었습니다.** 이슈 #136이 서버 계측을 넣으면서 Source Map을 범위 밖에
두었으므로 서버 스택트레이스도 minified 상태로 보입니다. 위 확인을 할 때 서버 Issue의 프레임이
읽을 만한지 함께 봅니다.

**2026-09-18에 이슈 #144가 Source Map 업로드를 켰습니다.** 이제 확인할 것은 프레임이 읽을 만한지가
아니라 원래 코드의 파일과 줄을 가리키는지입니다. release가 이벤트에 붙는지도 같은 화면에서 함께
봅니다.

## 2. 초기화 비용 21.5~33.3밀리초를 줄일 수 있는지

`instrumentation-client.ts` 실행이 Next.js 경고 기준 16밀리초를 넘습니다. 중앙값 26.1밀리초이고
거의 전부가 `Sentry.init` 비용입니다.

무엇을 줄이면 얼마가 줄어드는지 아직 재지 않았습니다. 후보는 기본 통합 가운데 이번 수집 대상과
무관한 것을 빼는 것입니다. Issue #81의 제약이 추측으로 옵션을 조정하지 말라고 정하고 있으므로
통합별 비용을 먼저 재고 나서 판단합니다.

이 프로젝트의 핵심 챌린지가 렌더링 성능이라는 점에서 우선순위가 낮지 않습니다. 계측 도구가
hydration을 미루면 재려는 지표 자체가 나빠집니다.

## 3. 첫 로드 JS 226.3 KB 증가분

비압축 기준 18.9퍼센트 늘었습니다. 전송 바이트가 아니라 비압축 크기이므로 실제 전송량과 파싱
비용을 따로 재야 합니다.

2번과 같은 이유로 우선순위가 있습니다. 다만 이번 이슈는 계측만 다루므로 측정 결과만 남겼습니다.

## 4. 인터뷰 화면을 페이지 단위로 구분할 수 없음

이 앱은 라우트가 `/` 하나이고 인터뷰 화면까지 전부 같은 페이지의 상태 전이입니다. 그래서 Sentry의
페이지 단위 조회로 인터뷰 화면의 지표만 떼어 볼 수 없습니다. 첫 화면과 인터뷰 화면의 CLS와 INP가
같은 `/`에 섞입니다.

Issue #81의 Goal은 "스트리밍이 일어나는 경로의 LCP, CLS, INP를 Sentry에서 조회할 수 있습니다"인데
지표가 오는 것까지는 만족하고 경로별 구분은 만족하지 않습니다.

이번 범위에서 풀 수 없습니다. Issue #81의 Non-goal이 커스텀 스팬과 지표 추가를 제외하고 있어서,
화면 단계를 span이나 태그로 표시하는 것은 후속 이슈 "Custom Spans와 Metrics"에 속합니다.

## 5. App Router 네비게이션 계측이 실제로는 도달하지 않음

`onRouterTransitionStart`를 export했지만 MVP 흐름에는 App Router 네비게이션이 없습니다. 4번과 같은
이유입니다. 라우트가 하나뿐이고 화면 전환이 클라이언트 상태 변화입니다.

지금은 죽은 배선입니다. 라우트를 나누면 그때부터 동작하므로 지우지 않고 둡니다.

## 6. `.env.example`에 나머지 환경변수가 없음

`.env.example`을 이번에 처음 만들었고 `NEXT_PUBLIC_SENTRY_DSN` 하나만 담았습니다. 코드가 이미
쓰고 있는 GitHub OAuth와 LLM 관련 환경변수는 담지 않았습니다. Issue #81 범위가 아닙니다.

2026-09-16에 이슈 #136이 `SENTRY_DSN`, `GA_USER_ID_HMAC_SECRET`, `DATABASE_URL`, `CRON_SECRET` 등
그동안 추가된 값과 함께 `SENTRY_DSN`을 넣었습니다. 남은 것은 여전히 GitHub OAuth와 LLM 관련
환경변수입니다.

정리 대상은 `src/lib/github/oauth.ts`의 세 개와 `src/features/experience-candidates/llm-provider.ts`의
여러 개입니다. 이름과 기본값과 필수 여부를 함께 적어야 하므로 별도 작업으로 다룹니다.

## 7. 빌드마다 남는 auth token 경고

프로덕션 빌드가 `[@sentry/nextjs - After Production Compile] Warning: No auth token provided.`를
남깁니다. `release: { create: false }`를 넣어도 이 경고는 막히지 않습니다. `createRelease()` 안에서
auth token 검사가 `create` 값보다 먼저 반환하기 때문입니다.

이 옵션이 아무 일도 하지 않는다고 판단해 한동안 빼 두었던 것을 2026-09-08에 정정했습니다. 옵션은
release 이름 해소를 막습니다. 경위는 `raw/2026-09-08-sentry-release-주입-정정-session-log.md`에
있습니다.

Releases와 Source Map 업로드 후속 작업에서 auth token을 넣으면 경고가 사라집니다.

**2026-09-18에 이슈 #144 브랜치에서 닫았습니다.** `sourcemaps.disable`과 `release.create`를 걷어내고
`SENTRY_AUTH_TOKEN`을 빌드 파이프라인에 넣었습니다. 토큰이 있는 빌드에서는 경고가 나오지 않고, 없는
빌드는 경고만 남긴 채 그대로 끝납니다. 설정과 실측은 `wiki/2026-09-18-sentry-source-map-release.md`에
있습니다.

## 8. 측정 스크립트에 vitest 회귀 테스트가 없음

`scripts/measure-sentry-web-vitals.mts`에 vitest 테스트를 넣지 못했습니다. `AGENTS.md`는 결함마다
회귀 테스트를 요구하고, 넣을 수 없으면 그 사실과 이유를 여기에 남기라고 정하고 있습니다.

이 프로젝트는 측정 스크립트를 vitest 스위트에 넣지 않는다는 방침이 있고
`src/features/interview/measurement/`의 `.measure.mts` 세 개에도 테스트가 없습니다. 스크립트가
최상위에서 인자를 읽고 실행 자체가 부수 효과라 함수 하나만 떼어 부를 수 없습니다.

대신 스크립트 자신이 기대와 다를 때 종료 코드 1을 내도록 만들었습니다. `on` 모드와 `off` 모드,
그리고 커밋 SHA가 release로 인라인되지 않았는지의 검사가 각각 실제로 실패하는 것을 확인했습니다.
DSN 판정과 예외 격리와 실험 옵션 배선은 `src/lib/sentry/client.test.ts`가 SDK를 mock해 고정합니다.

**2026-09-18에 이 공백이 한 번 더 드러났습니다.** 이슈 #144의 자체 리뷰가 `checkReleaseInjected()`의
기대값 계산을 지적했고 고쳤지만, 회귀 테스트를 붙이지 못했습니다. 검사 함수가 고정 경로의 실제
파일시스템을 읽어서 하네스를 만들려면 경로 주입으로 스크립트를 다시 설계해야 합니다.

**PR #148 리뷰에서 CodeRabbit이 같은 공백을 지적했습니다.** P2로 판정해 이번 PR에서 반영하지 않고 이
항목으로 합쳤습니다. 이슈 #144의 Goal과 Constraints에 걸리지 않고, 수정 비용이 작다는 예외에도
해당하지 않습니다. `scripts/measure-sentry-web-vitals.mts`가 모듈 최상위에서 `main()`을 실행하므로
테스트가 import하는 순간 Playwright가 실행됩니다. 검사 함수를 분리하는 것만으로 끝나지 않고 진입점의
실행 조건까지 바꿔야 하며, 그 변경이 잘못되면 확인 절차가 아무 일도 하지 않으면서 통과합니다.

이 항목을 풀 때 `checkReleaseInjected()`를 첫 대상으로 삼습니다. 검사할 경우는 셋입니다.

- `.next/required-server-files.json`이 없거나 파싱되지 않는 경우
- 메타데이터에 `_sentryRelease`가 없거나 비어 있는 경우
- release 이름과 일치하는 클라이언트 청크가 있는 경우와 없는 경우

**검사 함수 하나만 떼어내는 것으로는 부족합니다.** 테스트가 없는 것은 이 함수만이 아닙니다. envelope
요청 수 판정, `EXPECTED_VITALS` 조합 판정, Chromium 종료 처리까지 이 스크립트 전체가 테스트 밖에
있습니다. 함수 하나에만 테스트를 붙이면 같은 지적이 다른 줄에서 다시 나옵니다.

## 9. 확인 절차를 CI에서 돌리지 않음

`scripts/measure-sentry-web-vitals.mts`는 이제 종료 코드로 실패를 알립니다. 그런데 사람이 손으로
돌려야 합니다. 프로덕션 빌드 두 번과 서버 기동, Chromium이 필요해 지금 파이프라인에 넣기에는
무겁습니다.

CI에 넣지 않으면 SDK 업그레이드로 CLS 실험 옵션 이름이 바뀌었을 때 아무도 모르는 상태로 지나갈 수
있습니다. `src/lib/sentry/client.test.ts`가 배선을 고정하지만, 그 배선이 실제로 CLS span을 만드는지는
브라우저에서만 확인됩니다.

## 10. 확인 절차의 대기 상한이 고정값임

pageload envelope 도착과 지표 수집을 조건 대기로 바꿨지만 상한은 고정값입니다. 느린 환경에서
상한에 걸리면 실패로 보고합니다. 상한을 인자로 받게 하거나 환경에 맞춰 늘리는 것은 실제로 걸리는
사례가 나온 뒤에 판단합니다.

## 11. 옵션 모듈을 지우자는 ponytail 제안

2026-09-08 리뷰가 `src/lib/sentry`의 모듈을 지우고 `instrumentation-client.ts`에 직접 넣으라고
제안했습니다(P3). 절반만 받아들여 옵션 모듈과 초기화를 `client.ts` 하나로 합쳤습니다.

완전히 지우지는 않았습니다. 리뷰가 제시한 대안 테스트가 SDK를 mock해 `instrumentation-client.ts`를
직접 import하는 방식인데, 이슈 #81의 제약이 "jsdom 환경에서 `instrumentation-client.ts`가 로드되지
않도록 합니다"입니다. 제약이 바뀌면 다시 봅니다.

## 12. `interview-stream-view` 테스트가 간헐적으로 실패함

이번 PR에서 `develop`을 머지한 뒤 전체 테스트를 돌리다 관측했습니다.
`src/features/interview/interview-stream-view.test.tsx`의 "위로 올려 읽는 중에 새 질문이 도착하면
자리를 빼앗지 않고 안내만 한다"가 회차에 따라 실패합니다. 파일 하나만 여덟 번 돌려 한 번 실패했습니다.

**이 브랜치의 원인이 아닙니다.** `git diff origin/develop HEAD -- src/features/interview`가 비어
있어 테스트와 대상 코드가 `develop`과 바이트 단위로 같습니다. 이 브랜치가 `src/`에 더한 것은
`src/lib/sentry/client.ts`와 그 테스트뿐이고, 그 모듈을 import하는 곳은
`instrumentation-client.ts` 하나이며 vitest는 그 파일을 로드하지 않습니다.

이름이 스크롤 위치 유지에 관한 것이므로 타이밍에 의존하는 단정으로 보입니다. 원인 규명과 수정은
인터뷰 스트리밍 쪽 작업에서 다룹니다. 이번 PR의 merge blocker로 취급하지 않습니다.

**2026-09-08에 이슈 #78 브랜치에서 닫았습니다.** 원인은 그 테스트가 청크 반영과 새 메시지 안내를
한 렌더에서 일어나는 것으로 보고 동기 조회로 잡던 것이었습니다. 안내 표시는 뒤 렌더에서 일어나므로
스위트가 길어져 스케줄이 밀리면 조회 시점에 아직 없습니다. 조회를 `findByRole`로 바꿨고, 같은
파일의 절단 안내 테스트가 열린 스트림을 남기던 것도 함께 완결시켰습니다. 화면 테스트 파일 단독
5회와 전체 스위트 3회가 통과합니다. 경위는
`raw/2026-09-08-인터뷰-종료와-이력절단-안내-자체리뷰-session-log.md` 2절에 있습니다.

## 13. 기존 측정 스크립트도 Chromium을 성공 경로에서만 닫음

`src/features/interview/measurement/streaming-render-cost.measure.mts`가 201행에서 Chromium을 띄우고
308행에서 닫으며 `finally`가 없습니다. 이번 PR에서 고친 것과 같은 근본 원인입니다. 중간에서 던지면
브라우저가 살아남아 Node가 종료하지 않습니다.

이 PR에서 고치지 않았습니다. 이번 변경이 건드리지 않은 파일이고 Issue #81 범위 밖입니다. 스트리밍
렌더링 측정 작업에서 함께 고칩니다.

## 14. Vercel 서버리스에서 이벤트 도달을 확인하지 못함

이슈 #136이 서버 오류 전송을 로컬 `next start`로만 확인했습니다. 절차와 결과는
`wiki/2026-09-16-sentry-서버-계측.md` 5절에 있습니다.

Vercel의 서버리스 함수는 응답을 보낸 뒤 동결될 수 있습니다. 전송이 그 전에 끝나지 않으면 이벤트가
사라집니다. `@sentry/nextjs`가 라우트 핸들러를 자동으로 감싸며 flush를 붙이는 것으로 알려져 있지만
이 저장소에서 확인한 적은 없습니다.

배포 뒤에 의도적으로 5xx를 내 Sentry Issues에 도착하는지 봅니다. 오지 않으면 `waitUntil`로
`Sentry.flush()`를 붙이는 것이 다음 후보입니다.

## 15. 스트림 중간 실패가 수집 기준에 걸리지 않음

`api/interview/stream`은 첫 조각을 보낸 뒤에 난 실패를 HTTP 상태가 아니라 스트림 안의 `error`
이벤트로 보냅니다. 응답은 이미 200으로 시작했으므로 이슈 #136의 status 5xx 기준에 걸리지 않습니다.

이슈 #136의 Why가 적은 "LLM 호출 실패"의 일부가 여전히 보이지 않는다는 뜻입니다. 기준을 상태
코드에서 떼어내야 하므로 별도 작업으로 다룹니다.

## 16. OAuth 실패가 5xx가 아니라 리다이렉트로 나감

`api/auth/github/login`은 설정 누락을 `?auth_error=config_missing`으로, `api/auth/github/callback`은
토큰 교환 실패를 리다이렉트로 처리합니다. 둘 다 302라 수집 기준에 걸리지 않습니다.

설정 누락은 사용자가 할 수 있는 일이 없는 서버 문제인데도 조용합니다. 응답 계약을 바꾸지 않고
전송만 얹을 수 있는지 따로 봅니다.

## 17. Stage A degrade 경로가 부분 실패를 200으로 돌려줌

`api/candidates/stage-a`가 모델 복구 호출에 실패하면 이미 받은 부분 응답을 살려 200으로 돌려줍니다
(`route.ts`의 `degrade`). 사용자에게는 맞는 동작이지만 실패 사실이 어디에도 남지 않습니다.

## 18. `src/app/error.tsx`가 없음

이슈 #136이 `global-error.tsx`만 추가했습니다. 그래서 렌더 오류가 나면 헤더와 사이드바까지 포함한
화면 전체가 오류 화면으로 바뀝니다. 세그먼트 단위로 오류를 가두려면 `error.tsx`가 필요한데, 화면
동작이 바뀌는 일이라 이슈 #136 범위에 넣지 않았습니다.

## 19. jsdom 화면 테스트 여럿이 전체 실행에서 간헐적으로 실패함

2026-09-16에 이슈 #136 브랜치에서 전체 테스트를 아홉 번 돌리다 두 번 관측했습니다. 회차마다 깨지는
테스트가 다릅니다.

- `src/features/repository-selection/repository-flow.test.tsx`의 "최신 내용 불러오기를 취소하면 다시 읽지 않고 인터뷰에 남는다"
- `src/features/saved-interviews/saved-interview-screen.test.tsx`의 "고친 블록에는 예전 충돌을 남기지 않는다"
- "Repository가 없으면 NO REPOSITORIES 상태를 그리고 목록 카드를 그리지 않는다"
- "저장되지 않은 답변이 있으면 확인을 먼저 받는다"

첫 번째의 증상은 이렇습니다.

```
TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "인터뷰 계속하기"
```

**이 브랜치의 원인이 아닙니다.** 해당 파일들의 diff가 비어 있어 테스트와 대상 코드가 그대로입니다.
이 브랜치가 건드린 서버 모듈을 import하는 화면 코드도 없습니다. 파일 단독으로 여덟 번, 여섯 번씩
돌렸을 때는 각각 한 번, 0번 실패해 전체 실행의 부하에서만 드러납니다.

자체 리뷰로 코드를 줄인 뒤에 전체 스위트가 오히려 빨라진 것도 확인했습니다(import 합계 206~245초에서
151~194초). 이 브랜치가 부하를 늘려 생긴 것이 아닙니다.

증상이 위 12번과 같습니다. 뒤 렌더에서 나타나는 요소를 동기 조회(`getByRole`, `getByText`)로 잡는
단정이었습니다.

**2026-09-16에 이슈 #136 브랜치에서 닫았습니다.** 범위 밖 파일이지만 이 PR의 CI를 빨갛게 만들
가능성이 커서 함께 고쳤습니다. 원인은 셋이었고 자리마다 달랐습니다.

- `repository-select-screen.test.tsx`: Loading과 Empty가 `role="status"`를 함께 씁니다. 먼저 잡히는
  것이 Loading이라 상태 종류를 `waitFor`로 기다리게 바꿨습니다.
- `repository-flow.test.tsx`: 확인 다이얼로그가 클릭 다음 렌더에서 나타나는데 동기로 잡고 있었습니다.
  `findByRole`로 바꿨습니다.
- `saved-interview-screen.test.tsx`: 고친 문장 표시와 충돌 표시 제거가 같은 렌더에서 일어나지
  않습니다. 두 단정을 한 `waitFor` 안으로 합쳤습니다.

전체 스위트를 여섯 번 연속으로 돌려 전부 통과하는 것을 확인했습니다.

### 2026-09-22에 같은 자리가 다시 깨졌고 원인이 달랐습니다

이슈 #142 브랜치에 develop을 머지한 뒤 `repository-flow.test.tsx`의 "인터뷰 중 이탈" 테스트 셋이
네 번에 한 번 꼴로 깨졌습니다. 증상은 위와 같은 "확인 대화를 찾지 못함"입니다.

**2026-09-16의 판정이 반쪽이었습니다.** 그때는 "대화가 클릭 다음 렌더에 나타난다"고 보고
`findByRole`로 바꿨는데, 실제 원인은 대화가 **아예 뜨지 않는 것**이었습니다. 실패한 실행의 화면
덤프에 확인 대화 대신 선택 화면의 LOADING 상태가 찍혀 있었습니다. 확인 없이 그대로 넘어간 것입니다.

이탈 확인이 뜰지는 흐름이 들고 있는 `hasUnsavedRef`로 갈리고(`repository-flow.tsx`), 그 ref를
채우는 것은 저장 실패 알림을 그린 커밋 **다음에** 도는 effect입니다(`interview-screen.tsx`의
`onUnsavedChange`). 테스트는 알림만 기다리고 눌렀으므로 effect가 아직 돌지 않은 실행에서는 ref가
비어 있었습니다. 대화가 뜨지 않으므로 누른 뒤에 `findByRole`로 기다려도 살아나지 않습니다.

누르기 **전에** 밀린 effect를 흘려보내는 `waitForUnsavedTurn()` 헬퍼를 두고 세 테스트가 함께 쓰게
했습니다. 전체 스위트를 여덟 번 연속으로 돌려 전부 통과했습니다.

이슈 #142의 화면 변경이 이 창을 넓혔습니다. Repository 선택 화면이 마운트마다 오늘 쓴 분석 횟수를
읽으면서 대기 중인 promise가 하나 늘었고, 그만큼 effect가 밀리는 실행이 잦아졌습니다. 원인은 아니고
드러나게 한 쪽입니다.

## 20. provider 오류 메시지의 내용은 통제 밖임

PR #138 리뷰 1라운드에서 오류 메시지에 실려 가는 내용을 점검하다 남은 항목입니다.

LLM 호출이 실패하면 `mapInterviewLlmError`가 provider 오류를 `cause`로 달아 올립니다. Sentry는
`cause.message`를 싣습니다(`wiki/2026-09-16-sentry-서버-계측.md` 5절 실측). provider가 자기 메시지에
무엇을 담는지는 우리가 정하지 않으므로, 입력의 일부를 되돌려 주는 provider가 있으면 그 조각이 실릴 수
있습니다.

비표준 속성은 실리지 않는 것을 확인했으므로 프롬프트가 통째로 나가는 경로는 아닙니다. 실사용
이벤트를 보고 실제로 무엇이 오는지 확인한 뒤에 `beforeSend`로 거를지 판단합니다. 지금 추측으로
거르면 원인 파악에 필요한 문구까지 지웁니다.

## 21. Stage A `unknown_sha` 메시지에 모델이 돌려준 식별자가 실림

`stage-a.ts`가 `입력 집합에 없는 식별자가 포함되어 있습니다: ${unknownIds.join(", ")}`로 오류를
만들고, 이 오류는 502라 Sentry로 갑니다.

**이번에 고치지 않았습니다.** 20번과 함께 점검했고, 실리는 값이 사용자 답변 본문이 아니라 모델이
지어낸 커밋 식별자입니다. 그 식별자가 이 오류를 재현할 유일한 단서이므로 지우면 Issue가 쓸모를
잃습니다. 비공개 저장소의 커밋 식별자를 외부 수집처에 두는 것 자체를 문제로 볼지는 별도 판단이
필요해 여기 남깁니다.

## 22. preview 배포도 Release를 만들고 소스맵을 올림

이슈 #144가 Source Map 업로드를 켠 뒤로 preview 배포마다 Release가 하나씩 생기고 맵이 올라갑니다.
Sentry 할당량을 preview가 먹는 구조입니다.

실사용 배포 빈도와 할당량 소모를 아직 재지 않았습니다. 이슈 #144의 작업 원칙이 추측성 조정을
금지하므로 양을 보고 나서 preview만 끌지 판단합니다. 끄는 방법은 Vercel에서
`SENTRY_AUTH_TOKEN`을 Production 범위로만 두는 것입니다.

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

정리 대상은 `src/lib/github/oauth.ts`의 세 개와 `src/features/experience-candidates/llm-provider.ts`의
여러 개입니다. 이름과 기본값과 필수 여부를 함께 적어야 하므로 별도 작업으로 다룹니다.

## 7. 빌드마다 남는 auth token 경고

프로덕션 빌드가 `[@sentry/nextjs - After Production Compile] Warning: No auth token provided.`를
남깁니다. `release: { create: false }`를 넣어도 이 경고는 막히지 않습니다. `createRelease()` 안에서
auth token 검사가 `create` 값보다 먼저 반환하기 때문입니다.

이 옵션이 아무 일도 하지 않는다고 판단해 한동안 빼 두었던 것을 2026-09-08에 정정했습니다. 옵션은
release 이름 해소를 막습니다. 경위는 `raw/2026-09-08-sentry-release-주입-정정-session-log.md`에
있습니다.

Releases와 Source Map 업로드 후속 작업에서 auth token을 넣으면 경고가 사라집니다. 그때까지 남겨
둡니다.

## 8. 측정 스크립트에 vitest 회귀 테스트가 없음

`scripts/measure-sentry-web-vitals.mts`에 vitest 테스트를 넣지 못했습니다. `AGENTS.md`는 결함마다
회귀 테스트를 요구하고, 넣을 수 없으면 그 사실과 이유를 여기에 남기라고 정하고 있습니다.

이 프로젝트는 측정 스크립트를 vitest 스위트에 넣지 않는다는 방침이 있고
`src/features/interview/measurement/`의 `.measure.mts` 세 개에도 테스트가 없습니다. 스크립트가
최상위에서 인자를 읽고 실행 자체가 부수 효과라 함수 하나만 떼어 부를 수 없습니다.

대신 스크립트 자신이 기대와 다를 때 종료 코드 1을 내도록 만들었습니다. `on` 모드와 `off` 모드,
그리고 커밋 SHA가 release로 인라인되지 않았는지의 검사가 각각 실제로 실패하는 것을 확인했습니다.
DSN 판정과 예외 격리와 실험 옵션 배선은 `src/lib/sentry/client.test.ts`가 SDK를 mock해 고정합니다.

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

## 13. 기존 측정 스크립트도 Chromium을 성공 경로에서만 닫음

`src/features/interview/measurement/streaming-render-cost.measure.mts`가 201행에서 Chromium을 띄우고
308행에서 닫으며 `finally`가 없습니다. 이번 PR에서 고친 것과 같은 근본 원인입니다. 중간에서 던지면
브라우저가 살아남아 Node가 종료하지 않습니다.

이 PR에서 고치지 않았습니다. 이번 변경이 건드리지 않은 파일이고 Issue #81 범위 밖입니다. 스트리밍
렌더링 측정 작업에서 함께 고칩니다.

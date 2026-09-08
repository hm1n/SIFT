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
남깁니다. `release: { create: false }`로 막히지 않는 것을 확인했습니다. 이유는
`wiki/2026-09-08-sentry-클라이언트-계측.md`에 있습니다.

Releases와 Source Map 업로드 후속 작업에서 auth token을 넣으면 사라집니다. 그때까지 남겨 둡니다.

## 8. 측정 스크립트에 회귀 테스트가 없음

`scripts/measure-sentry-web-vitals.mts`에 테스트를 넣지 못했습니다. `AGENTS.md`는 결함마다 회귀
테스트를 요구하고, 넣을 수 없으면 그 사실과 이유를 여기에 남기라고 정하고 있습니다.

이 프로젝트는 측정 스크립트를 vitest 스위트에 넣지 않는다는 방침이 있고
`src/features/interview/measurement/`의 `.measure.mts` 세 개에도 테스트가 없습니다. 스크립트가
최상위에서 인자를 읽고 실행 자체가 부수 효과라 함수 하나만 떼어 부를 수 없습니다.

DSN 판정만은 순수 함수로 떼어 `src/lib/sentry/client-options.test.ts`에 회귀 테스트를 넣었습니다.
테스트가 없는 부분은 브라우저를 실제로 띄워야 하는 확인 절차입니다.

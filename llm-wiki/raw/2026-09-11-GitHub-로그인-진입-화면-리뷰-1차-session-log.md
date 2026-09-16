# GitHub 로그인 진입 화면 PR 리뷰 1차 반영 세션 로그

2026-09-11 PR #100의 Codex 1차 리뷰를 반영한 기록입니다. `raw/2026-09-10-GitHub-로그인-진입-화면-구현-session-log.md`를 이어받습니다. 결론은 `wiki/2026-09-10-GitHub-로그인-진입-화면.md` 2절에 있습니다.

## 1. 지적

라운드 1회, 지적 1건입니다. 도구 등급 P1이고 프로젝트 기준으로는 P2로 판정했습니다. 잘못된 결과가 전달되거나 데이터가 손실되는 문제가 아니라 느린 응답에서 로딩 표시가 빠지는 UX 결함입니다. 다만 수정 비용이 작고 AGENTS.md 작업 원칙 "Loading, Empty, Error 상태는 모든 핵심 흐름에서 항상 함께 구현해야 합니다"를 직접 위반하므로 예외 둘이 모두 해당해 이번 PR에서 반영했습니다.

지적된 줄은 `login-screen.tsx`의 로그인 버튼입니다. layout이 그리는 헤더의 `Log in with GitHub`가 같은 `LOGIN_PATH`로 바로 이동해 AUTHENTICATING을 거치지 않았습니다. 헤더 진입점 회귀 테스트도 요구했습니다.

## 2. 묶음과 함께 고친 결함

근본 원인은 인증 중 플래그가 `LoginScreen`의 로컬 `useState`라서 layout이 그리는 헤더가 닿을 수 없다는 것입니다. 진입점은 디자인 의도대로 둘인데 로딩 상태는 한쪽에만 붙어 있었습니다.

같은 흐름을 다시 읽어 지적되지 않은 같은 성격의 결함 셋을 함께 고쳤습니다.

- ERROR / AUTH 화면에서 헤더 로그인을 눌러도 로딩이 없었습니다. `LoginScreen`이 `authError`를 먼저 판정하므로 상태를 공유해도 순서를 바꾸지 않으면 오류 화면에 머무릅니다. 인증 중 판정을 앞에 두었습니다.
- 헤더 링크에 수정키와 가운데 버튼 가드가 없었습니다. 상태를 공유하면 새 탭으로 여는 클릭이 현재 탭을 인증 중으로 바꿉니다. 로그인 화면 버튼과 같은 가드를 적용했습니다.
- bfcache 복원 되돌림이 헤더 진입에도 적용되어야 합니다. `pageshow` 리스너를 provider로 올렸습니다.

## 3. 재설계

- `src/components/shell/auth-transition.tsx`를 새로 만들었습니다. `AuthTransitionProvider`가 인증 중 플래그와 `pageshow` 되돌림을 들고, `useAuthTransition()`은 provider 밖에서 부르면 예외를 던집니다. 로그인 화면이 provider 밖에 놓여 로딩이 조용히 사라지는 것을 막기 위해서입니다.
- `LoginLink`가 두 진입점의 공용 링크입니다. 이동은 `<a href>`에 맡기고 클릭에서는 공용 플래그만 세웁니다. 인증 중에는 문구가 `Connecting to GitHub…`로 바뀌고 `aria-busy`가 붙어 로그인 화면이 없는 자리에서도 상태가 보입니다.
- `layout.tsx`가 헤더와 `children`을 provider로 함께 감쌉니다. `TopHeader`와 `LoginScreen`은 `LoginLink`를 씁니다.
- 파일 위치는 `components/shell/`입니다. 헤더가 쓰는 조각이라 셸 컴포넌트가 feature 폴더를 import하는 방향을 피했습니다.

## 4. 회귀 테스트

- `top-header.test.tsx`: 헤더 로그인 클릭 시 인증 중 표시(`aria-busy`, 문구)로 바뀌고, 수정키와 가운데 버튼 클릭 4종은 바뀌지 않습니다.
- `login-screen.test.tsx`: 헤더 로그인으로 시작한 인증이 AUTHENTICATING을 그립니다. ERROR / AUTH 화면에서 헤더 로그인을 눌러도 AUTHENTICATING으로 바뀝니다. bfcache 복원은 두 진입점 모두 되돌립니다.
- `auth-transition.test.tsx`: provider 밖의 `LoginLink`는 예외를 던집니다.
- `page.test.tsx`는 provider로 감싸도록 조정했습니다.
- 테스트 958개, lint, typecheck 통과.

## 5. 실제 동작 확인

이 디렉터리에 다른 dev 서버가 3000번 포트로 이미 떠 있어 그 서버를 썼습니다. Playwright headless Chromium에서 로그인 라우트 응답을 2.5초 늦춘 뒤 헤더 링크를 눌렀습니다. 로그인 화면과 ERROR / AUTH 화면 모두에서 이전 문서가 AUTHENTICATING으로 바뀌고 헤더 링크가 `Connecting to GitHub…`에 `aria-busy="true"`가 되어 `pagehide`까지 유지되었습니다. 이동 중 DOM은 앞 로그와 같이 클릭 전에 심은 `MutationObserver`의 `localStorage` 기록으로 읽었습니다.

## 6. 결과

묶음 1개, 커밋 1개입니다. 재검증은 `@codex review`로 걸었고 결과는 다음 로그에 적습니다.

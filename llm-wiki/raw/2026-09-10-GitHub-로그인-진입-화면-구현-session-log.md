# GitHub 로그인 진입 화면 구현 세션 로그

2026-09-10에 `hm1n/html-css-design-github` 브랜치에서 이슈 #94를 구현한 세션입니다. `raw/2026-09-10-디자인-토큰과-공통-셸-리뷰-1차-session-log.md`의 세션 상태 설계를 이어받았습니다. 결론은 `wiki/2026-09-10-GitHub-로그인-진입-화면.md`에 있습니다.

## 1. 착수 전 확인

- PR #99는 11:02에 develop으로 머지되어 있었고 이 브랜치는 머지 커밋 위에서 시작했습니다. 새로 분기하지 않았습니다.
- 디자인 원본 `App.tsx`와 `src/imports/pasted_text/` 문서 5개는 모두 16:35 판 그대로였습니다. 이슈가 근거로 든 `product-flow-update.md`는 저장소가 아니라 이 폴더에 있었습니다.
- 한국어 로그인 안내 문구 6종을 `llm-wiki` 전체에서 검색했고 인용하는 위키는 없었습니다. 노션 기능 정의서는 이 세션에서 확인하지 않았습니다.
- 새 워크트리의 `node_modules`에 `vitest` 바이너리가 없어 `rm -rf node_modules && npm ci`로 다시 설치했습니다. 핸드오프가 적어 둔 함정과 같습니다.

## 2. 사용자에게 제안하고 승인받은 결정

- **로딩 표시.** 디자인의 `AuthDots`(░░░에서 █이 차오르는 380ms 애니메이션)를 만들지 않고 `StatusScreen` kind `loading`의 ● 점멸만 씁니다. 근거 문서 5절이 "과도한 loading animation 대신 작은 system status"를 요구하고, 상태 셋을 컴포넌트 하나로 그리는 #93 결정과 맞습니다.
- **Try again.** 디자인대로 로그인 화면으로 돌아갑니다. `router.replace("/")`로 `auth_error` 쿼리를 지워 서버가 오류 없는 화면을 다시 그립니다. GitHub으로 바로 재이동하게 하려면 `StatusScreen`의 `action`에 href 변형을 더해야 해서 #93 계약이 바뀌므로 택하지 않았습니다.
- **헤더 사용자명(backlog 8번).** #94 Constraint "OAuth 라우트와 세션 쿠키 계약을 바꾸지 않습니다" 때문에 쿠키에 사용자 정보를 넣을 수 없습니다. 남는 방법은 layout에서 매 요청 GitHub `/user`를 조회하는 것인데 모든 페이지에 왕복 한 번이 붙습니다. #94에서 넣지 않고 Repository 목록 API를 만드는 #95에서 같은 요청에 묶을 수 있는지 판단하기로 했습니다. Pretendard(7번)는 로그인 화면이 전부 영어라 판단 근거가 생기지 않아 #95에 그대로 둡니다.

## 3. 구현 경위

- `src/features/auth/login-screen.tsx`를 새로 만들었습니다. 디자인 `LoginScreen`의 80px dashed 상자와 `SiftMark` 40, 제목 두 줄, 설명 두 줄, primary `ButtonLink`, mono 10px 약관 문구입니다. 버튼 크기는 `Button`에 size를 되살리지 않고 `login-screen.module.css`의 `.card .login`으로 덮었습니다. #93 리뷰에서 미사용 size 변형을 지운 이력이 있어 실제로 쓰는 자리 하나에만 두는 쪽을 택했습니다.
- AUTHENTICATING은 `<a href={LOGIN_PATH}>`의 onClick에서 로컬 플래그만 세우고 이동은 브라우저에 맡깁니다. 내부 경로에 `window.location.assign`을 쓰는 것은 lint `no-location-assign-relative-destination`이 막습니다. 수정키나 가운데 버튼 클릭은 새 탭으로 열려 이 화면이 남으므로 플래그를 세우지 않습니다. 뒤로 가기로 bfcache에서 복원되면 플래그가 남아 인증 중에 멈춘 화면이 되므로 `pageshow`의 `persisted`에서 되돌립니다. effect 안에서 직접 setState하지 않고 리스너 콜백에서만 하므로 `react-hooks/set-state-in-effect`에 걸리지 않았습니다.
- ERROR / AUTH는 `StatusScreen` kind `error`로 그립니다. label은 디자인의 "Unable to connect to GitHub."로 고정하고 종류별 영어 안내를 sub에 넣어 Constraint "종류를 합쳐 한 문구로 만들지 않습니다"를 지켰습니다. `Object.hasOwn` 조회와 프로토타입 키 회귀 테스트는 그대로 옮겼습니다.
- `page.tsx`가 세션 쿠키 유무로 `LoginScreen`과 `RepositoryAnalysisView`를 가릅니다. 세션이 있으면 `auth_error` 쿼리를 무시합니다. `RepositoryAnalysisView`에서 로그인 카드와 `authError` prop과 `AUTH_ERROR_COPY`를 지웠고, `hasSession` prop과 로그아웃 시 상태 초기화 구조는 PR #99 리뷰 결정대로 그대로 두었습니다.
- `LOGIN_PATH`가 `top-header.tsx`와 `repository-analysis-view.tsx`에, 세션 삭제 경로가 `account-menu.tsx`의 `SESSION_PATH`와 뷰 안의 문자열로 각각 두 번 있었습니다. `src/lib/github/auth-paths.ts` 한 곳으로 모았습니다. 보고에서는 `src/features/auth` 아래를 말했지만 셸 컴포넌트가 feature 폴더를 import하는 방향이 되어 `lib/github`에 두었습니다.
- 테스트는 뷰 테스트의 로그인 관련 4묶음을 `login-screen.test.tsx`로 옮기고 AUTHENTICATING 전환, 수정키 클릭 4종, bfcache 복원 2종, Try again을 더했습니다. 세션 유무에 따른 화면 분기는 `next/headers`의 `cookies`를 mock해 `page.tsx`를 직접 렌더하는 `src/app/page.test.tsx`로 옮겼습니다. 뷰 테스트에 남은 로그아웃 3건은 로그인 링크 대신 폼과 결과가 사라지는지를 확인하도록 바꿨습니다.
- 테스트 949개, lint, typecheck 통과.

## 4. 실제 동작 확인

- dev 서버에 curl로 여섯 상태를 요청했습니다. 쿠키 없음, `auth_error` 4종 중 하나, `auth_error` 두 번, `auth_error=__proto__`, 쿠키 있음, 쿠키 있음과 `auth_error` 동시입니다. 각각 로그인 화면, ERROR / AUTH와 종류별 문구, 첫 값 적용, 로그인 화면, 분석 폼, 분석 폼이 나왔습니다.
- Playwright headless Chromium으로 클릭 흐름을 봤습니다. 로그인 라우트 응답을 3초 늦춘 뒤 클릭하니 클릭 2밀리초 뒤 이전 문서에 AUTHENTICATING이 그려지고 `pagehide`까지 유지되었습니다. Try again은 URL을 `/`로 바꾸고 로그인 화면을 다시 그렸습니다.
- 측정 함정 하나를 기록합니다. 이동이 진행 중인 동안 Playwright의 `evaluate`는 컨텍스트 파기 오류를 내고, CDP `Runtime.evaluate`와 `DOM.getDocument`는 `readyState`가 `loading`인 새 문서를 겨냥해 상태 영역을 찾지 못했습니다. 처음에는 상태가 바뀌지 않는 것으로 보였지만, 클릭 전에 `MutationObserver`를 심어 `localStorage`에 남긴 기록으로 이전 문서 안에서 렌더된 것을 확인했습니다. 이동 중 DOM은 이 방법으로 봐야 합니다.
- 1280px과 390px 폭에서 로그인 화면, AUTHENTICATING, ERROR / AUTH 스크린샷을 확인했습니다. 헤더의 `Log in with GitHub`와 화면의 `Continue with GitHub`가 디자인대로 함께 보입니다.

## 5. 결과

- 이슈 #94의 Tasks 다섯 개를 모두 구현했습니다. 위키 `wiki/2026-09-10-GitHub-로그인-진입-화면.md`를 새로 넣고 `wiki/2026-09-10-디자인-토큰과-공통-셸.md` 2·3·5절, `wiki/2026-09-10-디자인-개편-후속-backlog.md` 8번, `wiki/2026-09-10-디자인-개편-계획.md`의 #93 범위 결정 항목을 갱신했습니다.
- 남은 것은 `wiki/2026-09-10-GitHub-로그인-진입-화면.md` 확인 필요 절에 있습니다.

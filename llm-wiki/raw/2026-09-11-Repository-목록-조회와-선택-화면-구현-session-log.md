# Repository 목록 조회와 선택 화면 구현 세션 로그

2026-09-11에 `hm1n/feature-design-repository` 브랜치에서 이슈 #95를 구현한 세션입니다. `raw/2026-09-11-GitHub-로그인-진입-화면-리뷰-1차-session-log.md`의 핸드오프를 이어받았습니다. 결론은 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md`에 있습니다.

## 1. 착수 전 확인

- PR #100은 01:48에 develop으로 머지되어 있었고 이 워크트리는 머지 커밋 위의 새 브랜치였습니다. `node_modules`에 vitest와 next 바이너리가 있어 재설치하지 않았습니다.
- 디자인 원본 `App.tsx`와 `src/imports/pasted_text/` 문서 5개는 모두 2026-09-10 16:35 판 그대로였습니다.
- 이슈 #95 본문의 Non-goal "기여 항목 입력 위치 확인 필요"와 Task "textarea를 임시 위치에 유지"가 이미 확정된 결정과 어긋나 있어, 사용자 승인 뒤 `gh issue edit`으로 두 줄을 확정 위치로 고쳤습니다.
- `llm-wiki/log.md`의 PR #100 1차 반영 행이 "재검증 결과는 다음 행에 적습니다"로 끝나 있어 재검증 결과 행을 첫 커밋으로 넣었습니다.

## 2. 사용자에게 제안하고 승인받은 결정

- **기여 항목 분리 규칙.** 줄바꿈 분리를 유지하고 placeholder는 디자인 문장을 그대로 씁니다. 쉼표·마침표 분리는 "TypeScript 전환 작업을 주로 담당했습니다" 같은 어색한 조각을 만들어 접었고, Stage A 대조 로직 변경은 #95 범위를 넘어 후속으로 두었습니다.
- **rate limit이 아닌 403.** 새 오류 종류를 만들지 않고 `auth_revoked`로 둡니다. 복구가 다시 로그인이라 화면 동작이 같고, 종류를 늘리면 오류 계약 파일 셋과 위키가 함께 바뀌기 때문입니다.
- **404.** `/user/repos`의 404는 `fetchAuthenticatedUserLogin` 선례대로 `server_error`입니다.
- **헤더 사용자명(backlog 8번).** 넣지 않습니다. 목록은 클라이언트가 렌더 뒤에 가져오고 `TopHeader`는 layout 서버 컴포넌트가 그리므로 목록 응답에 `/user`를 실어도 헤더에 닿지 않습니다.
- **분석 뷰 정리 범위.** owner·repo 폼과 textarea를 떼고 `hasSession` prop과 세션 초기화 코드도 지웁니다. 결과 영역의 보라색 스타일은 #96에 남깁니다.
- 사용자는 추천안대로 진행하되 계획에 없던 기능이나 UI는 구현 후 보고하라고 했습니다. 그 목록은 5절에 있습니다.

## 3. 구현 경위

- `src/lib/github/repositories.ts`의 `fetchUserRepositories`를 새로 만들었습니다. `commits.ts`의 `githubFetch`, `classifyErrorResponse`, `parseJson`, `parseNextLink`를 import했고 `GITHUB_API_BASE`도 같은 곳에서 가져옵니다. page 번호 커서의 중복은 `id` Set으로 걸러내고, 도중 실패는 모은 것을 버리고 전체 오류로 냅니다. 테스트 17건이 한 번에 통과했습니다.
- `src/app/api/github/repositories/route.ts`는 GET 하나이고 `getGitHubTokenFromRequest`와 `errorResponse`만 씁니다. 라우트 테스트는 기존 `routes.test.ts`에 합치지 않고 별도 파일로 두었습니다. 기존 파일의 헬퍼가 POST 본문 전제라 GET에 맞지 않았습니다.
- 선택 화면은 `src/features/repository-selection/`에 두었습니다. 처음 테스트 실행에서 `TypeScript · PRIVATE` 확인이 실패했는데, 구분점을 flex gap으로만 띄워 textContent가 `TypeScript·PRIVATE`로 붙어 있었습니다. 구분점을 ` · ` 텍스트로 바꾸고 `white-space: pre-wrap`으로 두어 스크린리더도 같은 문장을 읽게 했습니다.
- 목록 조회 effect 안에서 `setList({ status: "loading" })`을 부르던 것을 Try again 클릭 핸들러로 옮겼습니다. `react-hooks/set-state-in-effect` lint를 피하기 위한 사전 조치이고 동작은 같습니다.
- `RepositoryAnalysisView`는 `repository`, `contributionItems`, `onSelectRepository` prop을 받아 마운트 effect에서 분석을 시작합니다. StrictMode가 effect를 두 번 실행하므로 `startedRef`로 한 번만 시작합니다. effect cleanup에서 실행 번호를 올리는 안은 StrictMode의 가짜 언마운트에서 첫 실행 결과가 버려져 화면이 멈추므로 쓰지 않았습니다. 늦은 결과는 실제 언마운트 뒤 setState가 무시되는 것과 실행 번호로 걸러집니다.
- `page.tsx`는 세션이 있으면 `RepositoryFlow`를 그립니다. 옛 `page.module.css`의 배치는 `repository-flow.module.css`의 `.analysis`로 옮겼고 삭제는 feat 커밋에 함께 들어갔습니다.
- 뷰 테스트는 파일을 새로 써서 폼 입력과 제출을 prop 렌더로 바꿨습니다. 세션 prop 전환 테스트 4건은 `page.test.tsx`의 분기 테스트와 언마운트 뒤 늦은 결과 무시 테스트로 대체했습니다.
- 커밋은 docs, feat(라우트), feat(화면), refactor(뷰 분리와 흐름 연결), docs 다섯 개입니다.
- 테스트 1016개, lint, typecheck 통과.

## 4. 실제 동작 확인

- 이 워크트리에서 `next dev -p 3100`을 띄웠습니다. 3000번 포트의 다른 dev 서버와 겹치지 않았습니다.
- OAuth 앱 설정이 이 워크트리에 없어 실제 GitHub 목록은 받지 못했습니다. `page.tsx`가 쿠키 값이 아니라 유무만 보므로 Playwright 컨텍스트에 임의 값의 세션 쿠키를 넣고 `/api/github/repositories`를 `page.route`로 대체해 화면 상태를 확인했습니다. 상태 5개(LOADING, 목록, NO REPOSITORIES, ERROR / GITHUB와 Try again, ERROR / AUTH), 검색 2건과 결과 없음, 선택 뒤 하단 바와 Analyze 활성화, textarea 확장(93px → 9줄에서 160px → 2줄에서 93px), Analyze 뒤 분석 화면 진입, "Repository 다시 선택"으로 복귀를 봤습니다. 1280px과 400px 폭 스크린샷을 확인했고 400px에서 가로 스크롤이 없었습니다.
- 측정 함정 하나를 기록합니다. 개발 모드 StrictMode가 목록 조회 effect를 두 번 실행해 첫 조회가 두 번 나갑니다. 호출 횟수로 "첫 번째는 429, 두 번째는 목록"을 흘려보내는 시나리오는 두 번째 호출이 곧바로 목록을 돌려줘 오류 화면이 나오지 않았습니다. 모드 변수를 Try again 클릭 직전에 바꾸는 방식으로 고쳤습니다. Try again 뒤 호출 횟수는 3이었습니다.
- Playwright의 `[role="alert"]`는 Next dev 오버레이 때문에 둘로 잡혀 `section[role="alert"]`로 좁혔습니다. 핸드오프가 적어 둔 함정과 같습니다.
- 계산된 폰트는 eyebrow가 Geist Mono, 제목이 Inter, 한국어 안내와 textarea가 Pretendard Variable이었고 `document.fonts.check`가 true였습니다.

### Pretendard 로드 실측

새 컨텍스트 세 번씩 재고 `requestfinished`의 `timing().responseEnd`를 읽었습니다.

| 방식 | 파일 | 전송량 | 최대 응답 완료 |
| --- | --- | ---: | ---: |
| 현재(`pretendardvariable.css`) | CSS 1개, woff2 1개 | 2,057,688 B | 108~135ms |
| 동적 서브셋(`pretendardvariable-dynamic-subset.css`) | CSS 1개, woff2 7개 | 183,696 B | 59~77ms |

CSS 자체는 두 방식 모두 40~75ms였습니다. 이 네트워크에서는 2MB 전체 파일도 0.15초 안에 끝나 자체 호스팅이 필요하지 않다고 판단했습니다. 대신 동적 서브셋 CSS로 바꾸면 전송량이 91% 줄어드는 것을 확인해 backlog 7번에 적었습니다. `layout.tsx`의 URL 한 줄 변경이지만 #93 폰트 계약 문서를 함께 고쳐야 해 이 PR에는 넣지 않았습니다.

## 5. 계획에 없이 세션이 정한 것

사용자 지시대로 구현 뒤 보고한 항목입니다.

- 목록 정렬은 GitHub `sort=pushed&direction=desc`이고 UPDATED 라벨 기준도 `pushed_at`입니다. `updated_at`은 설정 변경으로도 바뀌어 코드 활동을 나타내지 않습니다.
- page 번호 커서의 중복만 `id`로 걸러냅니다.
- 행은 `role="radiogroup"` 안의 `role="radio"` 버튼이고 검색 입력에 `aria-label="Search repositories"`를 붙였습니다. textarea는 섹션 라벨을 `aria-labelledby`, 한국어 안내를 `aria-describedby`로 연결했습니다.
- 인증 취소는 ERROR / GITHUB 대신 ERROR / AUTH와 `Log in again`(세션 삭제 뒤 `router.refresh()`)입니다. Error sub는 `rate_limit`과 `network`만 별도 문구이고 나머지는 디자인 문구입니다.
- 하단 바는 화면 안쪽 스크롤 대신 `position: sticky`로 아래에 붙습니다. 헤더 높이에 의존하는 고정 높이 계산을 피했습니다.
- 검색으로 선택한 행이 가려져도 선택은 유지됩니다.
- `pushedAt`이 null이면 UPDATED 라벨을 생략하고, 언어가 null이면 언어 라벨을 생략합니다.
- 선택 화면으로 되돌아가면 목록을 다시 조회하고 이전 선택과 기여 입력은 보존하지 않습니다.
- 배열이 아닌 성공 응답은 서버와 클라이언트 모두 `server_error`로 봅니다.

## 6. 결과

- 이슈 #95의 Tasks 일곱 개를 모두 구현했습니다. 위키 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md`를 새로 넣고 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 7·8번과 9~12번, `wiki/2026-09-10-디자인-개편-계획.md`, `wiki/2026-09-10-GitHub-로그인-진입-화면.md` 1·7절, `wiki/2026-09-10-디자인-토큰과-공통-셸.md` 2·3·5절을 갱신했습니다.
- 남은 것은 새 위키의 확인 필요 절과 backlog 9~12번에 있습니다.

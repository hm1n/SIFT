# Repository 목록 조회와 선택 화면

이슈 #95가 만든 Repository 목록 조회 라우트와 선택 화면의 현재 계약입니다. 배경은 `wiki/2026-09-10-디자인-개편-계획.md`에, 구현 경위는 `raw/2026-09-11-Repository-목록-조회와-선택-화면-구현-session-log.md`에 있습니다. 선택 뒤 분석 단계의 Loading, Empty, Error 정책은 `wiki/2026-08-20-repository-조회상태-정책.md`에 그대로 있습니다.

확인 날짜는 2026-09-11입니다.

## 1. 라우트

`GET /api/github/repositories`입니다. 기존 GitHub 라우트 3개와 달리 owner·repo가 없는 GET이라 `readGitHubRouteRequest`를 거치지 않고 `getGitHubTokenFromRequest`로 쿠키의 토큰만 읽습니다. 조회 함수는 `src/lib/github/repositories.ts`의 `fetchUserRepositories`이고, `githubFetch`, `classifyErrorResponse`, `parseJson`, `parseNextLink`를 `commits.ts`에서 그대로 씁니다.

GitHub `GET /user/repos?per_page=100&sort=pushed&direction=desc`를 `Link` 헤더의 `rel="next"`가 없을 때까지 따라가 한 응답에 전부 모아 돌려줍니다. 응답은 `{ repositories: RepositorySummary[] }`이고 항목은 다음과 같습니다.

| 필드 | 값 | 출처 |
| --- | --- | --- |
| `id` | GitHub Repository id | `id` |
| `owner` | 소유자 login | `owner.login` |
| `name` | Repository 이름 | `name` |
| `visibility` | `public` 또는 `private` | `private` |
| `language` | 주 언어, 없으면 null | `language` |
| `pushedAt` | 마지막 push 시각 ISO 8601, 없으면 null | `pushed_at` |

필드 이름은 `AppShell`의 `ShellRepository`(`owner`, `name`, `visibility`, `language`)와 맞춰 #96이 그대로 넘길 수 있게 했습니다. 타입은 `src/lib/github/types.ts`의 `RepositorySummary`입니다.

### 오류 분류

오류 봉투와 HTTP status는 `wiki/2026-08-21-GitHub-route-handler-오류계약.md`의 `errorResponse`를 그대로 씁니다. 이 라우트만의 판정은 둘입니다.

- `/user/repos`의 404는 Repository 없음이 아니라 엔드포인트 문제이므로 `repo_not_found`가 아니라 `server_error`입니다. `fetchAuthenticatedUserLogin`이 `/user`의 404를 다루는 방식과 같습니다.
- rate limit이 아닌 403(scope 부족, 조직 SSO 강제)은 새 종류를 만들지 않고 `auth_revoked`입니다. 복구가 다시 로그인이라 화면 동작이 같고, 종류를 늘리면 `errors.ts`, `api-contract.ts`, `repository-analysis.ts`, 위키가 함께 바뀌기 때문입니다. 이슈 Approach의 "권한 오류"는 이 해석으로 반영했습니다.

나머지는 `classifyErrorResponse`대로입니다. 401은 `auth_revoked`, 429와 `x-ratelimit-remaining: 0`인 403과 `Retry-After` 헤더나 secondary rate limit 문구가 있는 403은 `rate_limit`, 422는 `server_error`, fetch 실패와 성공 응답의 JSON 파싱 실패는 `network`입니다. 배열이 아닌 성공 응답은 `server_error`입니다.

### 페이지네이션의 한계

`/user/repos`의 커서는 `Link` 헤더의 page 번호라서 조회 도중 목록이 바뀌면 경계에서 항목이 중복되거나 빠질 수 있습니다. 커밋 조회처럼 고정할 SHA가 없어 피할 수 없습니다. 중복은 `id`로 걸러내고 누락은 남습니다. 도중에 실패하면 모은 것을 버리고 전체를 오류로 냅니다. 부분 목록은 특정 Repository가 없는 것처럼 보이게 하므로 `partial_failure`로 이어 쓰지 않습니다.

## 2. 선택 화면

`src/features/repository-selection/`입니다. 디자인 파일 `App.tsx`의 `RepoSelectScreen`을 옮겼고 색과 라운드와 폰트는 `globals.css` 토큰만 씁니다.

| 파일 | 역할 |
| --- | --- |
| `repository-select-screen.tsx` | 화면. 목록 조회, 검색, 선택, 기여 항목 입력, Analyze |
| `repository-client.ts` | 라우트 호출. `apiFetch`로 오류 봉투를 `GitHubFetchError`로 복원합니다 |
| `contribution-items.ts` | `parseContributionItems`. 뷰에서 옮겼고 규칙은 그대로 줄바꿈입니다 |
| `updated-label.ts` | `UPDATED nD AGO` / `UPDATED TODAY` 라벨. 기준은 `pushedAt`입니다 |
| `repository-flow.tsx` | 선택 화면과 분석 화면의 전환 |

### 상태

| 상태 | 조건 | 그리는 것 |
| --- | --- | --- |
| Loading | 마운트 직후와 Try again 직후 | `StatusScreen` kind `loading`, code `Loading Repositories`, label "Fetching repositories from GitHub..." |
| Empty | 응답 배열이 빔 | `StatusScreen` kind `empty`, code `No Repositories`, label "No repositories available for analysis.", sub "Make sure your GitHub account has at least one repository." 동작 버튼은 없습니다 |
| Error | `auth_revoked` 외의 실패 | `StatusScreen` kind `error`, code `ERROR / GITHUB`, label "Unable to load repositories.", sub는 종류별 문구, action `Try again`이 다시 조회합니다 |
| Auth error | `auth_revoked` | `StatusScreen` kind `error`, code `ERROR / AUTH`, label "Unable to connect to GitHub.", action `Log in again`이 세션 삭제 뒤 `router.refresh()`로 로그인 화면으로 보냅니다 |
| 검색 결과 없음 | 목록은 있는데 필터 결과가 빔 | 카드 안 "No repositories match your search." 화면 나머지는 유지됩니다 |

Error의 sub는 `rate_limit`이 "GitHub rate limit reached. Wait a moment and try again.", `network`가 "We couldn't reach the server. Check your connection and try again.", 그 외가 디자인의 "GitHub returned an error."입니다. 인증 취소를 ERROR / GITHUB에 넣지 않은 것은 Try again으로 풀리지 않기 때문이고, 형식은 로그인 화면의 ERROR / AUTH와 같습니다. 세 상태는 디자인 `App.tsx` 1393~1395행처럼 `StatusScreen`만 그리고, 사이드바 셸 배치는 #96 이후입니다.

### 목록과 선택

- 헤더는 `SELECT REPOSITORY`와 "Choose a repository to analyze."입니다. 600px 가운데 열에 bordered 카드 하나를 두고 행은 thin divider로 나눕니다. 행을 카드로 만들지 않습니다.
- 카드 헤더는 `REPOSITORIES`와 전체 개수입니다. 개수는 검색과 무관하게 전체입니다.
- 검색은 이미 받은 목록을 `owner`와 `name`에 대해 대소문자 구분 없이 부분 일치로 거릅니다. 서버를 다시 부르지 않습니다.
- 행은 `role="radiogroup"` 안의 `role="radio"` 버튼입니다. 14px 라디오 기호, `owner / name`, mono 소형 라벨로 `language · PRIVATE`, 오른쪽에 `UPDATED nD AGO`입니다. 언어가 null이면 언어를, 공개 Repository면 `PRIVATE`를 생략합니다. `pushedAt`이 null이면 UPDATED 라벨을 생략합니다.
- 선택은 하나입니다. 검색으로 선택한 행이 가려져도 선택은 유지되어 하단 바에 남습니다.
- 하단 바는 `position: sticky`로 아래에 붙고 왼쪽에 `owner / name` 또는 "No repository selected", 오른쪽에 primary `Analyze →`입니다. 선택 전에는 disabled(opacity 0.3)입니다.

### 기여 항목

`contribution-context.md`대로 목록 카드 아래 별도 섹션입니다. 라벨 `YOUR CONTRIBUTION`과 `OPTIONAL`, 한국어 안내 "프로젝트에서 주로 기여한 내용을 알려주세요.", Pretendard textarea입니다. textarea는 3행에서 시작해 내용에 맞춰 160px까지 늘어나고 줄이면 다시 줄어듭니다. placeholder는 디자인의 "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다."입니다.

항목 경계는 `wiki/2026-08-21-기여항목-입력형식.md`의 줄바꿈 규칙을 그대로 둡니다. placeholder처럼 한 문장을 쓰면 항목 하나가 되어 Stage A의 항목별 분류가 거칠어지지만, 이 입력은 검증 근거가 아닌 검색 힌트이므로 힌트 덩어리 하나로 쓰는 것과 어긋나지 않습니다. 쉼표나 마침표로 나누는 안은 어색한 조각을 만들어 채택하지 않았고, 문장을 항목으로 풀어내는 일은 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 9번입니다.

## 3. 분석 화면과의 연결

`page.tsx`는 세션 쿠키가 있으면 `RepositoryFlow`를 그립니다. 흐름은 선택이 없으면 선택 화면, Analyze를 누르면 `{ owner, repo }`와 기여 항목 배열을 `RepositoryAnalysisView`에 넘깁니다. 뷰는 마운트되면 곧바로 `analyzeRepository`를 시작하고 StrictMode의 effect 재실행에도 한 번만 시작합니다. 뷰의 "다른 Repository 선택"과 "Repository 다시 선택"은 `onSelectRepository`로 흐름에 되돌아가 목록을 다시 조회합니다. 이전 선택과 기여 입력은 보존하지 않습니다.

`RepositoryAnalysisView`에서 owner·repo 폼, 기여 textarea, `hasSession` prop과 세션 초기화 코드를 지웠습니다. 세션이 사라지면 `page.tsx`가 흐름을 통째로 내려 상태가 함께 사라지고, 늦게 도착하는 결과는 실행 번호와 언마운트로 걸러집니다. 결과 영역의 보라색 스타일은 그대로이고 재배치는 #96입니다.

## 4. 테스트

- `src/lib/github/repositories.test.ts`: 요약 변환, Link 페이지네이션, id 중복 제거, 빈 배열, 401, 403 세 갈래와 권한 403, 429, 404, 422, fetch 실패, JSON 파싱 실패, 배열 아님, 두 번째 페이지 실패 시 전체 오류.
- `src/app/api/github/repositories/route.test.ts`: 쿠키 없음 401, 정상 응답, 빈 배열, GitHub 응답 8종의 봉투 변환, 연결 실패 502.
- `src/features/repository-selection/`: 클라이언트 4건, 라벨과 파싱 8건, 화면 18건(상태 5개, Try again, 다시 로그인, 목록 표시, 검색, 선택, Analyze 인자, 기여 섹션 위치), 흐름 2건.
- `repository-analysis-view.test.tsx`: 시작 3건을 더하고 폼 입력 기반 테스트를 prop 기반으로 바꿨습니다. `page.test.tsx`는 세션이 있을 때 LOADING REPOSITORIES를 확인합니다.

## 5. 확인한 것

- 테스트 1016개, lint, typecheck 통과.
- 3100번 포트 dev 서버에서 Playwright headless Chromium으로 목록 라우트를 대체해 상태 5개와 검색, 선택, textarea 확장(93px에서 160px 상한까지, 줄이면 93px), Analyze 뒤 분석 화면 진입과 "Repository 다시 선택" 복귀를 확인했습니다. 400px 폭에서 가로 스크롤이 없습니다.
- Pretendard 로드를 재서 자체 호스팅 여부를 판단했습니다. 결과와 결정은 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 7번입니다.

## 6. 확인 필요

- 실제 GitHub 계정으로 목록을 받는 흐름은 OAuth 앱 설정이 이 워크트리에 없어 보지 않았습니다. Vercel 프리뷰에서 확인해야 합니다.
- 조직 Repository는 `affiliation` 기본값(owner, collaborator, organization_member)대로 함께 옵니다. Organization 전환과 필터는 이슈 Non-goal입니다.
- OAuth scope가 `read:user` 하나라 `/user/repos`는 공개 Repository만 돌려줍니다. 화면의 `PRIVATE` 표시와 `visibility` 필드는 scope가 넓어질 때를 위한 자리입니다. 결정은 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 13번입니다.
- 노션 기능 정의서에 owner·repo 직접 입력 방식이 남아 있는지 확인하지 않았습니다.

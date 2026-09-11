# Repository 분석 진행 화면 개편

이슈 #96이 만든 분석 진행 화면의 현재 계약입니다. 배경은 `wiki/2026-09-10-디자인-개편-계획.md`에, 구현 경위는 `raw/2026-09-11-Repository-분석-진행-화면-개편-session-log.md`에 있습니다. Empty·Error 정책의 원본은 `wiki/2026-08-20-repository-조회상태-정책.md`이고, 선택 화면과의 연결은 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md`에 있습니다.

확인 날짜는 2026-09-11입니다. 이 문서가 기록하는 시점에 커밋은 아직 하지 않았습니다.

## 1. Loading 전용 레이아웃

기존에는 `<header>` 하나를 Loading·Empty·Error·Success 네 상태 전부에 무조건 그렸습니다. 디자인 파일을 대조한 결과 `AnalyzingScreen`(자체 헤더·체크리스트·푸터를 가진 독립 레이아웃)과 `StatusScreen`(코드·라벨·sub만 있는 범용 컴포넌트로 헤더가 없음)은 애초에 서로 다른 컴포넌트였습니다. 그래서 공용 헤더를 없애고 `LoadingChecklist`를 Loading 상태 전용으로 새로 만들었습니다.

`LoadingChecklist`는 세 부분입니다.

- 헤더: `ANALYZING REPOSITORY` eyebrow, `{owner} / {name}` 제목, `{PUBLIC|PRIVATE} · {LANGUAGE}` 메타 줄. 메타 형식은 `AppShell`의 `ShellRepository` 표기와 같습니다.
- 체크리스트: `LoadingPhase`의 실제 6단계를 ✓(완료)·●(진행)·○(대기) 기호로 그립니다. 순서는 `route-client.ts`의 `fetchContributionsFromApi`가 실제로 보고하는 순서(commit_details 완료 뒤 repository_metadata)와 같습니다.

  | 순서 | `LoadingPhase` | 라벨 |
  | --- | --- | --- |
  | 1 | `step: "commits"` | Fetching commit history |
  | 2 | `step: "details", phase: "commit_details"` | Fetching commit details (`n / total`) |
  | 3 | `step: "details", phase: "repository_metadata"` | Fetching repository metadata |
  | 4 | `step: "deriving"` | Computing derived metrics |
  | 5 | `step: "stage_a"` | Selecting experience candidates (진행률 없음, ● 기호만) |
  | 6 | `step: "stage_b"` | Finalizing candidates |

  Stage A는 서버가 한 번의 요청으로 판단해 클라이언트가 중간 진행률을 관측할 수 없습니다. 세지 못하는 것을 세는 척하지 않는 기존 결정을 그대로 따라 숫자를 붙이지 않습니다.

- 푸터: `← Change repository` 버튼. `onSelectRepository`로 배선됩니다.

`repository-analysis.ts`의 `LoadingPhase` 자체의 단계 수·순서는 바꾸지 않았습니다. `details` 스텝 하나를 체크리스트 항목 두 개로 가르는 매핑은 화면 쪽(`repository-analysis-view.tsx`)에만 있습니다.

## 2. Empty·Error를 StatusScreen으로

Empty와 Error는 이제 공용 `StatusScreen`(`@/components/shell/status-screen`)으로 그립니다. `code`는 `repository-select-screen.tsx`가 쓰는 관례(`ERROR / GITHUB`, `No Repositories`)를 그대로 따랐습니다.

| 상태 | `code` |
| --- | --- |
| `no_commits` | `No Commits` |
| `no_author_commits` | `No Author Commits` |
| `no_analyzable_commits` | `No Analyzable Commits` |
| `no_stage_a_candidates` | `No Candidates` |
| `no_final_candidates` | `No Final Candidates` |
| `rate_limit` | `ERROR / RATE LIMIT` |
| `auth_revoked` | `ERROR / AUTH` |
| `repo_not_found` | `ERROR / NOT FOUND` |
| `network` | `ERROR / NETWORK` |
| `server_error` | `ERROR / GITHUB` |
| `partial_failure` | `ERROR / PARTIAL` |
| 그 외(후보 생성 오류, 3절 참고) | `ERROR` |

### StageAExclusions 배치

`StageAExclusions`는 `<section>`과 `<details>`로 이루어진 블록 엘리먼트입니다. `StatusScreen`의 `sub`는 `<p>`로 고정돼 있어 그 안에 블록 엘리먼트를 넣으면 브라우저가 `<p>`를 조기에 닫아 하이드레이션 오류로 이어질 수 있습니다.

두 가지 방법을 검토했습니다. `StatusScreen`에 새 슬롯을 추가하는 방법은 로그인 화면(#94)도 참조하는 공용 계약을 바꾸는 일이라 AGENTS.md의 "이름과 계약이 바뀔 때" 절차(문서 갱신 대상 확인)가 함께 필요합니다. `StatusScreen`은 그대로 두고 `<StageAExclusions>`를 형제 엘리먼트로 그리는 방법은 계약을 바꾸지 않고 비용도 가장 작습니다. **사용자가 후자로 결정**했습니다. `EmptyState`는 `<StatusScreen>` 다음에 `stageASelection`이 있을 때만 `<StageAExclusions>`를 형제로 그립니다.

## 3. 번역 범위

이슈 Approach 3은 "기존 문구를 영어로 옮긴다"라고만 짧게 적었지만, 실제 한국어 문구는 `EMPTY_COPY`(5종), `errorCopy()`가 다루는 `GitHubFetchErrorKind` 5종, `toCandidateGenerationError`와 `DIFF_REFETCH_GUIDANCE`(LLM·diff 재조회·Stage A/B 오류 6종 이상)까지 넓게 퍼져 있었습니다. 후자까지 넓히면 이 문구를 한국어로 단언하는 테스트가 3개 파일(`repository-analysis-view.test.tsx`, `experience-candidate-list.test.tsx`, `repository-flow.test.tsx`) 이상이라 PR 크기가 이슈 범위를 넘어섭니다.

**사용자가 이번 이슈 범위만 좁게 가는 것으로 결정**했습니다. 번역한 것과 남긴 것은 다음과 같습니다.

- 영어로 옮김: `EMPTY_COPY` 5종, `errorCopy()`의 GitHub 오류 5종, `toAnalysisError`의 `partial_failure` 분기(이것도 GitHub 조회 시점 오류라 범위 안으로 판단), Empty·Error의 액션 버튼 라벨(재시도·재인증·Repository 다시 선택 계열)
- 한국어로 남김: `toCandidateGenerationError`, `DIFF_REFETCH_GUIDANCE`(LLM 호출·diff 재조회·Stage A/B 판단 실패 계열). 후속 backlog 16번입니다.

액션 버튼 라벨은 오류 종류와 무관하게 전부 영어로 통일했습니다. 그래서 후보 생성 오류처럼 `title`·`message`가 아직 한국어인 상태에서도 버튼만 영어인 혼용 화면이 이번 라운드에는 남습니다. 번역 범위가 backlog 16번으로 닫히면 이 혼용도 함께 없어집니다.

## 4. AppShell 첫 실사용

`AppShell`(`@/components/shell/app-shell`)은 #93이 컴포넌트만 만들고 실제 배치를 미뤄 두었던 컴포넌트입니다. `repository-flow.tsx`가 분석 화면을 `AppShell`로 감싼 것이 이 컴포넌트의 첫 실제 사용입니다. `selection.summary`의 `visibility`·`language`를 `AppShell`과 `RepositoryAnalysisView` 양쪽에 그대로 전달합니다. `RepositoryAnalysisViewProps.repository`는 `RepositoryRef`에서 `RepositorySummary`로 넓혔고, `analyzeRepository`·`ExperienceCandidateList`처럼 `RepositoryRef`만 받는 곳에는 `{owner, repo}`로 좁혀서 넘깁니다.

### 알려진 한계: 중복된 Change repository 버튼

`AppShell` 사이드바의 `← Change repository`와 `LoadingChecklist` 자체 푸터의 `← Change repository`가 Loading 중에는 화면에 동시에, 같은 접근성 이름으로 뜹니다. 디자인 원본의 `AppShell`과 `AnalyzingScreen`도 각자 같은 버튼을 그려 이 중복이 디자인 자체의 특성임을 확인했습니다. 그대로 두었지만 스크린리더 사용자가 같은 이름의 버튼 두 개를 만나는 문제는 남습니다. 후속 backlog 17번입니다.

## 5. CSS 토큰

`repository-analysis.module.css`의 하드코딩 색상(`#5b52d6` 등 7곳)을 `globals.css` 토큰(`--color-*`, `--font-mono`, `--label-*`)으로 옮겼습니다. `repository-flow.module.css`는 쓰던 플레이스홀더 클래스가 `AppShell` 도입으로 필요 없어져 삭제했습니다.

## 6. 테스트와 확인

- `repository-analysis-view.test.tsx`, `repository-analysis.test.ts`, `repository-flow.test.tsx`를 새 구조·영어 문구에 맞춰 갱신했습니다. `experience-candidate-list.test.tsx`, `app-shell.test.tsx`는 변경이 필요하지 않았습니다.
- 테스트 1026개, lint, typecheck 통과를 두 번(구현 에이전트, 그리고 별도로 다시) 확인했습니다.
- 임시 프리뷰 라우트로 Loading 체크리스트·Empty·Error를 `AppShell` 안에서 실제로 렌더해 확인했습니다. 임시 코드는 모두 원복했습니다.

## 7. 확인 필요

- 실제 브라우저에서 사용자 본인이 다시 확인하기로 했습니다(이 문서 작성 시점 기준 진행 중).
- 커밋은 사용자 확인 이후로 미뤘습니다.

## 8. PR #105 Codex 1차 리뷰 반영

PR #105를 올린 뒤 Codex가 P2로 지적했습니다(프로젝트 판정은 P1: 기존 기능 regression). `AppShell` 도입으로 공용 `<header>`·`<main>`이 사라지면서 Loading·Empty·Error·Success 네 상태 전부 시맨틱 랜드마크와 접근 가능한 제목을 잃었습니다. Codex는 루트의 `<main>` 부재와 Empty·Error의 헤딩 부재를 지적했고, 재확인 과정에서 Success 상태가 `<h1>` 없이 곧바로 `<h2>`부터 시작하는 것도 같은 원인임을 확인했습니다.

`StatusScreen`(#94·#95도 참조)과 `ExperienceCandidateList`(#97 담당)는 건드리지 않고 `RepositoryAnalysisView` 안에서만 고쳤습니다. 루트 엘리먼트를 `<main>`으로 바꾸고, Loading이 아닌 상태에는 시각적으로 숨긴 `<h1>{owner} / {name}</h1>`(`.visuallyHidden`)을 추가했습니다. Loading은 기존의 보이는 `<h1>`을 그대로 씁니다. 상태 4개 각각에 회귀 테스트를 추가했습니다. 테스트 1030개, lint, typecheck 통과.

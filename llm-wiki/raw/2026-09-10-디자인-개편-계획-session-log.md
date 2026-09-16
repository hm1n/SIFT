# 디자인 개편 계획 세션 로그

2026-09-10에 develop 브랜치에서 진행한 세션의 기록입니다. Figma Make로 완성한 디자인 파일과 현재 코드를 비교해 개편 계획을 세우고 GitHub 이슈 일곱 개를 만들었습니다. 코드는 바꾸지 않았습니다. 이 로그는 같은 날 이어진 `hm1n/html-css-design` 브랜치 세션이 핸드오프 문서를 바탕으로 작성했습니다. 결론은 `wiki/2026-09-10-디자인-개편-계획.md`에 있습니다.

## 1. 디자인 파일 분석

디자인 원본은 `C:\Users\user\Desktop\Chat Interface Design`입니다. 세션 시점의 구성은 다음과 같았습니다.

- `src/App.tsx` 1,346줄. Tailwind v4 유틸리티 클래스와 하드코딩 목업 데이터로 화면 전체를 한 파일에 담고 있습니다. `TopHeader`, `AppShell`, `StatusScreen`, `LoginScreen`, `RepoSelectScreen`, `AnalyzingScreen`, `CandidatesScreen`, `InterviewScreen`이 있고 인터뷰 화면 안에 `CodePanel`, `PAARPanel`, 메시지 행이 있습니다.
- `src/index.css`. `@theme` 블록에 색 9개, radius 7px, 폰트 3종이 있습니다. 스크롤바 4px 스타일도 여기 있습니다.
- 스펙 문서 4개. `product-flow-update.md`, `interview-workspace-spec.md`, `paar-interview-workspace.md`, `multi-file-evidence-nav.md`입니다.

화면 흐름은 GitHub 로그인, Repository 목록 선택, 분석 진행, 경험 후보 master-detail, 인터뷰 3열 워크스페이스(CODE, CHAT, PAAR) 순서입니다.

## 2. 현재 코드와의 격차

- 진입 흐름이 다릅니다. 현재는 `repository-analysis-view.tsx` 한 파일이 로그인 카드, owner와 repo 텍스트 입력, 기여 항목 textarea, Loading과 Empty 5종과 Error 상태를 모두 그립니다. 디자인은 로그인 화면과 Repository 목록 선택 화면을 나누고 목록에서 고릅니다. 목록을 채우는 `GET /api/github/repositories` 라우트가 없습니다.
- 스타일 기반이 다릅니다. `globals.css`에는 배경과 전경 두 색만 있고, CSS Modules 8개가 색과 간격을 따로 정합니다. 디자인은 Tailwind 유틸리티입니다.
- 폰트가 다릅니다. 현재는 Geist와 Geist Mono이고 디자인은 Inter, Geist Mono, Pretendard입니다.
- 인터뷰 화면 배치가 다릅니다. 현재 `interview-screen.tsx`는 `InterviewStreamView` 아래에 `InterviewEvidencePanel`을 세로로 둡니다. 디자인은 코드 근거를 왼쪽 열, 대화를 가운데, PAAR을 오른쪽 열에 둡니다.
- 디자인에는 있으나 데이터가 없는 것이 있습니다. 코드 패널 FILE 모드(스냅샷에 파일 원문 없음), 사이드바 세션 목록(세션 저장 없음), 질문 참조 파일 칩(스트림 계약에 참조 정보 없음), 계정 삭제(MVP 밖)입니다.

## 3. 결정

| 항목 | 결정 | 접은 대안과 이유 |
| --- | --- | --- |
| 스타일 기반 | Tailwind를 도입하지 않고 CSS Modules를 유지합니다. 토큰은 CSS 변수로 옮깁니다. | Tailwind v4 도입을 검토했습니다. 기존 모듈 파일 8개와 화면 테스트가 CSS Modules 기반이고, 의존성을 늘리지 않아도 같은 결과를 낼 수 있습니다. 디자인의 유틸리티 클래스는 토큰으로 옮기며 어차피 다시 써야 합니다. |
| 문구 언어 | 디자인대로 영어를 씁니다. | 한국어 유지를 검토했습니다. 디자인이 영어 라벨과 대문자 mono 스타일을 한 몸으로 쓰고 있어 한국어로 바꾸면 시각 언어가 깨집니다. |
| PAAR 두 번째 블록 라벨 | 디자인의 `ANALYZE`를 씁니다. | 같은 날 PAAR 설계 세션이 `ALTERNATIVE`로 정했으나 디자인과 어긋나 디자인을 따릅니다. 그 세션의 위키와 #89~#91의 키 이름 갱신은 그 세션이 담당합니다. |
| 기여 항목 입력 위치 | 세션 시점에는 정하지 않았습니다. | 디자인 파일이 수정 중이라 갱신본을 받은 뒤 정하기로 했습니다. 그때까지 기존 textarea 기능은 유지합니다. 같은 날 16:35 갱신본으로 확정된 내용은 계획 위키 2절에 있습니다. |

## 4. 생성한 이슈

- #92 상위 이슈. 공통 결정, Non-goal, 하위 순서, #91과의 충돌을 담습니다.
- #93 디자인 토큰과 공통 셸 도입
- #94 GitHub 로그인 진입 화면과 인증 상태
- #95 Repository 목록 조회와 선택 화면. `GET /api/github/repositories` 신규
- #96 Repository 분석 진행 화면 개편
- #97 경험 후보 master-detail 화면 개편
- #98 인터뷰 3열 워크스페이스와 코드 근거 패널

## 5. 남긴 충돌

#91의 Constraint "근거 패널을 옮기지 않습니다"가 #98의 3열 배치와 충돌합니다. #92 본문에 적었고 #91 수정은 사용자 승인 전까지 하지 않기로 했습니다.

## 6. 정정

- 세션 초기에는 PAAR 두 번째 블록을 `ALTERNATIVE`로 두고 있었습니다. 디자인 파일을 읽은 뒤 `ANALYZE`로 정정했습니다.
- 스펙 문서 수는 세션 시점에 4개였습니다. 다음 세션이 확인한 16:35 갱신본에는 `contribution-context.md`가 더해져 5개입니다.

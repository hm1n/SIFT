# 경험 후보 master-detail 화면 개편

이슈 #97이 만든 경험 후보 화면의 현재 계약입니다. 배경은 `wiki/2026-09-10-디자인-개편-계획.md`에, 구현 경위는 `raw/2026-09-11-경험후보-master-detail-화면-개편-session-log.md`(1차 구현), `raw/2026-09-11-경험후보-master-detail-디자인우선-재작업-session-log.md`(디자인 우선 재작업), `raw/2026-09-11-경험후보-master-detail-화면-다듬기-session-log.md`(PR #111 올리기 전 브라우저 확인 중 다듬기)에 있습니다. 확인 가능·불가 구분의 원본 계약은 `wiki/2026-08-24-확인가능불가-구분-계약.md`이고, 앞 단계인 분석 진행 화면 개편은 `wiki/2026-09-11-Repository-분석-진행-화면-개편.md`에 있습니다.

확인 날짜는 2026-09-11입니다. 이 문서는 1차 구현 뒤 사용자가 브라우저에서 실물 화면을 보고 "참고한 Figma 디자인과 전혀 다르다"고 지적해 디자인 우선으로 다시 작업한 결과, 그리고 그 뒤 사용자가 실 Repository로 브라우저에서 직접 확인하며 요청한 다듬기 결과까지 반영합니다. 1차 구현은 master-detail *배치*만 디자인대로 바꾸고 목록 행·타이포그래피·번역 범위는 기존 UI를 그대로 유지했었는데, 그 판단이 잘못이었습니다.

## 1. 배치

`ExperienceCandidateList`가 목록 260px 고정 열과 상세 flex 1 열을 나란히 그립니다(`.layout`). 560px 이하에서는 세로로 쌓입니다. 디자인의 `useState(CANDIDATES[0])`과 같이 후보가 있으면 항상 첫 후보가 기본 선택되어, 진입 즉시 목록과 상세가 함께 보입니다.

## 2. 목록 행 — 디자인과 정확히 같은 내용만

디자인의 목록 행(`CandidatesScreen`, App.tsx 636~644행)은 제목 + `{commitCount} commits · {period 시작}` 세 줄뿐입니다. 1차 구현은 이 행에 #97 이전부터 있던 출처 배지(`출처: Repository`), 기여 항목 일치/자동 추천 라벨, evidence 문장, 확인 가능·불가 안내, `AI-selected`/`Verified` 지표, PR 배지를 전부 그대로 남겨 뒤 화면이 훨씬 빽빽했습니다. 사용자가 이를 지적해 **디자인대로 제목·커밋 수·기간만 남기고 나머지는 모두 뺐습니다.**

이 정보들이 사라지는 것은 아닙니다. master-detail에서는 상세가 항상 함께 보이므로, 확인 가능·불가 구분(Constraint)은 상세의 "Why worth discussing" 안내와 "Repository evidence" 목록이 그대로 담습니다. 목록 행 하나만 봤을 때 이 정보가 없어진다는 점에서 이슈 #58·#47이 정한 "확인 가능 여부 표시를 어느 화면에서도 없애지 않는다"는 화면(스크린) 단위로 계속 지켜지고, 행(row) 단위로는 더 이상 중복하지 않습니다.

기여 항목 일치/자동 추천 출처 라벨은 디자인에 대응 자리가 없어 화면에서 완전히 뺐습니다(데이터·타입은 그대로 유지, `origin`·`source` 필드는 지우지 않았습니다). 필요해지면 다시 판단합니다.

행의 접근성 이름은 `aria-label={indexedTitle}`로 보이는 제목과 똑같습니다. 예전에는 `제목 · 출처: Repository`를 이름으로, 근거 문장·안내·지표 전체를 `aria-describedby`로 얹었지만, 행 콘텐츠 자체가 제목·커밋 수·기간뿐이라 더 얹을 설명이 없습니다.

## 3. 커밋 수·기간 유도 — `candidate-period.ts`로 공유

디자인의 `Candidate.commitCount`·`period`는 스키마에 없지만 유도 가능합니다. `commitCount = 1 + normalizedRelatedShas.length`, 기간은 대표 커밋과 관련 커밋의 `date` 최소~최대입니다. 목록 행과 상세 양쪽이 같은 값을 써야 해서 `candidate-period.ts`(`deriveCandidatePeriod`, `formatCommitDate`)로 새로 뽑았습니다. 목록 행은 시작월만(`period.start`), 상세 헤더는 시작~끝(같으면 한 달만)을 보여줍니다.

## 4. 스키마 공백 처리

디자인의 `CANDIDATE_WHY`(에세이형 "Why worth discussing")와 `CANDIDATE_TOPICS`(태그 배열 "Technical topics")는 대응하는 스키마 필드가 없습니다. 이슈 Non-goal이 "후보 생성 로직과 스키마 변경"을 막아 두었고, `citedFilePaths`·`source`는 성격이 달라 대체할 수 없다고 판단해, **사용자가 두 섹션 모두 "No corresponding data in the Repository schema to display this." 안내문으로 표시하기로 결정**했습니다. 디자인의 레이아웃(두 섹션의 자리)은 유지하되 내용은 채우지 않습니다.

## 5. Repository evidence 목록

기존 `ExperienceCandidateDetail`은 확인 불가 고정 목록·변경 파일·코드 변경 내역(diff)·관련 커밋·PR 정보 5개 구획으로 나뉘어 있었습니다. 이 중 변경 파일·diff·관련 커밋·PR 정보 4개를 디자인처럼 평평한 하나의 목록(`VERIFIED FROM REPOSITORY` 헤더, 대표 커밋과 관련 커밋을 항목으로 나열, 3개 초과 시 "View all")으로 합치기로 **사용자가 결정**했습니다.

이 결정이 안전한 이유는 `interview-evidence-panel.tsx`가 대표·관련 커밋의 diff·파일·PR 정보를 이미 전부 보여주기 때문입니다. 인터뷰 확정 뒤 도달하는 화면에서 깊은 근거가 그대로 남으므로, 후보 화면에서는 요약만 보여줘도 diff 수준 근거가 사라지지 않습니다.

항목 단위 확인 가능·AI 선택 구분은 유지합니다. 대표 커밋 항목은 `Verified`, 관련 커밋 항목은 `AI-selected`입니다. 확인 불가 고정 목록(`REPOSITORY_UNVERIFIABLE_ITEMS`, 이슈 #58 원칙)은 디자인에는 없어 별도 섹션으로 뒀었지만, PR #111을 올리기 전 사용자가 실 Repository로 화면을 확인하며 화면에서 완전히 빼 달라고 요청해 지웠습니다(11절).

디자인의 상세 헤더에는 대표 커밋 SHA로 가는 링크가 없습니다(App.tsx 594~598행). 1차 구현이 헤더에 별도로 넣었던 "대표 커밋 {sha7}" 링크는 Repository evidence 목록의 첫 항목이 이미 같은 URL로 링크하고 있어 중복이라 뺐습니다.

## 6. 번역 범위 — 화면 전체를 영어로

1차 구현은 `evidence-verifiability.ts` 공유 상수만 영어로 옮기고 `ExperienceCandidateList`·`ExperienceCandidateDetail` 자체 문구(목록 헤더, 뒤로가기, 인터뷰 시작 버튼, 확정 실패 안내, 확인 불가 헤딩)는 한국어로 남겼습니다. 사용자가 실물 화면에서 언어가 섞인 것을 보고 디자인 우선으로 재작업을 지시하면서, **이 화면 자체가 그리는 모든 UI 문구를 영어로 옮겼습니다.** 디자인 개편 공통 결정("화면 문구는 디자인대로 영어", `wiki/2026-09-10-디자인-개편-계획.md`)을 이 화면에도 온전히 적용한 것입니다.

영어로 옮긴 것:
- 목록 패널 헤더: "Candidates" eyebrow + "{N} experiences found"(디자인 원문 그대로, 단수 처리 없음)
- 상세 헤더 eyebrow "Experience", 섹션 eyebrow(Why worth discussing / Technical topics / Repository evidence), "VERIFIED FROM REPOSITORY", "View all N commits →" / "Show less"
- 확인 불가 헤딩("What can't be confirmed from the Repository"), 스키마 공백 안내문, 커밋 색인 실패 안내("Representative commit not found in the commit index.")
- `EXPERIENCE_SELECTION_ERROR_COPY`(`experience-selection.ts`)의 title·message 3종
- 인터뷰 시작 버튼("Start interview →"), 확정 실패 시 뒤로가기 버튼("← Back to candidates")
- "다른 Repository 선택" → "Choose a different repository"(다른 Empty/Error 상태와 이미 같은 라벨). 이 버튼은 이후 상세 푸터로 옮겨졌습니다(11절)

한국어로 남긴 것(전부 Stage A/B 서버 생성 콘텐츠 성격):
- `candidates.insufficientCandidatesReason`을 감싸는 "후보를 3개 채우지 않은 이유" 문단. 서버가 주는 사유 문장 자체가 한국어라 주변만 영어로 바꾸면 문장이 섞여 더 어색합니다.
- `StageAExclusions` 전체(1차 선별 제외 요약). 이슈 #96 후속 backlog 16번과 같은 성격의 Stage A/B 문구라 이번에도 범위 밖으로 뒀습니다.
- `커밋 색인 실패 · {sha7}` 폴백 제목(대표 커밋을 색인에서 못 찾았을 때만 보이는 예외 상태 문구).

`wiki/2026-09-10-디자인-개편-후속-backlog.md` 18번(목록 행의 언어 혼용)은 이번 재작업으로 해결됐습니다. 문서에 해결 표시를 남겼습니다.

## 7. 컴포넌트 계약

- `ExperienceCandidateDetailProps`에서 `candidates: StageBCandidateResult`를 지웠습니다(diff를 더 이상 안 씀). `data: CandidateDataOutput`은 관련 커밋 조회에 계속 씁니다.
- `ExperienceCandidateDetail`의 뒤로가기 버튼은 **확정 실패 안내가 있을 때만** 보입니다("← Back to candidates", `selectionError` 있을 때만 렌더). master-detail에서는 목록이 항상 보여서 "목록으로 돌아가기" 자체가 필요 없고, 남은 유일한 용도는 확정 실패를 닫고 다시 시도하는 것뿐입니다. 디자인에도 이 버튼이 없습니다.
- `ExperienceCandidateList`의 `returnToCandidates`는 `selection`만 idle로 되돌립니다(선택한 후보는 그대로 유지). `InterviewScreen`의 `onBack`도 같은 함수를 씁니다.
- `onInterviewActiveChange` 콜백 배선(PR #105 재검증 P1)은 그대로 유지했습니다.
- 상세 패널은 헤더(고정)·본문(스크롤)·푸터(고정, Start interview 버튼) 3단 구조로, 디자인의 `shrink-0`/`flex-1 overflow-y-auto`/`shrink-0` 구조와 같습니다.

## 8. 접근성

`RepositoryAnalysisView`의 시각적으로 숨은 `<h1>{owner}/{name}</h1>`은 그대로입니다. master-detail이 목록 헤더 영역과 상세 제목(`<h2>{title}</h2>`)을 동시에 그리지만, 목록 패널 헤더는 이제 `<h2>` 없이 `<p>` eyebrow + `<p>` 카운트뿐이라(디자인과 같음) `<h2>`는 상세의 후보 제목 하나뿐입니다. 여전히 숨은 `<h1>` 아래에 있어 계층은 유지됩니다.

## 9. 테스트와 확인

- `experience-candidate-list.test.tsx`(행 콘텐츠 관련 테스트 대부분 재작성), `experience-candidate-detail.test.tsx`, `experience-selection.test.tsx`, `interview-evidence-panel.test.tsx`, `repository-analysis-view.test.tsx`, `repository-flow.test.tsx`를 갱신했습니다. 행에서 빠진 정보(출처·evidence·지표)를 검증하던 테스트는 지우고, 새 행 콘텐츠(제목·커밋 수·기간, 선택 표시, 접근성 이름)를 검증하는 테스트로 바꿨습니다.
- 테스트 1078개, lint, typecheck 통과.
- 임시 라우트(`src/app/debug-candidates-97/`)에 고정 fixture로 화면을 실제로 렌더해 Playwright로 넓은 화면·좁은 화면(480px) 스크린샷을 확인했습니다. 목록 행이 디자인처럼 세 줄로 줄었는지, 선택 전환이 되는지, 상세 헤더/푸터가 고정되고 본문만 스크롤되는지 확인했습니다. 임시 라우트와 스크린샷 스크립트는 모두 삭제했습니다.
- 실제 GitHub 데이터·실제 로그인 화면으로의 확인은 사용자가 별도로 진행 중입니다.

## 10. 화면 다듬기 — PR #111 올리기 전 실 Repository 확인 중 반영

디자인 우선 재작업을 커밋하지 않은 채 사용자가 실 Repository(로그인된 실제 GitHub 계정)로 화면을 열어 브라우저 요소 검사기로 직접 짚어가며 다듬음을 요청했습니다. 경위는 `raw/2026-09-11-경험후보-master-detail-화면-다듬기-session-log.md`에 있습니다.

- **목록 행 사이 간격**: `li + li` 구분선(디자인에는 있던 border)을 지워 달라는 요청에 따라 지웠고, 이어서 `candidateList`가 `display: grid`의 기본 `align-content: stretch` 때문에 후보 수가 적을 때(3개뿐인데 패널은 640px) 각 행 아래에 불필요한 여백이 생기던 1차 구현 이전부터의 문제를 `align-content: start`로 함께 고쳤습니다.
- **행 상하 패딩**: 14px → 20px로 늘렸습니다(사용자가 최종 값을 직접 지정).
- **"What can't be confirmed from the Repository" 고정 목록 제거**: 상세에서 완전히 뺐습니다. 이슈 #58·#47·#97이 정한 Constraint("확인 가능 여부 표시를 제거하거나 색으로만 표시하지 않는다")가 가리키는 것은 커밋별 `Verified`/`AI-selected` **태그**이고, 이 고정 목록은 그 태그를 보완하는 별도 안내 섹션이라 판단해 태그는 그대로 두고 이 섹션만 지웠습니다.
- **목록 하단 요약 타일 제거**: "Total commits"/"Commits reviewed in detail" 두 타일을 지웠습니다. 디자인에도 없는 요소였습니다.
- **"Choose a different repository" 버튼 이동**: 목록 하단에서 상세 푸터 왼쪽으로 옮겼습니다. `ExperienceCandidateDetail`에 `onSelectRepository` prop을 새로 받아, "Start interview"와 같은 크기·모양(높이 40px, 아이콘 간격)에 테두리 있는 muted 색을 입혀 primary 버튼보다 낮은 위계로 보이게 했습니다. 후보가 0개면 이 화면 자체가 렌더되지 않아(별도 Empty 상태) 상세가 항상 렌더되므로 이 버튼도 항상 보입니다.
- **확인 가능·불가 설명 문단 3곳의 시각적 제거**: `verifiedNotice`("Verified · Changed files...")와 `aiSelectionNotice`("AI-selected · Confirmed only...")를 화면에서 없애 달라는 요청을 받았습니다. `verifiedNotice`는 "Start interview" 버튼의 `aria-describedby`가 가리키는 대상이라(이슈 #47 PR #52 1차 리뷰 P1과 같은 종류의 문제) 완전히 지우면 스크린리더가 이 설명을 듣지 못하게 됩니다. 사용자에게 이 tension을 설명하고 확인받은 뒤, 표준 visually-hidden 패턴(`position: absolute; width/height: 1px; clip: rect(0,0,0,0)` 등)으로 DOM·`aria-describedby` 연결은 유지하고 화면에서만 숨기기로 했습니다. 같은 처리를 "Why worth discussing" 섹션의 `evidenceNotice`("Unverifiable · AI-written interpretation")에도 적용했습니다. 이 셋과 달리 "Why worth discussing"의 스키마 공백 안내문 중복분은 `aria-describedby` 연결이 없어 완전히 지웠습니다("Technical topics"의 스키마 공백 안내문은 그대로 남습니다).
- **여백 추가**: "Why worth discussing" evidence 문단과 "Technical topics" 스키마 공백 안내에 각 32px, "Repository evidence" 섹션 전체에 40px 하단 여백을 추가했습니다. `.body p { margin: 0 }`가 타입 선택자+클래스라 단순 클래스 하나로는 우선순위가 낮아 적용되지 않아, `.body .evidenceText`처럼 클래스를 겹쳐 우선순위를 올려야 했습니다.

## 11. 확인 필요

- 기여 항목 일치/자동 추천 출처 라벨을 화면에서 완전히 뺀 것이 맞는 선택인지는 확인 필요입니다. 데이터·타입은 남겨 뒤, 필요해지면 상세 패널 등 다른 자리에 다시 넣을 수 있습니다.
- 확인 불가 고정 목록을 뺀 자리(목록 하단 요약 타일 포함)를 다른 화면(온보딩, 도움말 등)에 노출할지는 정하지 않았습니다.

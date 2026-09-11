# 경험후보 master-detail 화면 다듬기 세션 로그

`raw/2026-09-11-경험후보-master-detail-디자인우선-재작업-session-log.md`(디자인 우선 재작업)를 이어받습니다. 같은 세션, 같은 이슈 #97입니다. 디자인 우선 재작업을 커밋하지 않은 채, 사용자가 실 Repository(로그인된 실제 GitHub 계정)로 화면을 열어 브라우저 요소 검사기로 요소를 하나씩 짚어가며 다듬음을 요청했고, 마지막에 PR을 올려 달라고 했습니다.

## 1. 목록 행 사이 간격 제거

"이 영역 내에서 각 경험 사이에 간격을 없애줘" 요청에 `experience-candidate-list.module.css`의 `.candidateList li + li { border-top: ... }` 구분선을 지웠습니다. 참고 디자인(`App.tsx` 638~644행)에는 `border-b border-neutral-100` 구분선이 있었지만, 사용자가 그 구분선까지 포함해 "간격"으로 지칭한 것으로 판단했습니다.

## 2. `align-content: stretch` 잠재 버그 발견과 수정

구분선을 지운 뒤 "이 영역의 하단 패딩은 왜 있는거야?"라는 질문을 받았습니다. 선택한 `li`의 실측 높이가 181px로 콘텐츠보다 훨씬 컸습니다. 원인은 `.candidateList`가 `display: grid`이고 기본 `align-content`가 `stretch`라서, `flex: 1`로 `listPanel`의 남는 높이(최대 640px)까지 늘어난 컨테이너가 그 여백을 후보 3개 행에 균등하게 나눠 늘린 것이었습니다. `align-content: start`로 고쳤습니다. 이 버그는 구분선 제거와 무관하게 이전부터 있었습니다.

## 3. 행 패딩 조정

"상하단 패딩 8px씩 추가해줘" → 14px에서 22px로. 이어서 "상하단 패딩 20px로 변경해줘" → 최종 20px.

## 4. 확인 불가 고정 목록·요약 타일 제거, 버튼 이동 요청

사용자가 브라우저 요소 검사기로 세 영역을 짚으며 "이 컴포넌트들은 없애줘"라고 요청했습니다.
- 상세의 "What can't be confirmed from the Repository" 고정 목록(`unverifiableList`, `REPOSITORY_UNVERIFIABLE_ITEMS`)
- 목록 하단의 "Total commits"/"Commits reviewed in detail" 요약 타일 2개

같은 요청에서 "Choose a different repository" 버튼을 상세 푸터 영역의 맨 왼쪽으로, "Start interview"와 같은 디자인에 색만 다르게(위계 구분) 배치해 달라고 했습니다.

고정 목록 제거는 이슈 #58·#47·#97의 "확인 가능 여부 표시를 제거하거나 색으로만 표시하지 않는다" Constraint와 맞닿아 있어, 바로 지우지 않고 먼저 설명했습니다. 이 Constraint가 보호하는 것은 커밋별 `Verified`/`AI-selected` **태그**이고, 고정 목록은 그 태그를 보완하는 별도 안내 섹션일 뿐이라 태그가 그대로 남으면 Constraint 위반이 아니라고 판단해 진행했습니다.

버튼 이동은 `ExperienceCandidateDetail`에 `onSelectRepository` prop을 추가하고 `ExperienceCandidateList`에서 내려주는 방식으로 구현했습니다. `ExperienceCandidateList`가 후보 0개일 때는 렌더되지 않고(별도 Empty 상태가 처리) 항상 최소 1개 후보로 렌더된다는 전제(계약)를 `repository-analysis-view.tsx`에서 다시 확인해, 상세로 옮겨도 버튼이 도달 불가능해지는 상태가 없음을 검증했습니다. `repository-analysis-view.test.tsx`·`repository-flow.test.tsx`의 "Choose a different repository" 단언이 전부 Empty/Error `StatusScreen`의 별도 버튼(이 이동과 무관)을 가리키는 것을 확인해 충돌이 없었습니다.

## 5. 확인 가능·불가 설명 문단의 시각적 제거 — 접근성 tension

사용자가 "Repository evidence" 섹션의 `verifiedNotice`("Verified · Changed files...")와 `aiSelectionNotice`("AI-selected · Confirmed only...") 두 문단을 짚어 "이 영역도 삭제"를 요청했습니다.

바로 지우지 않고 먼저 설명했습니다. `verifiedNotice`의 id(`candidate-repository-verified-notice`)가 "Start interview" 버튼의 `aria-describedby`에 걸려 있어, 완전히 지우면 이슈 #47 PR #52 1차 리뷰의 P1과 같은 종류의 문제(버튼 접근성 이름만으로는 스크린리더 사용자가 근거의 한계를 듣지 못함)가 재발합니다. 커밋별 태그 자체는 이 요청과 무관해 그대로 남는다는 점도 함께 설명했습니다.

사용자가 "시각적으로는 없애고 스크린리더용만 남겨줘"로 답해, 표준 visually-hidden 패턴(`position: absolute; width: 1px; height: 1px; margin: -1px; clip: rect(0,0,0,0); ...`)으로 두 문단을 처리했습니다. DOM과 `aria-describedby` 연결은 그대로 둡니다.

이어서 "Why worth discussing" 섹션의 `evidenceNotice`("Unverifiable · AI-written interpretation")와 같은 섹션의 스키마 공백 안내문(`schemaGapNotice`)을 각각 짚어 "이 영역도 제거해줘"를 요청받았습니다. `evidenceNotice`는 `EVIDENCE_NOTICE_ID`로 같은 버튼의 `aria-describedby`에 걸려 있어 앞서 정한 방식(시각적으로만 숨김)을 그대로 적용했습니다. 스키마 공백 안내문은 `aria-describedby` 연결이 없어 요청대로 완전히 지웠습니다. 같은 안내문이 "Technical topics" 섹션에는 그대로 남아 있어(그 인스턴스는 선택되지 않았음), CSS 클래스(`schemaGapNotice`)는 지우지 않고 JSX의 해당 줄만 지웠습니다.

## 6. 여백 추가

- "Why worth discussing" evidence 문단(`<p>{candidate.evidence}</p>`)과 "Technical topics" 스키마 공백 안내에 각각 하단 마진 32px.
- "Repository evidence" 섹션 전체에 하단 마진 40px.

첫 시도에서 `.evidenceText { margin-bottom: 32px }`를 추가했지만 적용되지 않았습니다. `.body p { margin: 0 }`가 타입 선택자(`p`) + 클래스(`.body`) 조합으로 명시성이 더 높아, 클래스 하나뿐인 선택자보다 우선했기 때문입니다. `.body .evidenceText`처럼 클래스를 두 개 겹쳐 명시성을 올려 해결했습니다. `schemaGapNotice`도 같은 이유로 `.body .schemaGapNotice`로 별도 규칙을 추가했습니다.

## 7. PR 올리기 전 발견한 llm-wiki 병합 충돌

`/pull-request` 스킬로 PR을 올리기 전 `git status`를 확인하다가 `llm-wiki/index.md`(staged, 겉보기엔 정상 `M`)와 `llm-wiki/log.md`(`UU`, 미해결 병합 충돌)에 실제 충돌 마커(`<<<<<<< Updated upstream` / `=======` / `>>>>>>> Stashed changes`)가 남아 있는 것을 발견했습니다.

`git stash list`로 대조한 결과 `stash@{0}`("WIP on hm1n/html-css-design-master-detail")이 이전(압축 전) 세션이 만든 이 세션 자신의 WIP 저장이었고, 그 stash를 되돌리다가 두 파일 모두 "append 지점 충돌"(같은 파일 끝에 서로 다른 새 줄을 추가)로 걸려 미해결로 남은 것으로 파악했습니다. 두 쪽 모두 실제로 이미 커밋된 정당한 작업(Stage A 예산 선별 관련 raw/output 문서들, 이슈 #107 수정)과 이번 세션의 #97 기록이라, `llm-wiki/AGENTS.md`의 "되돌릴 내용이 있으면 기존 줄을 지우지 말고 새 줄로 추가한다" 원칙에 따라 데이터 손실 없이 두 쪽을 모두 살려 순서대로 이어 붙였습니다(index.md는 업스트림 항목 뒤에 이번 세션 항목을, log.md는 업스트림 두 행 뒤에 이번 세션 두 행을).

`git stash drop stash@{0}`으로 이제는 불필요해진 stash 항목을 지우려 했으나 자동 승인 정책(Irreversible Local Destruction)에 막혀 실행하지 못했습니다. 사용자에게 알리고 그대로 두었습니다.

## 8. 검증과 PR

전체 테스트(`npx vitest run`) 1102개, lint, typecheck를 순서대로 통과를 확인했습니다(다듬기 단계마다 `experience-candidates` 하위 테스트로 먼저 확인하고 마지막에 전체 재확인). 커밋 1개(`이슈 #97 경험 후보 master-detail 화면 개편 구현`)로 묶어 `hm1n/html-css-design-master-detail` 브랜치에 push하고, `/pull-request` 스킬로 PR #111(base: `develop`)을 열었습니다. Assignee `hm1n`, 라벨 `🎨 HTML&CSS`.

## 9. 확인 필요로 남긴 것

- 기여 항목 일치/자동 추천 라벨을 화면에서 완전히 뺀 판단(디자인 우선 재작업에서 남긴 것, backlog 20번)은 여전히 확인 필요입니다.
- 확인 불가 고정 목록·요약 타일을 뺀 자리를 다른 화면(온보딩, 도움말 등)에 노출할지는 정하지 않았습니다.
- `stash@{0}`이 저장소에 그대로 남아 있습니다. 이번 세션에서 이미 반영된 내용이라 다시 충돌할 일은 없지만, 정리가 필요하면 사용자가 직접 `git stash drop stash@{0}`을 실행해야 합니다.

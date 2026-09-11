# 경험후보 master-detail 화면 디자인 우선 재작업 세션 로그

`raw/2026-09-11-경험후보-master-detail-화면-개편-session-log.md`(1차 구현)를 이어받습니다. 같은 세션, 같은 이슈 #97이지만 사용자 피드백으로 방향이 바뀌어 새 파일로 남깁니다.

## 1. 계기

1차 구현을 커밋하지 않고 사용자가 실제 브라우저(로그인 후 실 Repository `study-watch`)에서 화면을 확인했습니다. 스크린샷을 보여주며 "이번에 작업한 화면이 이 화면 맞아?"라고 물었고, master-detail 배치·스키마 공백 안내·영어 번역 등 1차 구현의 핵심 요소가 실제로 반영된 것을 확인했습니다.

곧이어 "기존에 참고를 요청했던 figma 출력물 화면과 전혀 다른데 어떤 파일을 참고한 거야"라는 질문이 왔습니다. 참고 파일(`C:\Users\user\Desktop\Chat Interface Design\src\App.tsx`)을 다시 대조한 결과, 파일 자체는 맞게 읽었지만 **목록 행의 내용을 디자인대로 바꾸지 않고 #97 이전의 콘텐츠를 그대로 유지**한 것이 실제 원인이었습니다. 디자인의 행은 제목·커밋 수·기간 세 줄뿐인데(App.tsx 636~644행), 1차 구현은 그 위에 출처 배지·기여 항목 라벨·evidence 문장·확인 가능/불가 지표·PR 배지를 전부 얹어 두었습니다. 이슈 #97 Goal 본문에도 "왼쪽 목록이 후보 제목, 커밋 수, 기간을 행으로 보여주고..."라고 정확히 적혀 있었는데 배치(컨테이너)만 옮기고 콘텐츠는 옮기지 않은 것이 실수였습니다.

사용자 지시: "리뷰 반영하기 전에 디자인 수정부터 진행해. 기존 설계와 UI보다 참고 파일의 디자인을 우선으로 작업해. 단, 디자인 내에 현재 서비스의 데이터로는 표기하기 어려운 내용이 있는 경우 그 부분만 보고해."

## 2. 판단: Constraint와 "기존 UI" 구분

디자인 우선으로 작업하되, 이슈 #58·#47이 정한 "확인 가능 여부 표시를 없애지 않는다" Constraint는 디자인 선호가 아니라 다른 이슈가 정한 하드 요구사항이라 판단해 구분했습니다.

- **디자인에 없고 순수 UI 취향이었던 것**(출처 배지, 기여 항목 라벨, 행 안의 evidence/지표): 디자인대로 뺐습니다. 이 정보가 화면에서 완전히 사라지는 게 아니라 — master-detail이라 상세가 항상 같이 보이므로 상세 쪽 콘텐츠(Why worth discussing, Repository evidence)가 이미 담고 있었습니다.
- **다른 이슈가 정한 Constraint**(확인 가능·불가 구분): 화면 단위로는 유지된다고 확인한 뒤에만 행에서 뺐습니다. 상세의 "Unverifiable · AI-written interpretation", "Verified"/"AI-selected" 태그가 그대로 남는 것을 재확인했습니다.
- **이슈 #58이 정한 다른 Constraint**(어떤 커밋도 사용자 모르게 배제하지 않는다 — `StageAExclusions`, `insufficientCandidatesReason`): 디자인에는 이 개념 자체가 없지만(디자인은 항상 정확히 3개 후보인 목업이라 부족·제외 상황을 다루지 않음), 삭제하지 않고 master-detail 영역 아래 그대로 남겼습니다.

## 3. 번역 범위 재검토

1차 구현 때는 evidence-verifiability.ts와 그 소비자(interview-evidence-panel.tsx)로만 번역 범위를 좁혔습니다(#98 영역 침범을 피하려는 판단). 실물 화면을 보니 그 좁은 범위 때문에 같은 패널 안에서 영어(Verified 태그)와 한국어(뒤로가기, 인터뷰 시작 버튼, 헤딩)가 뒤섞여 있었습니다.

디자인 개편 공통 결정("화면 문구는 디자인대로 영어")이 이미 #93~#96에서 화면 전체 단위로 적용된 전례를 다시 확인하고, 이번에도 `ExperienceCandidateList`·`ExperienceCandidateDetail` 자체 문구까지 전부 영어로 옮기기로 판단을 바꿨습니다. 단, Stage A/B 서버 생성 콘텐츠(`insufficientCandidatesReason`, `StageAExclusions`)는 이슈 #96 후속 backlog 16번과 같은 이유로 범위 밖에 뒀습니다 — 서버가 주는 문장 자체가 한국어라 주변만 번역하면 더 어색해집니다.

## 4. 구현

1. `candidate-period.ts` 신설. 목록 행과 상세가 같은 커밋 수·기간 유도 로직을 써야 해서(1차 구현 때는 상세 안에만 있었음) 공유 함수로 뽑았습니다.
2. `experience-candidate-list.tsx`: 행 콘텐츠를 제목 + `{commitCount} commits · {periodStart}`로 줄이고, `EVIDENCE_ORIGIN_LABEL`(출처 배지) 상수를 지웠습니다. 목록 패널 헤더를 "경험 후보를 준비했습니다" 문단에서 디자인의 "Candidates" eyebrow + "{N} experiences found"로 바꿨습니다. 요약 통계·"다른 Repository 선택" 버튼 라벨을 영어로 옮겼습니다.
3. `experience-candidate-detail.tsx`: 헤더에서 대표 커밋 SHA 링크를 뺐습니다(Repository evidence 목록 첫 항목과 중복). 헤더·본문·푸터 3단 구조로 바꾸고, 뒤로가기 버튼을 확정 실패 상태에서만 렌더하도록 좁혔습니다. 확인 불가 헤딩·스키마 공백 안내·인터뷰 시작 버튼을 영어로 옮겼습니다.
4. `experience-selection.ts`의 `EXPERIENCE_SELECTION_ERROR_COPY` 3종을 영어로 옮겼습니다.
5. 두 CSS 모듈을 디자인의 정확한 타이포그래피(font-mono 마이크로 라벨, `--label-size-xs/sm`, letter-spacing)에 맞춰 다시 썼습니다. 목록 행 선택 표시(왼쪽 테두리+배경), 상세의 고정 헤더/스크롤 본문/고정 푸터 레이아웃을 추가했습니다. `StageAExclusions`가 쓰던 `styles.verifiedTag`가 실제로는 `.metrics .verifiedTag`(중첩 셀렉터)에만 걸려 있어 스타일이 전혀 먹지 않던 잠재 버그를 발견해, `.metrics`를 지우면서 `.verifiedTag`를 독립 셀렉터로 바꿔 함께 고쳤습니다. 이 버그는 1차 구현 이전부터 있었습니다.

## 5. 테스트 갱신에서 겪은 문제

행에서 제목만 남기고 `aria-label`을 지웠더니, 버튼의 접근성 이름이 제목 span과 커밋 수·기간 span의 텍스트를 모두 이어붙인 값으로 계산돼 `getByRole("button", { name: "제목" })`이 실패했습니다. `aria-label={indexedTitle}`을 다시 붙여 접근성 이름을 보이는 제목과 정확히 일치시켰습니다(부가 정보인 커밋 수·기간은 이름에서 빠지고 화면에는 그대로 보입니다).

목록 헤더 문구를 영어로 바꾸면서 `/경험 후보 (\d+)개를 선정했습니다/`를 단언하던 테스트가 `experience-candidate-list.test.tsx`, `experience-selection.test.tsx`, `repository-analysis-view.test.tsx` 세 파일에 걸쳐 있었습니다. 하나씩 찾아 `"{N} experiences found"`로 바꿨습니다.

`CONFIRM_LABEL`("이 경험으로 인터뷰 시작" → "Start interview")과 `BACK_LABEL`("← 후보 목록으로")을 분리해야 했습니다. `BACK_LABEL`은 `InterviewScreen` 자체의 뒤로가기 버튼(안 바뀜, 한국어 유지)이고, 확정 실패 화면의 뒤로가기는 새 버튼("← Back to candidates")이라 `CANDIDATE_BACK_LABEL`을 따로 뒀습니다. 두 버튼이 같은 텍스트를 썼다가(우연의 일치) 이번에 갈라지면서 테스트가 혼동 없이 구분됩니다.

`experience-candidate-list.test.tsx`의 기존 테스트 대부분(11개 중 9개)이 행에서 뺀 콘텐츠(출처·evidence·지표·PR)를 검증하고 있어 재작성했습니다. 데이터 정규화 로직(`createExperienceCandidateListItems`의 중복 제거) 검증은 유지하고 UI 단언만 걷어냈습니다.

세 번의 `npx vitest run` 순회(32건 실패 → 5건 → 0건)로 수렴했습니다.

## 6. 시각 확인

1차 구현 때와 같은 방식(임시 라우트 `src/app/debug-candidates-97/` + `node_modules/playwright`)으로 다시 스크린샷을 찍어 확인했습니다. 넓은 화면에서 목록 행이 디자인처럼 세 줄로 줄었는지, 선택한 행의 배경·왼쪽 테두리가 옮겨가는지, 480px 좁은 화면에서 목록이 위로 쌓이고 상세 헤더/푸터는 고정된 채 본문만 스크롤되는지 확인했습니다. 확인 뒤 임시 라우트와 스크린샷 스크립트를 삭제했습니다.

## 7. 접었던 대안

- 목록 행에 출처·evidence 정보를 시각적으로는 숨기고 `aria-describedby`로만 유지하는 방안을 검토했습니다. master-detail에서는 상세가 항상 함께 보여 같은 정보가 이미 접근 가능한 곳에 있으므로, 행마다 숨은 설명을 중복해서 얹는 것은 불필요한 복잡도로 판단해 접었습니다.
- 기여 항목 일치/자동 추천 배지를 상세 패널 어딘가로 옮겨 유지하는 방안도 검토했으나, 디자인에 대응 자리가 없어 "확인 필요" 항목으로만 남기고 화면에는 넣지 않았습니다.

## 8. 확인 필요로 남긴 것

- 기여 항목 일치/자동 추천 라벨을 화면에서 완전히 뺀 판단이 맞는지 사용자 확인이 필요합니다.
- 실제 로그인 화면에서 재확인은 사용자가 진행 중입니다.

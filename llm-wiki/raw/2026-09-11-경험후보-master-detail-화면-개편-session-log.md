# 경험후보 master-detail 화면 개편 세션 로그

이슈 #97 구현 세션입니다. 핸드오프 문서(#96 PR #105 머지 뒤 작성)를 이어받아 이 워크트리(`html-css-design-master-detail`, 브랜치 `hm1n/html-css-design-master-detail`, `origin/develop` 지점)에서 진행했습니다.

## 1. 이슈와 코드 대조

이슈 본문과 핸드오프가 말한 코드 사실을 직접 읽어 확인했습니다.

- 디자인(`C:\Users\user\Desktop\Chat Interface Design\src\App.tsx`)의 `Candidate` 인터페이스(15행)와 `CANDIDATE_WHY`(52행, 에세이형)·`CANDIDATE_TOPICS`(57행, 태그 배열)는 전부 하드코딩 목업이었습니다. 실제 스키마(`ExperienceCandidate`)와 대조해 `commitCount`·`period`는 유도 가능하고 `Why worth discussing`·`Technical topics`는 대응 필드가 없음을 확인했습니다.
- `CandidateDetailPanel`(App.tsx 588~627행)의 "Repository evidence" 목록은 평평한 커밋/PR 나열이지만, 지금 `experience-candidate-detail.tsx`는 이미 확인 불가 고정 목록·변경 파일·diff·관련 커밋·PR 정보 5개 구획으로 나뉘어 있었습니다.
- `interview-evidence-panel.tsx`가 `evidence-verifiability.ts`의 상수(`VERIFIABILITY_LABEL` 등)를 그대로 가져다 쓰는 것을 5~7, 104, 118, 215행에서 확인했습니다. 이 파일을 번역하면 인터뷰 화면 문구도 함께 바뀝니다.
- `repository-flow.tsx`의 `onInterviewActiveChange` 배선(PR #105 재검증 P1)을 다시 읽어, master-detail로 바꿔도 이 콜백이 계속 불려야 함을 확인했습니다.

## 2. 결정 대기 항목을 사용자에게 확인

핸드오프가 "제안 없이 나열"한 5개 결정 항목을 각각 권장안과 함께 `AskUserQuestion`으로 물었습니다. 결과는 다음입니다.

1. Why worth discussing·Technical topics: 권장안(evidence 재사용 + Technical topics 제외)이 아니라 **"두 항목 모두 확인 필요 안내문으로 표시"**를 선택했습니다. 디자인의 두 섹션 자리는 유지하고 내용만 안내문으로 채웁니다.
2. Repository evidence 구조: 권장안(6구획 유지 + 헤더만 얹기)이 아니라 **"디자인처럼 평평한 목록으로 단순화"**를 선택했습니다.
3. evidence-verifiability.ts 번역 범위: 권장안대로 **"공유 상수 그대로 영어로 바꾸고 interview 화면도 함께 반영"**을 선택했습니다.
4. CSS 팔레트: 권장안대로 **"이번 PR에서 함께 토큰으로 마이그레이션"**을 선택했습니다.

결정 2번을 받은 뒤, 평평한 목록으로 단순화해도 diff·파일 수준 근거가 완전히 사라지지 않는지 `interview-evidence-panel.tsx`를 다시 읽어 확인했습니다. 대표·관련 커밋의 diff·파일·PR 정보를 그 화면이 이미 전부 보여주고 있어(102~278행), 후보 화면에서 요약만 남겨도 안전하다고 판단했습니다.

## 3. 구현

1. `evidence-verifiability.ts`의 상수 6개를 영어로 옮겼습니다.
2. `experience-candidate-detail.tsx`를 재작성했습니다. `candidates` prop을 지우고(diff를 더 이상 안 씀), 헤더에 유도한 `commitCount`·`period`를 추가하고, Why worth discussing·Technical topics 섹션에 스키마 공백 안내문을 넣고, 변경 파일·diff·관련 커밋·PR 정보 4구획을 `Repository evidence` 평평한 목록 하나로 합쳤습니다(3개 초과 시 View all 토글).
3. `experience-candidate-list.tsx`를 재작성했습니다. `selectedSha`의 기본값을 `null`에서 `items[0]?.candidate.sha`로 바꿔 master-detail이 항상 한 후보를 선택한 상태로 시작하게 했고, 목록·상세를 `.layout`(flex row) 안에 나란히 그리도록 구조를 바꿨습니다. 기존 `backToList`(선택도 비움)를 `returnToCandidates`(선택은 유지, `selection`만 idle로)로 바꿨습니다.
4. 두 CSS 모듈을 `globals.css` 토큰으로 마이그레이션하면서 master-detail 레이아웃(260px 고정 + flex 1, 560px 이하 세로 스택)을 추가했습니다.

## 4. 테스트 갱신에서 겪은 문제와 해결

master-detail이 목록 행과 상세를 **동시에** 그리면서, 기존 테스트가 전제한 "목록 모드 아니면 상세 모드" 배타적 렌더링이 깨졌습니다. 같은 텍스트가 두 곳에 동시에 나타나 `getByText` 단일 매치 단언이 여러 곳에서 깨졌습니다.

- 대표 커밋 제목, PR 배지("PR #45"), evidence 문장, `VERIFIABILITY_LABEL`/`AI_SELECTION_LABEL` 배지가 목록 행과 상세(대표 커밋 항목)에 동시에 나타나는 경우를 하나씩 찾아 `within(row)`로 목록 행에 스코프하거나, 의도적 중복이면 `getAllByText(...).length`로 바꿨습니다.
- `experience-candidate-detail.tsx` 자체도 `commitCount`를 헤더와 Repository evidence 헤더 두 곳에 그려서(`{commitCount} commits`, `{commitCount} commits`) 같은 컴포넌트 안에서도 중복이 생겼습니다. 같은 방식으로 스코프했습니다.
- `repository-analysis-view.test.tsx`의 두 테스트(h2 단일 존재 확인, evidence 문장 단일 존재 확인)도 같은 이유로 깨져 있었습니다. 이 파일은 #97이 아니라 #96 산출물이지만 master-detail 전환의 직접적인 파급이라 함께 고쳤습니다.
- "후보 상세에 진입했다가 목록으로 돌아온다" 테스트는 전제(목록 모드 → 클릭 → 상세 모드 → 뒤로가기 → 목록 모드) 자체가 master-detail에 맞지 않아, "목록에서 다른 후보를 선택하면 상세가 함께 바뀐다"로 대체했습니다.

세 번의 `npx vitest run` 순회로 7건 → 5건 → 0건까지 줄였습니다. 실패를 모아서 한 번에 고치지 않고 매 순회 남은 실패의 원인이 서로 다른지(번역 누락 vs 중복 매치 vs 테스트 전제 붕괴) 구분하며 진행했습니다.

## 5. 시각 확인

실제 GitHub 로그인 없이 레이아웃을 확인하려고 임시 라우트 `src/app/debug-candidates-97/page.tsx`를 만들어 고정 fixture(후보 3개, 그중 하나는 관련 커밋 2개)로 `ExperienceCandidateList`를 직접 렌더했습니다. 처음에는 서버 컴포넌트로 만들어 "Event handlers cannot be passed to Client Component props" 오류가 났고, `"use client"`를 추가해 해결했습니다.

`node_modules/playwright`를 그대로 써서(별도 설치 불필요) 1200px·480px 두 뷰포트로 스크린샷을 찍었습니다. 확인한 것:

- 넓은 화면에서 목록 260px + 상세가 나란히 보이고, 좁은 화면(480px)에서 세로로 쌓입니다.
- 두 번째 후보를 클릭하면 그 행의 배경이 바뀌고 상세가 즉시 그 후보로 바뀝니다.
- `Repository evidence` 목록에서 대표 커밋 항목은 `Verified`, 관련 커밋 항목은 `AI-selected` 배지를 보여줍니다.

확인이 끝난 뒤 임시 라우트와 스크린샷 스크립트(`tmp-screenshot.js`, `tmp-screenshot2.js`)를 모두 삭제했습니다. `git status`로 작업 트리에 남지 않았음을 확인했습니다.

## 6. 접었던 대안

- Why worth discussing에 기존 `candidate.evidence`를 재사용하고 Technical topics만 빼는 방안(오케스트레이터 권장안)은 사용자가 "둘 다 확인 필요 안내문"을 선택하며 접었습니다.
- Repository evidence를 기존 6구획 그대로 두고 디자인 헤더 스타일만 얹는 방안도 사용자가 평평한 목록 단순화를 선택하며 접었습니다.
- evidence-verifiability.ts를 후보 화면 전용 상수로 분기해 interview 화면은 한국어로 남기는 방안은 상수 이중화 비용과 두 화면 문구가 어긋날 위험 때문에 사용자가 접었습니다.

## 7. 확인 필요로 남긴 것

- 실제 GitHub 로그인 뒤 실제 Repository 데이터로 화면을 다시 확인해야 합니다.
- 목록 행이 영어 배지(`Verified`, `AI-selected`)와 한국어 라벨(`출처: Repository`, `기여 항목 일치`)을 섞어 쓰는 것이 backlog로 분리됐습니다(`wiki/2026-09-10-디자인-개편-후속-backlog.md` 18번).

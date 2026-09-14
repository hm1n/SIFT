# 레거시 팔레트 제거와 화면 문구 영어화 세션 로그 (2026-09-14)

3열 배치를 dev 서버에서 보던 사용자가 답변 입력 영역의 보라색을 지적한 데서 시작해, 대화 열의
하드코딩 색 52개를 토큰으로 옮기고 화면 문구를 영어로 통일한 경위입니다. 도달한 결론은
`wiki/2026-09-14-인터뷰-3열-워크스페이스.md` 8·9절에 있습니다.

앞 작업은 `raw/2026-09-14-한글-폰트-스택-session-log.md`입니다.

## 1. 지적은 버튼 하나였고 범위는 파일 전체였습니다

사용자가 답변 입력 영역을 가리키며 "아직 레거시 primary 색상이 적용되어 있는 것 같다"고 했습니다.
브라우저가 준 computed style이 `background: rgb(201, 198, 230)`이었고, `.submitButton:disabled`의
`#c9c6e6`이었습니다. 활성 배경은 `#5b52d6`입니다. 디자인 토큰의 primary는 `#0a0a0a`이고 보라 계열은
토큰에 없습니다.

버튼 하나만 고치면 되는지 확인하려고 CSS 모듈별로 하드코딩 색 개수를 셌습니다.

| 파일 | 개수 |
| --- | --- |
| `interview-stream-view.module.css` | 52 |
| `repository-select-screen.module.css` | 9 (`#a3a3a3`·`#fafafa`, 중립 회색) |
| `experience-candidate-detail.module.css` | 7 (확인됨·미확인 의미색) |
| `button.module.css` | 4 (`#404040`·`#d4d4d4`) |
| `code-panel` · `interview-screen` · `paar-panel` · `resize-handle` | 0 |

다른 모듈의 하드코딩은 토큰 스케일 안의 중립 회색이거나 의도된 의미색인데 대화 열만 별도 보라
팔레트를 통째로 들고 있었습니다. 버튼만 고치는 선택지를 사용자에게 제시하면서 권하지 않는다고
적었습니다. 절반만 고쳐진 상태가 되기 때문입니다.

## 2. Constraint를 넘는 판단을 받았습니다

이슈 #98의 Constraint는 `InterviewStreamView`를 손대지 말라고 합니다. backlog 22·23번으로 미뤄
두었는데, 사용자가 "관련한 후속 이슈로 예정되어 있는 건이 따로 없어. 이번 이슈 작업에서 끝내야
해"라고 답해 이번 PR에서 닫기로 했습니다.

Constraint의 목적이 스트리밍 동작을 지키는 것이지 팔레트를 보존하는 것이 아니라고 판단해 색과
문구만 옮기고 다음 셋은 건드리지 않았습니다. 자동 스크롤과 그 의존 키, 낭독 경계(`role="log"`의
`aria-live="off"`와 상태 문단의 `polite`), `InterviewMessage`의 `memo` 경계와 미완성 코드 블록을
highlight하지 않는 규칙입니다.

## 3. 오류 문구가 네 층에서 온다는 것을 도중에 알았습니다

화면 컴포넌트의 문구를 옮기고 테스트를 돌리는데, 오류 상자 안에 한국어가 남았습니다. `error.message`가
화면이 아니라 아래 층에서 올라오고 있었습니다.

```
화면 컴포넌트        errorGuidance()가 붙이는 안내
  └ 클라이언트 오류   errors.ts, candidate-client.ts
     └ API 라우트     route.ts가 내려보내는 message
        └ 호출 계층   llm-error.ts, lib/github/*, schema.ts
```

`${error.message}`로 끼워 넣는 자리가 많아 아래 층을 빼놓으면 영어 문장 안에 한국어가 박힙니다.
그래서 범위를 넓혀 호출 계층까지 함께 옮겼습니다. `llm-error.ts`가 `ExperienceCandidateOutputError`를
만들지만 `src/features/interview/` 소유이고 질문 생성 경로에서만 쓰인다는 것을 확인해, 후보 생성
화면에 영향이 없음을 먼저 확인하고 손댔습니다.

## 4. 무엇을 옮기고 무엇을 둘지 기준을 세웠습니다

사용자가 "아직 한국어인 곳도 그냥 지금 처리해줘"라고 해서 저장소 전체를 훑었더니 파일 30개가
나왔습니다. 전부 옮기면 안 되는 것이 섞여 있어 기준을 먼저 정했습니다.

**누가 쓴 문장인가**입니다. 서비스가 쓴 껍데기는 영어로 옮기고, 모델이 쓰는 문장과 모델에게 주는
문장은 한국어로 둡니다. 이 서비스는 한국어로 인터뷰하므로 질문·답변·후보 제목·부족 사유는
콘텐츠이지 껍데기가 아닙니다.

이 기준으로 프롬프트(`question-prompt.ts`, `stage-a.ts`, `stage-b.ts`, `block-prompt.ts`,
`work-unit-summary.ts`), 모델 픽스처(`question-fixture.ts`, `test-stream.ts`), 한국어 커밋 메시지를
걸러내는 정규식(`commit-blacklist.ts`, `work-unit-score.ts`의 `/revert|hotfix|긴급/`), 아직 화면에
없는 `experience-block/*`을 남겼습니다. 약 130개를 옮겼습니다.

`insufficientCandidatesReason`은 모델이 만드는 문장이라 그대로 두고, 그 뒤에 붙는 서비스 문장만
영어로 옮겼습니다. 한 문단 안에 두 언어가 섞이지만 채팅과 같은 구조라 맞다고 봤습니다.

## 5. 영어로 옮기면서 생긴 문제

절단 안내가 `"1 question-and-answer pairs ... were dropped"`가 되었습니다. 한국어에 없던 단수·복수
문제입니다. `candidate-period.ts`의 `pluralCount`를 재사용해 명사는 해결했지만 동사가 남았습니다.
`animation-delay`처럼 한 규칙으로 못 푸는 자리라, 동사가 개수에 따라 바뀌지 않도록 주어를 이력 쪽으로
옮겼습니다. `"the history sent with the next question drops N question-and-answer pair(s) starting
here"`입니다.

## 6. 실패와 우회

한글이 든 치환 목록을 bash heredoc으로 Python에 넘기는 방식이 여러 번 깨졌습니다.

- 파일이 CRLF인데 패턴의 `\n`이 `\r\n`과 맞지 않아 여러 줄 패턴 12개가 전부 빗나갔습니다. 스크립트
  안에서 개행을 파일 쪽에 맞추도록 고쳤습니다.
- 그 수정을 다시 `python -c`로 넣다가 이스케이프가 풀려 스크립트가 문법 오류로 깨졌습니다.
- 백틱이 든 문자열을 bash에 넘기면 명령 치환이 일어납니다. 위키에 코드 블록을 추가할 때 실제로 두
  블록이 빈 채로 들어갔고 Edit 도구로 복구했습니다.

결론은 **긴 치환 스크립트는 Write 도구로 파일에 쓴 뒤 실행한다**입니다. 이후 그렇게 했습니다.

## 7. 함께 정리한 것

- 초점 표시 `rgba(109, 99, 232, .25)` 계열 세 가지를 `2px solid var(--color-foreground)` 하나로
  통일했습니다. `code-panel.module.css`·`button.module.css`와 같은 규칙입니다.
- 알약 `border-radius: 999px`를 `var(--radius)`로 바꿨습니다.
- **버튼 높이를 44px에서 32px로 줄였습니다.** 개편된 화면의 버튼이 전부 32px이고 헤더 옆에서 44px
  알약이 홀로 커 보였습니다. 44px을 정한 결정을 위키에서 찾지 못했습니다. 터치 목표가 작아지는
  변경이라 보고에 적었고 사용자가 되돌리라고 하지 않았습니다.
- backlog 23번(`RepositoryFlow` 이탈 확인 모달)도 닫았습니다. 같은 일을 하는 확인 둘의 언어가
  갈려 있었습니다.

## 8. 고치지 못한 것

highlight된 코드 블록은 shiki가 `<pre>`에 배경을 인라인으로 박아 `.codeBlock pre`의 배경이 닿지
않습니다. highlight 전(회색)과 후(흰색)의 배경이 다릅니다. `!important` 없이는 못 고쳐 손대지
않았고 테두리·라운드·여백만 두 경로에 같이 걸었습니다.

## 9. 남긴 확인 필요

기여 항목 입력의 안내와 placeholder는 **디자인 원본에도 한국어**입니다(`App.tsx` 530행). 이 두
문장만 `--font-pretendard`를 쓰는 것도 그래서입니다. 프로젝트 공통 결정(영어 문구)을 따라 옮겼지만
디자인과 어긋나므로 확인이 필요합니다. placeholder는 사용자가 한국어로 쓸 예시 문장이라 더
그렇습니다.

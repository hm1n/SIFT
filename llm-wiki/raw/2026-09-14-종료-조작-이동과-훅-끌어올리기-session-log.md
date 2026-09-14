# 종료 조작 이동과 훅 끌어올리기 세션 로그 (2026-09-14)

인터뷰 종료 버튼을 대화 열 아래에서 PAAR 패널 아래로 옮긴 작업입니다. 구현 자체는 같은 워크트리의
다른 세션(`html-css-design-3-d4`)이 했고, 이 세션은 충돌 점검과 ponytail 리뷰와 반영과 커밋을
맡았습니다. 도달한 결론은 `wiki/2026-09-14-인터뷰-3열-워크스페이스.md` 16절에 있습니다.

같은 시각에 진행한 다른 주제는 `raw/2026-09-14-diff-색-구분-session-log.md`입니다.

## 1. 내가 만지지 않은 파일이 테스트 중에 바뀌었습니다

이 세션에서 제일 시간을 쓴 것은 구현도 리뷰도 아니고 **이 상황을 알아차리는 것**이었습니다.
시간순으로 적습니다.

diff 색 작업을 끝내고 전체 스위트를 돌렸습니다.

```
Test Files  5 failed | 66 passed (71)
     Tests  2 failed | 1075 passed (1077)
```

실패 목록을 보려고 바로 다시 돌렸습니다.

```
Failed Tests 59
```

**같은 트리에서 두 번 돌렸는데 실패가 2건에서 59건으로 뛰었습니다.** 총 테스트 수도 1077로,
직전 기준선 1157보다 적었습니다. 파일 몇 개가 아예 수집되지 않았다는 뜻입니다.

여기서 처음 든 생각은 "내 변경이 뭔가 깨뜨렸나"였는데 실패 목록이 전부 `interview-stream-view`,
`interview-screen`, `experience-selection`이었습니다. 저는 `code-panel` 계열 4개만 만졌습니다.

오류를 하나 꺼내 봤습니다.

```
ReferenceError: streamOptions is not defined
 ❯ InterviewStreamView src/features/interview/interview-stream-view.tsx:365:43
```

제가 열어 본 적도 없는 파일입니다.

### 판별한 방법

`git status --short`에 11개가 M으로 떠 있었습니다. 제가 고친 건 4개입니다. 세션 시작 시점의
git status는 clean이었습니다.

mtime을 찍었습니다.

```
17:00:11  interview-stream-view.tsx
17:00:36  paar-panel.tsx
17:01:08  paar-panel.module.css
17:01:32  interview-stream-view.module.css
17:02:01  interview-screen.tsx / use-interview-stream.ts
17:02:26  interview-stream-view.test.tsx
```

30초 간격으로 순차적입니다. 사람의 편집 속도가 아니고, 전부 **제 테스트 실행 구간 안**입니다.

`ListAgents`를 불렀습니다.

```
html-css-design-3-d4 [e047d1]  ·  interactive  ·  busy  ·  started 13m ago
```

같은 워크트리에 다른 세션이 떠서 지금 쓰고 있었습니다. 59건은 그쪽의 중간 상태였습니다.

### 남길 것

같은 상황을 다시 만났을 때의 판별 순서입니다.

1. 실패 수가 재실행만으로 크게 달라지면 트리가 움직이고 있다고 의심합니다.
2. 오류가 내가 만지지 않은 파일에서 나면 `git status`로 수정 파일 수를 먼저 셉니다.
3. mtime이 초 단위로 나란하면 사람이 아니라 다른 에이전트입니다.
4. `ListAgents`로 확인합니다.

내 변경을 되돌려 가며 원인을 찾기 전에 이 넷을 먼저 봅니다. 되돌리기부터 시작했으면 멀쩡한 코드를
한참 뒤졌을 것입니다.

### 커밋하지 않고 멈춘 판단

파일 단위로는 겹침이 0이었으므로 제 4개만 경로 지정해 커밋할 수는 있었습니다. 접었습니다.

- 반쯤 들어간 남의 작업 때문에 typecheck·build를 통과시킬 방법이 없었습니다. 검증 없이 커밋하는
  것과 같습니다.
- 저쪽이 곧 커밋할 수 있고, 그러면 제 커밋과 순서가 엉킵니다.

사용자에게 상황을 알리고 멈췄습니다. 사용자는 두 세션을 띄운 것이 의도였다고 했고, 저쪽 작업이
끝난 뒤 둘 다 이 세션에서 커밋하기로 했습니다. 24분 뒤 다시 보니 마지막 쓰기가 17:05에서 멈춰
있었고 idle이었으며, 전체 스위트가 1160개 전부 통과했습니다.

## 2. ponytail 리뷰 4건

구조 자체는 맞게 잡혀 있었습니다. 종료 버튼이 오른쪽 열로 가면 종료 상태를 읽는 가운데 열과
형제가 되므로, 공통 부모인 `InterviewScreen`이 훅을 들어야 합니다. 그 대가로 이전 주석이 감수하던
"종료한 뒤 뒤로가기가 한 번 더 묻는" 문제가 사라졌고, 대신 "남은 대화가 지워지니 계속 묻는다"로
근거가 바뀐 것도 정확합니다.

지적은 넷이었습니다.

### `hasSnapshot` — 이게 핵심이었습니다

`InterviewStreamView`가 `stream`과 `hasSnapshot`을 따로 받고 있었습니다. prop 주석은 이렇게
적혀 있었습니다.

> 두 값을 따로 받으면 서로 어긋난 조합을 넘길 수 있으므로 갈라지기 전의 사실을 받습니다.

맞는 말인데 **한 단계 덜 갔습니다.** 갈라지기 전의 사실을 받았지만, 그 사실과 `stream`이 여전히
따로 넘어옵니다. 스냅샷이 있는 훅의 `stream`에 `hasSnapshot={false}`를 붙일 수 있습니다. 주석이
경계하던 바로 그 어긋남입니다.

`snapshot`을 실제로 받는 것은 훅입니다. 판정을 `InterviewStreamState`로 올렸습니다. 그러면
`InterviewStreamView`는 prop이 `stream` 하나가 되고, 어긋난 조합을 표현할 방법 자체가 사라집니다.
주석이 막던 것을 타입이 막습니다.

### `DEFAULT_INTERVIEW_STREAM_URL`

`url`이 필수 옵션인데 호출부 3곳이 전부 같은 상수를 그대로 넘기고 있었습니다. 아무도 바꾸지 않는
설정입니다. 훅 시그니처 기본값으로 내리고 export와 pass-through를 지웠습니다. 테스트 하네스의
`Omit<UseInterviewStreamOptions, "url">`도 `UseInterviewStreamOptions`로 돌아갔습니다.

### `.endConfirmButton`

`.endButton`에서 `width: 100%`만 뺀 같은 선언이었습니다. hover도 같습니다. 그런데 그 `width`는
부모 `.endActions`가 `display: grid`라서 어차피 늘어납니다. 한 클래스로 합쳤습니다. 합친 클래스가
`width: 100%`를 갖지만 grid 안에서도 `.footer` 블록 안에서도 맞습니다.

### `` `${useId()}-end-confirm` ``

`useId()`는 이미 고유하고 이 컴포넌트의 id는 하나입니다. 접미사가 하는 일이 없습니다.

## 3. 예측한 줄 수와 실제가 달랐습니다

리뷰에서 `net: -14 lines possible`이라고 적었는데 실제 반영 결과는 **-6**이었습니다.

```
반영 전   195 insertions, 117 deletions
반영 후   195 insertions, 119 deletions   (insertions는 199 → 195)
```

지운 주석 자리에 설명을 새로 썼기 때문입니다. 훅 state의 `hasSnapshot` 설명, `url` 기본값 근거,
합친 버튼의 `width` 근거 셋입니다. 줄 수만 보면 손해가 반쯤 상쇄됐지만, 설명이 사실의 출처 쪽으로
옮겨 간 것이라 그대로 뒀습니다.

**ponytail의 줄 수 예측은 주석을 지우는 쪽만 세고 대체 설명을 쓰는 쪽은 안 셉니다.** 다음에 예측을
적을 때는 그 차이를 감안하거나, 예측 대신 실측만 보고하는 편이 낫습니다. 이번에는 예측을 그대로
보고했다가 실제와 두 배 넘게 벌어져 정정했습니다.

## 4. bash 도구에 PowerShell here-string을 썼습니다

첫 커밋에서 이렇게 썼습니다.

```
git commit -m @'
feat: ...
'@
```

이 환경의 Bash 도구는 Git Bash라서 `@'...'@`가 문자열 구문이 아닙니다. `@`가 인자로 그대로 들어가
커밋 제목이 `@ feat: ...`이 되고 본문 끝에 `@`가 한 줄 더 붙었습니다.

`git log -1 --format=%B | cat -A`로 확인하고 `git commit --amend -F -`에 진짜 heredoc으로
다시 넣었습니다.

도구 설명에 이미 적혀 있는 내용입니다(`Do not use PowerShell here-strings`). 이 세션에서 PowerShell
도구와 Bash 도구를 번갈아 쓰다 섞였습니다. 앞선 세션의 `python -c`에 백틱을 넣어 명령 치환이 일어난
것과 같은 계열입니다 — **셸이 먼저 읽는 문자를 문자열 안에 그냥 두지 않습니다.**

같은 맥락으로 `cd llm-wiki`를 한 번 썼는데 Bash 도구의 작업 디렉터리는 호출 간에 유지돼서 이후
상대 경로가 전부 어긋날 뻔했습니다. 절대 경로나 `cd <절대경로> &&`로 매번 고정하는 편이 안전합니다.

## 5. 커밋을 둘로만 나눈 이유

훅 끌어올리기를 `refactor:`로 떼는 안을 검토했습니다. 접었습니다.

떼려면 "훅은 화면이 들되 종료 버튼은 아직 대화 열에 있는" 중간 상태를 만들어야 하는데, 그 상태는
실제로 존재한 적이 없고 제가 남의 작업에서 역산해 재구성해야 합니다. 재구성한 중간 커밋은 빌드와
테스트를 각각 따로 통과시켜야 의미가 있고, 그 비용이 분리의 이득보다 큽니다.

AGENTS.md의 규칙은 **관련 없는** 변경을 섞지 말라는 것입니다. 훅 끌어올리기는 종료 버튼 이동의
전제라 관련이 없지 않습니다. 한 커밋에 뒀습니다.

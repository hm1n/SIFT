# 화면 문구 토스 라이팅 원칙 적용 세션 로그

`raw/2026-09-15-화면-문구-레퍼런스-대조와-중앙화-session-log.md`를 이어받습니다. 문구를 `src/copy/` 6개 파일로 모은 다음, 그 문구들을 토스의 8가지 라이팅 원칙(https://toss.tech/article/8-writing-principles-of-toss) 기준으로 다시 읽고 고친 세션입니다.

세션이 사용량 초과로 한 번 끊겼습니다. 앞 세션은 검토표를 만들고 승인을 받은 뒤 `src/copy/shell.ts`, `auth.ts`, `repository.ts`, `candidates.ts`까지 커밋했고, `interview.ts`는 파일만 고쳐 둔 채 커밋하지 못했습니다. 이 로그는 이어받은 세션의 기록입니다.

## 이어받은 시점의 상태

- 커밋 3개가 올라가 있었습니다. `e90fd62`(로그인과 공용 셸), `36b6d3b`(Repository 선택과 분석), `73448df`(경험 후보와 근거).
- 작업 트리에 `src/copy/interview.ts`와 `candidates.ts`, 테스트 6개가 uncommitted 상태였습니다.
- `src/copy/saved.ts`는 손대지 않은 상태였습니다.

## 시간순 경위

### 1. `interview.ts` 라운드 마감

검토표의 interview 항목 45건이 이미 반영돼 있었습니다. 남은 문제는 하나였습니다. `CODE_PANEL_COPY.budgetTrimmed`가 새 문구에서 토큰 상한을 더 이상 쓰지 않는데 `(_maxTokens: string, patchBytes: string)` 시그니처가 남아 있었습니다. 호출부 `code-panel.tsx:170`에서 `snapshot.patchBudget.maxInputTokens`를 계속 넘기고 있었습니다.

인자를 지우고 호출부를 한 줄로 줄였습니다. 미사용 인자를 `_` 접두어로 덮어 두면 lint는 통과하지만, 화면에서 뺀 값을 계속 계산해 넘기는 코드가 남습니다.

`src/features/interview`와 `src/copy` 테스트 370개가 통과해 `b77b1b1`로 커밋했습니다.

### 2. 전체 테스트에서 드러난 12건의 선행 실패

`saved.ts`를 고치기 전에 전체 테스트를 돌렸더니 18건이 실패했습니다. 이 중 12건이 이번에 고친 `saved.ts`와 무관한 실패였습니다.

원인을 가르기 위해 작업분을 `git stash push -u -m "wip-saved-copy-451"`로 떼어내고 HEAD에서 다시 돌렸습니다. 12건이 그대로 실패했습니다. **앞 세션의 커밋 3개가 화면 문구만 바꾸고 그 문구를 조회하는 테스트를 갱신하지 않은 채 커밋된 것**이었습니다.

| 갈래 | 건수 | 깨진 커밋 |
| --- | --- | --- |
| `login-screen.test.tsx`의 제목·설명·`auth_error` 4종·`GitHub에 연결 중...` | 7 | `e90fd62` |
| `page.test.tsx`의 `state_mismatch` 문구 | 1 | `e90fd62` |
| `색인되지 않은 커밋 · {sha}` 조회 4건 | 4 | 이번 세션의 `b77b1b1`이 `candidates.ts`의 같은 문구를 함께 옮기면서 발생 |

앞 두 갈래는 앞 세션이 테스트를 돌리지 않고 커밋했다는 뜻입니다. `feat: 로그인과 공용 셸 문구 개선` 시점부터 브랜치가 red였습니다.

세 번째 갈래는 이 세션이 만들었습니다. `COMMIT_NOT_INDEXED_TITLE`을 `interview.ts` 라운드에 끼워 커밋했는데, 그 문구를 조회하는 테스트는 `experience-candidates`와 `repository-analysis` 쪽에 있어 같은 커밋 안에서 잡히지 않았습니다.

`test: 문구 개선에 뒤따르지 못한 기대 문구 갱신`(`5ce8010`)으로 12건을 한 커밋에 모았습니다. 원인이 "문구 커밋이 테스트를 데려가지 않았다" 하나라서 갈래별로 쪼개지 않았습니다.

### 3. `saved.ts` 라운드

검토표의 7건을 반영했습니다. `reference-ko.test.ts`의 `loadingSavedInterviews`에 말줄임표 통일 사유로 deviation을 추가했습니다. 검토표가 지목한 `reference-ko.test.ts` 항목 7개 중 나머지 6개는 앞 세션이 이미 반영해 둔 상태였습니다.

`saved-interview-list.test.tsx` 1건과 `saved-interview-screen.test.tsx` 5건의 기대 문구를 같은 커밋에서 갱신했습니다. 이번에는 문구와 테스트를 한 커밋에 넣었습니다.

전체 테스트 1,651개, lint, typecheck 통과 후 `18c30a4`로 커밋했습니다.

## 접은 대안

- **`budgetTrimmed`의 `maxInputTokens`를 인자로 남기기.** 나중에 다시 화면에 노출할 수 있다는 이유로 남길 수 있었지만, 지금 쓰지 않는 값을 계산해 넘기는 코드가 남습니다. 필요해지면 `snapshot.patchBudget`에서 다시 꺼내면 됩니다.
- **선행 실패 12건을 갈래별로 3커밋으로 나누기.** 파일과 화면이 갈리지만 원인이 하나라 한 커밋으로 묶었습니다. `AGENTS.md`의 "한 가지 근본 원인이 여러 지점에서 드러나는 경우에는 그 지점들을 하나로 묶어서 보고합니다"를 커밋 단위에도 적용했습니다.
- **문구 상수와 테스트 기대값을 한 자리에서 읽게 만드는 장치 도입.** 화면 테스트가 문구를 문자열 리터럴로 들고 있어 이번 같은 누락이 다시 생길 수 있습니다. 이번 이슈 범위 밖이라 backlog로 넘겼습니다.

## 남은 것

- 실제 앱 구동 확인. 앞 세션에서도 남아 있던 항목입니다.
- Pull Request.
- 화면 테스트가 문구를 리터럴로 드는 구조. 디자인 개편 backlog에 추가했습니다.

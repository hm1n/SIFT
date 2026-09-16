# 화면 문구 누락 정정 세션 로그

2026-09-16. 이슈 #128의 완료 여부를 다시 훑은 세션입니다. 결론은 `wiki/2026-09-15-화면-문구-한국어-전환.md`의 "중앙화가 한 파일을 통째로 옮기지 않은 사고" 절에 있습니다.

## 발단

토스 라이팅 원칙 적용을 다른 세션에서 끝낸 뒤, 사용자가 이슈 Goal 달성 여부와 빠진 부분을 확인해 달라고 했습니다.

## 훑는 방법

이슈 Tasks와 Definition of Done을 항목별로 확인했습니다. 날짜 로케일, `pluralCount` 유지, 줄바꿈 CSS, 상태 문구 개수, 경계표 준수는 전부 맞았습니다.

남은 영어를 찾는 데는 스크립트를 썼습니다. 따옴표로 감싼 문자열 리터럴 중 한글이 없고 4자 이상 영어 단어가 둘 이상 이어지는 것을 뽑습니다. 경계표가 영어로 남기기로 한 항목(섹션 라벨, 상태 코드, 태그)은 대개 한 단어라 이 기준에 걸리지 않습니다.

1차 결과는 import 경로와 HTTP 헤더가 대부분이었습니다. 화면에 닿는 것만 남기려고 2차 스크립트를 따로 썼습니다. 화면이 `error.message`를 그대로 그리는 오류 타입 셋(`InterviewStreamError`, `ExperienceCandidateOutputError`, `GitHubFetchError`)의 생성자 인자에서만 문자열을 뽑았더니 잡음 없이 20건이 나왔고, 그중 `src/lib/github/**`(이슈 Non-goal) 16건을 빼면 넷이 남았습니다.

## 도구가 거짓말을 한 지점

`smart_grep`이 **낡은 캐시를 돌려줬습니다.** `pluralCount`를 검색하니 중앙화 이전 코드가 나와서, `experience-candidate-list.tsx`에 영어 문구가 그대로 남아 있는 것처럼 보였습니다(`${pluralCount(...)} found`, `excluded for exceeding what one request can carry`). 실제 파일을 `sed`로 열어 보니 전부 `CANDIDATE_LIST_COPY`를 쓰고 있었습니다. 같은 도구가 `ko-KR|DateTimeFormat|pluralCount` 정규식 대안 검색에는 0건을 돌려줬는데 개별 검색에는 6건이 나왔습니다.

**판정 근거로 쓸 때는 실제 파일을 다시 열어 확인해야 합니다.**

## 찾은 것

넷 다 `kind`는 맞고 `message`만 영어였습니다.

| 위치 | 분류 |
| --- | --- |
| `features/interview/llm-error.ts` | `schema_validation` |
| `features/interview/sse.ts` | `stream_interrupted` |
| `app/api/interview/stream/route.ts` | `body_too_large` |
| `features/experience-candidates/llm-provider.ts` | `llm_configuration` |

`llm-error.ts`가 가장 나빴습니다. 같은 함수의 다른 갈래 12개는 전부 `LLM_ERROR_COPY`를 쓰는데 하나만 리터럴이었고, `context` 인자는 이미 한국어라 한 문장 안에서 언어가 갈렸습니다.

`evidence-snapshot.ts`의 영어 `detail` 5건은 잡혔지만 화면에 닿지 않습니다. `question-prompt.ts`만 소비하는 프롬프트 입력이라 이슈 Non-goal입니다. `repository-client.ts`와 `api-contract.ts`의 `GitHubFetchError` 문구도 화면이 `kind`만 읽으므로 범위 밖입니다.

## 왜 안 드러났는지

세 안전장치가 모두 통과합니다.

- **타입.** message가 `string`이라 영어든 한국어든 같습니다.
- **기존 테스트.** `sse.test.ts`와 `llm-provider.test.ts`는 `kind`만 단정했습니다. `question-route.test.ts`도 `{ error: { kind: "body_too_large" } }`만 봤습니다.
- **`reference-ko.test.ts`.** 레퍼런스 `TRANSLATIONS.ko`와의 어긋남만 봅니다. 레퍼런스에 대응 항목이 없는 오류 문구는 이 표에 없습니다.

`src/copy/README.md`의 출처 목록에서도 `sse.ts`와 `llm-provider.ts`가 빠져 있었습니다. `llm-error.ts`는 목록에 있었는데도 일부만 옮겨졌습니다. 즉 목록이 있어도 파일 안에서 몇 건인지를 세지 않으면 소용이 없습니다.

## 고친 방법

문구 넷을 `src/copy/`로 옮겼습니다. `STREAM_DATA_UNREADABLE_MESSAGE`와 `QUESTION_REQUEST_COPY.bodyTooLarge`, `LLM_ERROR_COPY.schemaMismatch`는 `copy/interview.ts`에, `LLM_PROVIDER_COPY`는 `copy/candidates.ts`에 뒀습니다. 마지막 것은 `llm-provider.ts`가 후보 생성·블록 갱신·질문 생성 셋 모두의 모델을 만들어 분석 화면과 인터뷰 화면 양쪽에 그려지므로, 어느 화면 파일에 둘지가 애매했습니다. 모듈이 사는 도메인을 따랐습니다.

`stream_interrupted`는 분류를 나누지 않았습니다. 연결이 끊긴 것과 도착한 내용이 깨진 것은 사용자가 할 수 있는 일이 같습니다. 다만 알리는 사실이 다르므로 message만 갈랐고, 그 판단을 상수 주석에 적었습니다.

## 회귀 테스트

지적 넷마다 하나씩 붙였습니다. 셋은 기존 테스트에 message 단정을 더했고, `mapInterviewLlmError`는 테스트 파일이 없어 새로 만들었습니다.

새 파일에는 갈래별 단정 대신 **갈래 18개를 한 번에 훑는 단정**을 함께 뒀습니다. message에 한글이 있고 영어 단어가 둘 이상 이어지지 않는지 봅니다. 갈래가 늘어도 리터럴이 남으면 걸립니다.

`NoObjectGeneratedError` 생성자가 `response`·`usage`·`finishReason`을 요구하고 `usage`가 중첩 객체라 typecheck가 두 번 걸렸습니다. `inputTokenDetails`와 `outputTokenDetails`의 필드까지 `undefined`로 채워야 통과합니다.

**장치가 실제로 무는지 확인했습니다.** `schemaMismatch` 호출을 원래 영어 리터럴로 되돌려 보니 두 테스트가 실패했고, 되돌리니 19개가 다시 통과했습니다.

## 남긴 것

- 화면에 닿는 message 전체를 한 자리에서 훑는 장치는 만들지 않았습니다. backlog 33번입니다.
- `repository-flow.test.tsx`의 "저장되지 않은 답변이 있으면 확인을 먼저 받는다"가 첫 전체 실행에서만 `alertdialog` 미발견으로 실패하고 단독 실행과 재실행에서는 통과했습니다. 그 실행만 environment 230초(재실행 57초)라 부하 상황에서만 드러나는 자리로 보입니다. 원인을 확인하지 못해 고치지 않았고, 이슈 범위 밖이라 사용자에게 보고만 했습니다.

## 결과

테스트 1,670개(신규 19개), lint, typecheck 통과.

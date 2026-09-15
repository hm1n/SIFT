<!-- @format -->

# 화면 문구

사용자가 화면에서 읽는 문구를 모읍니다. 화면마다 흩어져 있던 것을 이슈 #128에서 여기로 옮겼습니다.

## 왜 모으는가

문구가 39개 파일에 흩어져 있어 레퍼런스(`Chat Interface Design`의 `App.tsx` `TRANSLATIONS.ko`와 `src/imports/pasted_text/*.md`)와 1:1로 대조할 수 없었습니다. 그래서 레퍼런스에 한국어 답이 이미 있는 문구 6개를 못 보고 직접 번역했고, 번역체가 화면에 나갔습니다. 경위는 `llm-wiki/wiki/2026-09-15-화면-문구-한국어-전환.md`에 있습니다.

모아 두면 셋을 얻습니다. 레퍼런스와 기계적으로 대조할 수 있고, 빈 상태 문구끼리 말투가 맞는지 붙여 놓고 볼 수 있고, 같은 문구가 여러 화면에 복제되는 것을 막습니다.

## 무엇을 담는가

**화면에 그려지는 문구만** 담습니다. 판별 기준은 그 문자열이 DOM에 닿는지입니다.

담습니다.

- 화면 컴포넌트가 그리는 모든 문구
- 화면이 `error.message`를 그대로 그리는 오류 문구. 그 자리는 둘뿐입니다. `interview-stream-view.tsx`의 오류 박스와 `repository-analysis-view.tsx`의 `StatusScreen` sub입니다. 그래서 그 두 경로로 흘러드는 서버 문구(`api/candidates/**`, `api/interview/stream`, `llm-error.ts`, `schema.ts`, `candidate-client.ts`, `question-request.ts`, `question-stream.ts`)까지 여기 있습니다.

담지 않습니다.

- 화면이 `kind`만 읽고 문구는 따로 쓰는 오류의 원문. `src/lib/github/**`, `features/*/request.ts`, `api/interviews/**`, `api/interview/experience-block`이 여기 해당합니다. 이 값들은 로그와 디버깅용이라 도메인 코드 옆에 두는 편이 낫습니다.
- AI 프롬프트(`question-prompt.ts`, `block-prompt.ts`, `stage-a.ts`, `stage-b.ts`). 사용자가 읽는 글이 아니라 모델에 주는 지시입니다.
- mono로 그리는 영어 라벨과 상태 코드. 번역 대상이 아니므로 쓰는 자리에 그대로 둡니다. 경계는 위 위키의 표에 있습니다.

## 어떻게 쓰는가

화면 단위로 파일을 나눕니다. 한 파일에 300개를 몰면 찾기 어렵습니다.

| 파일 | 범위 |
| --- | --- |
| `shell.ts` | 공용 셸, 상단 헤더, 계정 메뉴, 문서 metadata |
| `auth.ts` | 로그인 화면과 OAuth 오류 |
| `repository.ts` | Repository 선택, 분석 진행, 분석 실패 |
| `candidates.ts` | 경험 후보 목록과 상세, 근거 구분, 선별 신호 |
| `interview.ts` | 인터뷰 워크스페이스, 대화, PAAR 패널, 코드 패널 |
| `saved.ts` | 저장된 인터뷰 목록과 요약 |

값이 끼거나 조건으로 갈리는 문구는 상수가 아니라 함수로 둡니다. 억지로 문자열 하나로 만들면 호출부가 문자열을 이어 붙이게 되고, 그러면 문구가 다시 화면 파일로 새어 나갑니다.

이 디렉터리는 잎 모듈입니다. 기능 코드에서 타입과 상한값만 `import type`이나 상수로 가져오고, 기능 코드를 실행 시점에 부르지 않습니다.

# 2026-09-11 Stage A 판단 단위 식별자 형식 불일치 세션 로그

이슈 [#107](https://github.com/hm1n/SIFT/issues/107) 대응 세션입니다. 이슈 #101에서 Stage A의 판단
식별자를 PR 번호에서 `unitId`로 바꾸며 생긴 회귀를 다뤘습니다.

## 원인 확인

이슈가 지목한 파일 네 곳을 읽고 원인을 다음과 같이 좁혔습니다.

- `work-unit-summary.ts`의 `renderUnitLabel`이 `pr:74`를 `PR#74`로, `commit:82dbaa1`을
  `커밋 82dbaa1`로 **표기를 바꿔서** 머리줄을 찍고 있었습니다.
- `stage-a.ts`의 시스템 프롬프트는 그 표기를 모델에게 **되돌려서** 답하라고 요구하고 있었습니다
  (`'PR#12' → 'pr:12'`).
- 응답 검증(`stage-a.ts`의 `shaByModelUnitId`)은 `modelFacingUnitId` 기준 정확 일치입니다.
  되돌리기에 실패한 응답은 전량 `unknown_sha`가 됩니다.

즉 PR 단위의 `PR#74` 복사와 단일 커밋 단위의 `commit:82` 잘림은 서로 다른 버그가 아니라, 보여주는
문자열과 요구하는 문자열이 다르다는 한 원인의 두 단면입니다.

## 접은 대안

검증 쪽에서 `PR#74`를 함께 받아주는 방식을 먼저 검토했다가 접었습니다. 같은 관대함이 단일 커밋
단위의 잘린 식별자(`commit:82`)까지 받게 만들고, 잘린 SHA는 어느 커밋을 가리키는지 확정할 수 없어
잘못된 커밋에 판정이 붙습니다. 이슈 #101에서 이미 같은 종류의 사고를 막으려고 자르는 자리수를
`modelFacingUnitId` 한 곳으로 모아 둔 상태라, 검증을 느슨하게 푸는 방향은 그 결정과 정면으로
충돌합니다.

## 반영

- `renderUnitLabel`을 `modelFacingUnitId(summary.unitId)` 반환만 하도록 줄였습니다. 접두어와
  자르는 자리수를 정하는 곳이 `modelFacingUnitId` 하나로 완전히 모였습니다.
- 시스템 프롬프트의 머리줄 서술을 `'pr:번호 ...'`와 `'commit:SHA7자리 ...'`로 고치고, 변환 지시
  문장을 "머리줄 맨 앞의 식별자를 한 글자도 바꾸지 말고 그대로 옮겨 쓴다"로 바꿨습니다.
- 이슈에 지적되지 않았지만 로컬 모델 전용 지시(`localInputScopeHint`)도 `'PR#번호'`와
  `'커밋 SHA7자리'`를 그대로 갖고 있어 함께 고쳤습니다. 프로덕션과 로컬이 서로 다른 형식을
  지시하게 두면 같은 원인이 다른 줄로 다시 나옵니다.
- 화면 라벨(`experience-candidate-list.tsx`의 `unitLabel`)은 그대로 뒀습니다. 모델과 주고받는
  문자열이 아니므로 `PR #113`, `커밋 abcdef1`이라는 사람이 읽기 좋은 형태를 유지합니다.

## 프롬프트 바이트 영향

이슈 Constraints가 요구한 확인입니다. 라벨의 UTF-8 길이를 재 보면 `PR#74`와 `pr:74`가 각각 5바이트,
`커밋 abcdef1`과 `commit:abcdef1`이 각각 14바이트로 델타가 0입니다. `STAGE_A_MAX_PROMPT_BYTES`와
`work-unit-selection.ts`의 선별 바이트 예산 모두 영향을 받지 않습니다.

## 회귀 테스트

- `work-unit-summary.test.ts` — PR 단위와 단일 커밋 단위 모두 머리줄 맨 앞이
  `modelFacingUnitId(unitId)`와 같은 문자열임을 고정합니다.
- `stage-a.test.ts` — 모델이 옛 표기(`PR#1`)로 답하면 `unknown_sha`로 거부합니다.
- `stage-a.test.ts` — 모델이 SHA를 7자리보다 짧게 잘라(`commit:82`) 답하면 `unknown_sha`로
  거부합니다. 앞 테스트와 한 쌍으로 "정확히 일치할 때만 받는다"는 계약을 고정합니다.
- 기존 기대 문자열 7곳을 새 표기로 갱신했습니다(`work-unit-summary.test.ts` 4곳,
  `stage-a.test.ts` 2곳, `route.test.ts` 1곳).

## 실측

`gemini-3.1-flash-lite`로 네 번 돌렸습니다. 모두 전수 응답 계약을 만족했습니다.

| 저장소 | 옵션 | 입력 묶음 | 응답 | 계약 충족 | 후보 | 소요 |
| --- | --- | --- | --- | --- | --- | --- |
| `hm1n/demian` | `--limit=223` | 41 | 41/41 고유 41 누락 0 중복 0 | true | 5/5 | 4,769ms |
| `hm1n/demian` | `--limit=120` | 18 | 18/18 고유 18 누락 0 중복 0 | true | 5/5 | 2,560ms |
| `hm1n/Andbread_Frontend` | 기본 | 23 | 23/23 고유 23 누락 0 중복 0 | true | 5/5 | 2,838ms |
| `hm1n/CAREER-CAMP-TIL` | 기본 | 39 | 39/39 고유 39 누락 0 중복 0 | true | 2/5 | 4,651ms |

고치기 전 이슈에 기록된 결과는 `demian` 41묶음과 `Andbread_Frontend` 23묶음이 각각 6회 시도 6회
모두 `unknown_sha` 실패, `--limit=120`이 `commit:82` 형태로 실패였습니다. `CAREER-CAMP-TIL`은 단일
커밋 단위만 있어 고치기 전에도 통과하던 저장소이고, 이번에도 회귀가 없습니다.

토큰 사용량은 `demian` 41묶음이 입력 8,646 출력 1,531 합계 10,177입니다.

`hm1n/demian` 41묶음 프롬프트는 27,650바이트로, 선별 예산 110,000바이트 안에 있습니다.

## 확인 필요

이번 실측은 저장소마다 1회씩입니다. 이슈의 실패 관측이 저장소마다 6회였던 것과 달리 반복 횟수가
적으므로, 모델이 간헐적으로 다시 표기를 흔드는지는 이 기록만으로 단정할 수 없습니다.

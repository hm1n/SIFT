# 2026-09-11 Stage B 후보 개수 상한과 출력 계약 세션 로그

이슈 [#108](https://github.com/hm1n/SIFT/issues/108) 대응 세션입니다. 같은 세션의 앞부분은 이슈
#107을 다뤘고 기록은 `2026-09-11-Stage-A-판단단위-식별자-형식-불일치-session-log.md`에 있습니다.

## 구현

이슈의 Approach 다섯 항목을 그대로 따랐습니다.

- `validateExperienceCandidateOutput`과 `parseExperienceCandidateOutput`이 후보 개수 상한을 인자로
  받게 했습니다.
- `experienceCandidateOutputSchema` 모듈 상수를 `createExperienceCandidateOutputSchema` 팩토리로
  바꿨습니다. 소비처는 `stage-b.ts` 한 곳이었습니다.
- `STAGE_B_MAX_CANDIDATES = 20`을 만들고 `buildStageBPayload`가 `candidateLimit`을 함께 돌려주게
  했습니다. Stage A 페이로드가 `candidateLimit`을 싣는 방식과 같습니다.
- 출력 계약을 프로덕션 프롬프트에 상시 포함하고 `localOutputContractHint` 갈래를 없앴습니다.
- `assertCandidateEvidence`에 Pull Request가 없는 대표 커밋 분기를 넣었습니다.

## 설계 판단 하나를 구현 도중 바꿨습니다

처음에는 모델 응답 검증에 `payload.candidateLimit`을 그대로 넘겼습니다. 기존 테스트 두 건이 바로
깨졌습니다. 같은 Pull Request 커밋 3개를 최종 후보로 돌려주는 응답은 판단 단위가 1개라
`candidateLimit`이 1인데, 개수 판정이 `dedupeCandidatesByWorkUnit`보다 먼저 돌아 502가 됐습니다.

이슈 Constraints의 "같은 Pull Request 후보 합치기를 유지하고 502로 거부하지 않는다"를 어기는
구현이었습니다. 검증 단계에서는 입력 커밋 수를 상한으로 쓰고, 판단 단위 상한은 정리가 끝난 뒤에
적용하도록 나눴습니다. 대표 SHA는 서로 달라야 하고 모두 입력 커밋이어야 하므로 입력 커밋 수가
검증 단계의 자연스러운 상한입니다.

## 회귀를 만들고 실측으로 찾았습니다

1차 구현으로 `hm1n/SIFT`를 재니 6회 중 1회만 성공했습니다. 실패는 개수 계약이 아니라 근거
검증이었습니다.

| 실패 종류 | 횟수 |
| --- | --- |
| `unknown_file_path` | 4 |
| `unrelated_sha` | 1 |

이번 변경이 만든 것인지 원래 있던 것인지 가르려고 변경 전 커밋(`2668480`)을 detached로 꺼내 같은
측정을 3회 돌렸습니다. 3회 모두 성공했고 최종 후보는 3개였습니다. 제 변경이 만든 회귀였습니다.

원인은 제가 쓴 계약 문장입니다. `citedFilePaths는 그 후보에 속한 커밋의 files[].path 값을 그대로
복사하세요`에서 "그 후보에 속한 커밋"을 모델이 묶음 전체로 읽었습니다. `assertCandidateEvidence`는
대표 커밋과 `relatedShas`에 적힌 커밋의 파일만 허용하므로, `relatedShas`를 비운 채 묶음의 다른
커밋 파일을 인용한 응답이 전부 거부됐습니다. 성공한 회차의 후보도 전부 `related=0`이었습니다.

변경 전 프로덕션 프롬프트에는 `relatedShas`를 비우라는 문장이 아예 없었습니다. 그 문장은 로컬 모델
전용 안내에만 있었고, 제가 계약을 상시화하면서 프로덕션까지 끌고 들어왔습니다.

고친 내용은 둘입니다.

- 인용할 경로가 있는 커밋은 `relatedShas`에 먼저 넣어야 한다는 관계를 문장에 적었습니다. 검증
  판정과 문장을 한 줄씩 대응시켰습니다.
- 과제 문장을 앞에, 출력 계약을 뒤에 두도록 순서를 되돌렸습니다. 변경 전 프로덕션 프롬프트가 그
  순서였습니다.

## 접은 대안

응답 검증에서 잘못된 인용 경로만 걸러내고 나머지 후보를 살리는 방식은 검토하지 않았습니다. 근거가
하나라도 어긋나면 전체를 거부한다는 기존 계약을 이번 이슈에서 바꿀 이유가 없습니다.

`STAGE_B_MAX_CANDIDATES`를 두지 않고 입력 판단 단위 수만 쓰는 안은 이슈에서 이미 접었습니다. 개수를
정하는 자리가 `STAGE_A_CANDIDATE_QUOTA` 한 곳으로 모이지만, Stage A 쪽이 잘못 커졌을 때 화면이 그대로
받습니다.

## 실측

`gemini-3.5-flash-lite`입니다. 세로 구분은 코드 상태입니다.

| 코드 | 저장소 | 판단 단위 | 결과 | 최종 후보 |
| --- | --- | --- | --- | --- |
| 변경 전 | `hm1n/SIFT` | 5 | 3회 중 3회 성공 | 3 |
| 1차 구현 | `hm1n/SIFT` | 5 | 6회 중 1회 성공 | 4 |
| 프롬프트 수정 후 | `hm1n/SIFT` | 5 | 3회 중 3회 성공 | 5 |
| 프롬프트 수정 후 | `hm1n/CAREER-CAMP-TIL` | 2 | 성공 | 2 |
| 프롬프트 수정 후 | `hm1n/programmers-badge-v1` | 1 | 성공 | 1 |

`hm1n/CAREER-CAMP-TIL`(2묶음)과 `hm1n/programmers-badge-v1`(1묶음)은 이슈에서 매번 실패하던
저장소입니다. 이제 판단 단위 수만큼 후보를 돌려주고 통과합니다.

`hm1n/programmers-badge-v1`은 이슈 #107을 고친 뒤 Stage A가 후보를 0개 고르게 바뀌어 Stage B가 1묶음을
받는 상황이 재현되지 않았습니다. `--skip-stage-a`로 1묶음을 강제해 측정했습니다.

`hm1n/SIFT`의 최종 후보가 3개에서 5개로 늘어난 것이 이번 이슈가 의도한 결과입니다. Stage A 쿼터가
5라 5가 현재 천장입니다.

## 측정 중 겪은 것

측정을 15회 넘게 돌린 뒤 GitHub core rate limit 5,000회를 소진했습니다. 측정 스크립트가 시작할 때
던지는 `GET /user`가 403을 받아 `rate limit probe 실패`로 중단됐습니다. 응답 헤더는
`x-ratelimit-remaining: 0`, `x-ratelimit-resource: core`였습니다.

`gh api rate_limit`은 같은 시점에 잔량 5,000을 보고했습니다. 이 엔드포인트는 한도를 소비하지 않고
조회 시점의 다른 창을 보여줍니다. 한도를 확인할 때는 실제 요청의 응답 헤더를 봐야 합니다.

## 확인 필요

프롬프트 수정 후 측정은 `hm1n/SIFT` 3회입니다. 1차 구현의 실패율이 6회 중 5회였던 것에 비하면
표본이 적습니다. 회귀가 완전히 사라졌는지는 더 많은 회차로 확인해야 합니다.

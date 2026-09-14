# PAAR 구현검토 P2 반영과 재검증 기록

날짜는 2026-09-11입니다. `raw/2026-09-11-PAAR-구현검토-반영-session-log.md`가 남긴 P1 다섯 묶음
반영에 이어, 사용자 요청(`P2도 반영해야 해. 재검증 라운드 돌려서 실측하고 반영해줘`)으로 구현검토
보고서의 P2 세 묶음을 처리하고 실측을 다시 돌린 경위입니다.

## 1. P2-1: 미확인 블록 예약 정책

`selectNextTarget`의 `unvisitedBlocks` 필터에 `evaluation[block] === null` 조건을 더했습니다.
`visited`만 보면 다른 답변에서 이미 평가받은 블록도 미확인으로 잘못 세어 예약 예산을 억지로
그쪽에 씁니다. 검토의 R8 재현을 회귀 테스트로 옮겼고(`progress.test.ts`), 기존 회귀와 함께
통과했습니다. 커밋 `e2e1b28`.

## 2. P2-3(선행): 측정 하네스와 운영 경로 대응

P2-2(판정 기준)를 재는 데 필요해 먼저 손댔습니다. `block-update.measure.mts`의 `nextQuestion` 호출이
`focus`(다음 시나리오 턴의 targetBlock·targetElement)와 `lastOutcome`을 싣지 않아 운영 경로보다
작은 입력을 재고 있었습니다(검토 8번). 다음 시나리오 턴이 있으면 그 대상을 focus로 쓰고, 마지막
턴이면 focus 없이 부르도록 고쳤습니다. `lastOutcome`은 `use-experience-interview.ts`가 쓰던
`buildLastOutcome`을 `history.ts`로 옮겨 훅과 하네스가 같은 함수를 쓰게 했습니다(커밋 `0ded168`,
`c5a9659`). 비용도 `blockSpent`·`questionSpent`로 나눠 집계하도록 바꿨습니다.

## 3. 실측

`--out=.measurements/block-update-2026-09-11-p2 --budget=1`로 46건을 다시 돌렸습니다. 실패 0건,
거절 시도 2회, 재시도까지 실패한 턴 1개(`split-problem-chain-t1`, 기존과 같은 "action 블록 평가
누락" 원인 — 새 결함이 아니라 backlog 2번의 알려진 한계가 재현된 것입니다). 비용은 블록 갱신
$0.02689, 질문 생성 $0.06933, 합계 $0.09622입니다. 28/46건(61%)에서 `lastOutcome`이 눈에 띄는
값으로 실렸습니다.

`action-conflict-t1`의 다음 질문을 직접 확인했습니다. 이전 실측(핸드오프 세션)에서는 모델이
EventSource를 실제 구현으로 전제하고 안전장치를 물었는데, 이번에는 `lastOutcome.conflicts`로
충돌을 알리자 "왜 EventSource가 아니라 별도 구현을 했는가"로 정확히 저장소 근거(runInterviewStream
직접 구현)를 전제로 물었습니다. `result-numbers`·`result-not-done` 계열도 이전에 배제된 구체적
수치를 다시 요구하지 않고 방법·설계 의도를 묻는 쪽으로 바뀌었습니다. 표본 1건씩이라 일반화하지
않습니다.

## 4. P2-2: 충분성·targetResponse 판정 기준

실측에서 `sufficient=true`가 이번에는 7건 나왔습니다(action-conflict-t3, multi-block-t1 2건,
multi-block-t3, problem-chain-t3·t4·t5). 이전 핸드오프 실측(46건)에서는 0건이었습니다. 같은
시나리오·같은 프롬프트인데 결과가 갈린 것은 모델 샘플링 변동으로 보이고, "merged 23턴에
sufficient=true가 없다"는 원래 지적은 재현성이 없었습니다.

다만 두 가지는 두 차례 실측 모두에서 그대로 재현됐습니다.

- `recall-t1`: "질문의 첫 조각이 오는 즉시 글자가 보이는 변화를 개발 화면에서 눈으로 확인했으며,
  수치는 측정하지 않았습니다"라는, 관찰과 확인 방법이 둘 다 있는 답변이 두 실측 모두 `not_done`으로
  닫혔습니다. `block-prompt.ts`의 평가 규칙이 "성과를 측정하지 않았다는 not_done"이라고만 적어
  두 요소가 정성적으로 채워진 경우까지 뭉뚱그렸습니다. **고쳤습니다.** "결과 블록의 두 요소는
  수치를 요구하지 않는다"는 문장을 더했고, `recall` 시나리오만 다시 돌려 두 변형 모두
  `sufficient=true`로 바뀌는 것을 확인했습니다(`.measurements/block-update-2026-09-11-p2-recall-check`,
  이후 삭제). `result-numbers`·`result-not-done`·multi-block 전체 철회처럼 실제로 관찰이 없거나
  철회된 경우는 여전히 `not_done`으로 남는 것도 별도로 확인했습니다(과교정이 아님). 커밋 `92f7241`.
- `problem-chain-t5`: targetElement가 problem.a인데 답변이 result 정보만 담았고, 반응 규칙(`이
  요소와 무관하면 unanswered`)대로라면 `unanswered`여야 하는데 두 실측 모두 `targetResponse=provided`로
  분류했습니다. 규칙 문구 자체는 이미 명시돼 있어(반응 규칙 문단) 모델이 지시를 따르지 않는
  경우로 보이고, 문구를 더 강하게 고친다고 해결된다는 근거가 없어 **고치지 않았습니다.** 확인
  필요로 남깁니다.

## 5. 재검증

사용자 요청의 "재검증 라운드"를 이 세션이 작성한 코드를 스스로 검증하는 것으로 대신하지 않고,
사전 맥락이 없는 새 에이전트에게 커밋 범위(`7dae055..HEAD`)와 원본 검토 보고서만 주고 P1 다섯
묶음의 수정이 실제로 맞는지, P2 코드 수정 두 건에 새 결함이 없는지 독립적으로 다시 보게 했습니다.
결과는 별도로 기록합니다(이 문서 작성 시점에는 아직 진행 중이었습니다).

## 6. 남은 것

- `problem-chain-t5`류의 targetResponse 분류 이슈는 여전히 열려 있습니다.
- P2 3번 항목(실측-운영 대응)의 하네스 수정은 끝났지만, 10턴 전체를 실제로 이어가며(`selectNextTarget`으로
  다음 대상을 정하고 실제 생성 질문을 다음 턴 질문으로 쓰는) 재는 실측은 아직 하지 않았습니다.
  지금 하네스는 여전히 각 시나리오 턴의 질문·답변이 손으로 쓰여 있고, 그 다음에 "실제로 생성됐다면
  어떤 질문이 나왔을지"만 참고용으로 붙입니다.

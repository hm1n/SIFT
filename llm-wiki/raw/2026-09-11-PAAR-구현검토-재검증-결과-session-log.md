# PAAR 구현검토 P1/P2 재검증 결과와 후속 수정

날짜는 2026-09-11입니다. `raw/2026-09-11-PAAR-구현검토-P2-재검증-session-log.md`가 진행 중이라고
남긴 독립 재검증(사전 맥락 없는 새 에이전트에게 커밋 범위 `7dae055..HEAD`와 원본 검토 보고서만 주고
P1 다섯 묶음·P2 코드 수정 두 건을 다시 보게 한 것)의 결과와, 거기서 나온 지적을 반영한 경위입니다.

## 재검증 결과

`npm run typecheck`·`npm run lint`·`npm test`(68개 파일, 1,120개)는 모두 통과한 상태에서 시작했습니다.
재검증 에이전트는 P1-1(재질문 카운팅), P1-2·P1-3(턴별 미반영 상태·비동기 취소 경계), P1-5(lastOutcome
배선), P2 예약 정책, P2 판정 기준 문구 다섯 항목은 각각 손으로 여러 시퀀스를 짚어 봐도 결함을
찾지 못했다고 보고했습니다. P1-3에서 사소한 P3 두 건(재시도가 겹치면 낭비되는 네트워크 호출,
`use-interview-stream.ts`의 `endInterview`에 언마운트 가드 누락, 둘 다 상태 훼손이나 요청 유발 없음)을
덧붙였습니다.

**P1-4는 "고쳤지만 불완전하다"는 P1급 지적을 받았습니다.** `canSubmitAnswer`에서 "마지막 메시지가
질문이어야 한다"는 조건을 없앤 것까지는 맞지만, `use-experience-interview.ts`의 `onBeforeQuestion`이
여전히 `history[length-2]`를 "질문", `history[length-1]`을 "답변"으로 가정하고 있었습니다. 보충
답변을 받으면 이력이 [...질문, 답변, 보충답변]이 되어 `history[length-2]`는 실제로는 답변인데
"질문"으로 잘못 읽힙니다. 더 심각하게는, 보충 답변으로 새 대상이 열리면 `useInterviewStream`이
이력을 [질문, 답변, 답변]으로 서버에 보내는데, `isWellFormedInterviewHistory`(`history.ts`)가
질문·답변 교대만 허용해 이 요청을 거절합니다(`invalid_request`). 이러면 다음 실제 질문 요청이 그
자리에서 끊깁니다. 원래 검토가 우려했던 "표시 버튼만 여는 것으로는 질문·답변 교대 이력 계약을
만족하지 못한다"는 지적이 실제로 재현된 것입니다. 기존 R7 테스트는 모든 블록이 계속 sufficient로
남는 픽스처를 써서 두 번째 `start()`가 한 번도 나가지 않아 이 경로를 재현하지 못했습니다.

## 반영

`canSubmitAnswer`를 "마지막 메시지가 질문"이라는 조건으로 되돌리고, 대신 `onBeforeQuestion`이 더
물을 유효한 대상이 없다고 판단하면(`"ready_to_finish"`) 완료 대기 안내 문구
(`READY_TO_FINISH_PROMPT`)를 "질문" 역할로 이력에 직접 넣도록 설계를 바꿨습니다. 이러면 보충
답변이 항상 실제 질문에 이어지는 정상적인 답변이 되어 질문·답변 교대가 절대 깨지지 않고,
`onBeforeQuestion`의 기존 추출 로직도 그대로 맞습니다.

`onBeforeQuestion`의 반환값을 `{target, lastOutcome} | null` 두 가지에서 `{kind:"ask",...}` /
`{kind:"ready_to_finish"}` / `{kind:"stop"}` 세 갈래로 넓혔습니다. 언마운트·열 턴 상한 도달은
안내 없이 `"stop"`으로, 완료 대기는 `"ready_to_finish"`로 구분했습니다(둘 다 이전에는 `null`
하나로 뭉쳐 있었습니다). `use-interview-stream.ts`의 `endInterview`에 재검증이 지적한 언마운트
가드도 함께 넣었습니다(수정 비용이 작아 같은 커밋에 포함, P2/P3 예외 규정).

`use-interview-stream.test.tsx`의 R7류 테스트(옛 "null 반환" 테스트)를 "stop"과 "ready_to_finish"
두 갈래로 나눠 다시 썼고, "ready_to_finish" 테스트는 보충 답변이 실제 새 질문을 여는 경로까지
따라가 서버로 가는 이력이 여전히 질문·답변 교대인지 직접 검증합니다(재검증이 지적한 바로 그 경로).
`use-experience-interview.test.tsx`의 기존 R7 테스트도 완료 대기 안내가 실제로 붙는지 확인하도록
갱신했습니다.

## 검증

`npm run typecheck`, `npm run lint`, `npm test`(68개 파일, 1,121개, +1)를 통과했습니다. 커밋
`b573940`.

## 남은 것

- 완료 대기 안내가 반복될 수 있습니다(보충 답변이 다시 done으로 이어지면 안내가 또 붙습니다).
  기능적으로는 안전하지만 화면(블록 패널, 하위 이슈 D)에서 이 반복을 어떻게 보여줄지는 아직
  결정하지 않았습니다.
- P1-3의 P3 두 건(겹친 재시도의 낭비 호출, `endInterview` 언마운트 가드 — 후자는 이번에 함께
  고쳤으므로 전자만 남음)은 후속 backlog로 남깁니다.

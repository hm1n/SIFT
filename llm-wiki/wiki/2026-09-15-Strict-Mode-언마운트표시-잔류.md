# Strict Mode에서 언마운트 표시가 남아 첫 답변 뒤 인터뷰가 멈춘 문제

이슈 #91 브라우저 확인 중에 발견했습니다. 원인은 #90에서 들어온 언마운트 가드이고 #91 범위 밖입니다.

## 1. 증상

경험 채팅에서 첫 질문은 정상으로 뜹니다. 그 질문에 답변하면 그 뒤로 아무 일도 일어나지 않습니다.

- 상태가 `connecting`("Connecting to the question stream.")에서 무한정 멈춥니다.
- PAAR 패널에 "Your latest answer hasn't been reflected yet."가 뜨고 Problem 카드가 미반영으로 표시됩니다.
- 네트워크 탭에 요청이 하나도 늘지 않습니다.

서버의 제한 시간(`INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS` 20초, `INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS` 55초)이 걸리지 않습니다. 요청 자체를 보내지 않기 때문입니다.

## 2. 원인

`use-experience-interview.ts`와 `use-interview-stream.ts`가 각각 언마운트 여부를 `unmountedRef`로 들고, 빈 의존성 배열 effect의 cleanup에서만 `true`로 바꿨습니다. setup에서 `false`로 되돌리는 코드가 없었습니다.

```ts
const unmountedRef = useRef(false);
useEffect(() => {
  return () => { unmountedRef.current = true; };   // setup 본문이 비어 있었습니다
}, []);
```

Next.js App Router는 개발에서 React Strict Mode를 켭니다(`next.config.ts`에 끄는 설정이 없습니다). Strict Mode는 effect를 setup → cleanup → setup으로 두 번 실행합니다. 첫 cleanup이 남긴 `true`를 두 번째 setup이 되돌리지 않으므로, **마운트된 훅이 마운트 직후부터 스스로를 언마운트됐다고 판단합니다.**

첫 질문 경로에는 이 검사가 없어 질문은 정상으로 뜹니다. 답변을 제출하는 순간부터 세 지점이 차례로 막힙니다.

| 위치 | 동작 |
| --- | --- |
| `use-experience-interview.ts` `runApplyTurn` 진입부 | 블록 갱신 요청을 보내지 않고 그 턴을 미반영으로 등록합니다 |
| `use-experience-interview.ts` `onBeforeQuestion` | `{ kind: "stop" }`을 돌려줍니다 |
| `use-interview-stream.ts` `onBeforeQuestion` 결과 콜백 | 그대로 반환해 `done` 처리도 하지 않습니다 |

세 번째 지점 때문에 `stop`이 화면에 도달하지 못해 상태가 `connecting`에 남습니다. 두 훅의 가드가 각각 독립적으로 잘못 켜지므로 한쪽만 고치면 증상이 남습니다.

## 3. 고친 방법

두 훅의 같은 effect setup에서 `unmountedRef.current = false`로 되돌립니다. cleanup은 그대로 둡니다.

언마운트 가드 자체를 없애지 않은 이유는 그 가드가 실제 결함을 막고 있기 때문입니다. 화면을 떠난 뒤 큐에 남은 `applyTurn`이 네트워크 요청을 계속 내보내는 문제(추가 재검증 2026-09-12, S4)와 언마운트 뒤 다음 질문 `start()`를 부르는 문제(구현검토 2026-09-11 P1-3, R5)가 그것입니다.

`useRef`를 `useState`나 모듈 변수로 바꾸는 방법도 있었으나, ref를 쓰는 이유가 렌더를 일으키지 않고 콜백 안에서 최신 값을 읽는 것이라 그대로 뒀습니다. 초기화 위치만 옮기면 충분합니다.

## 4. 테스트 1,339건이 잡지 못한 이유

`@testing-library/react`의 `renderHook`은 기본으로 Strict Mode를 쓰지 않습니다. 기존 테스트는 effect를 한 번만 실행하므로 cleanup이 돌지 않고 `unmountedRef`는 계속 `false`입니다. 언마운트 가드를 검증하는 기존 테스트도 `unmount()`를 명시로 불러 확인하므로 이 경로에 닿지 않습니다.

회귀 테스트는 `renderHook(..., { wrapper: StrictMode })`로 겁니다. 두 훅에 하나씩 뒀습니다.

- `use-experience-interview.test.tsx` — 답변 제출 뒤 블록 갱신 요청이 실제로 1건 나가고 `currentTarget`이 다음 블록으로 넘어가며 미반영이 남지 않는지 확인합니다.
- `use-interview-stream.test.tsx` — `onBeforeQuestion`이 정한 대상으로 다음 질문 요청이 나가는지 확인합니다.

두 테스트 모두 수정 전에는 실패하고 수정 후에 통과하는 것을 확인했습니다. Strict Mode에서는 자동 시작 질문 요청이 두 번 나가므로, 요청 횟수를 상수로 박지 않고 실제 요청 수를 세어 기준으로 씁니다.

## 5. 이번 조사에서 갈라낸 것

같은 시간대에 확인한 다른 두 문제는 원인이 다릅니다. 함께 묶지 않았습니다.

- `api.github.com`의 IPv6 조회 지연으로 첫 요청이 실패하는 문제(`wiki/2026-08-20-repository-데이터조회-후속-backlog.md` 9·10번).
- `.env`가 `OPEN_AI_API_KEY`로 정의돼 있고 AI SDK는 `OPENAI_API_KEY`를 읽는 문제. 블록 갱신 요청이 서버에 도달해도 실패합니다.

두 번째는 아직 고치지 않았습니다. `.env`는 직접 건드리지 않습니다.

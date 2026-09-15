# 경험 채팅 첫 답변 이후 로딩 멈춤 원인 확인

사용자가 첫 질문에 답한 뒤 다음 응답 없이 로딩이 계속되는 현상의 원인 확인을 요청했습니다. 서비스 코드는 수정하지 않았습니다.

## 조사

`useExperienceInterview`는 답변을 받으면 블록 갱신을 기다린 뒤 다음 질문의 대상을 정합니다. `useInterviewStream`은 이 작업 전에 상태를 `connecting`으로 바꿉니다.

두 훅 모두 `unmountedRef`를 처음에 `false`로 만들고 effect cleanup에서 `true`로 바꿉니다. effect setup에서 `false`로 복구하지 않습니다. 로컬 Next.js의 `reactStrictMode` 문서에서 App Router는 Strict Mode가 기본 활성화임을 확인했습니다. 프로젝트 설정에는 이를 끄는 설정이 없습니다.

Strict Mode의 개발용 effect setup → cleanup → setup 과정에서 두 ref가 `true`로 남습니다. 첫 질문을 시작하는 경로에는 이 ref 검사가 없으므로 첫 질문은 표시됩니다. 답변 이후에는 `use-experience-interview.ts`의 `runApplyTurn`이 블록 갱신 요청을 건너뛰고, `onBeforeQuestion`은 `stop`을 반환합니다. 이어 `use-interview-stream.ts`의 결과 처리 콜백도 ref 검사에서 반환하므로 `done`으로 전환하거나 다음 질문을 요청하지 못합니다.

## 재현

임시 Vitest 테스트에서 실제 `useExperienceInterview`를 렌더링하고 네트워크 응답만 정상 SSE와 블록 갱신 JSON으로 대체했습니다. `renderHook`의 `reactStrictMode`를 끈 경우와 켠 경우를 비교했습니다. 첫 질문 완료 후 답변을 제출하면 블록 갱신과 다음 질문으로 호출이 두 건 늘어야 한다는 동일한 검증을 적용했습니다.

`npx vitest run src/features/experience-block/loading-diagnosis.test.tsx` 결과는 1건 통과, 1건 실패였습니다. Strict Mode를 끈 경우 통과했습니다. 켠 경우 첫 질문 단계의 호출 수는 2건이고 답변 제출 후에도 2건이었습니다. 상태는 `connecting`, 미반영 턴은 `t1`이었습니다. 테스트 본체의 실행 시간은 194ms였습니다. 실제 LLM을 호출하지 않았습니다.

원인 확인용 임시 테스트는 실행 후 삭제했습니다. 기존 작업인 `src/lib/github/commits.ts` 변경은 건드리지 않았습니다.

## 결론과 확인 범위

개발 모드에서 보고된 증상을 만드는 클라이언트 생명주기 결함을 재현했습니다. 두 훅의 effect setup에서 생존 상태를 복구하고 Strict Mode 회귀 테스트를 추가하는 것이 수정 방향입니다. 사용자의 실제 브라우저 요청이나 서버 로그는 직접 관찰하지 않았으므로 운영 배포에서의 동일 증상까지 확인한 것은 아닙니다.

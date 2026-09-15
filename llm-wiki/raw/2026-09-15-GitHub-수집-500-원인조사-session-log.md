# GitHub 커밋 수집 500 원인 조사

사용자는 Repository 분석 중 commits와 commit-details가 간헐적으로 500을 반환한다고 보고했습니다. 제공된 로그 두 쌍에서는 commits가 각각 1.583초, 1.831초에 200을 반환하고 commit-details가 각각 26초, 11.3초에 500을 반환했습니다.

## 확인한 경로

`src/lib/github/contributions.ts`의 `fetchCommitDetailsBatch`는 최대 20개 커밋을 순차 조회합니다. 각 커밋은 상세 파일 페이지와 연결 PR 페이지를 순차 조회합니다. 상세와 PR을 모두 받아야 해당 커밋을 완료 목록에 넣습니다. 중간 요청이 실패하면 바로 중단하며 이 경로에는 자동 재시도가 없습니다.

이전에 완료한 커밋이 있으면 오류 종류를 `partial_failure`로 감싸고 원래 오류는 cause에 보관합니다. `src/lib/github/api-contract.ts`는 `partial_failure`를 항상 HTTP 500으로 직렬화합니다. 따라서 연결 오류나 호출 제한도 일부 성공 이후라면 500이 됩니다. 원래 종류와 실패 위치는 응답 JSON의 `error.causeKind`와 `error.message`에 남습니다. 커밋 목록 배치도 앞 페이지 성공 이후 실패하면 같은 계약을 사용합니다.

상세 수집 실패 시 `repository-analysis.ts`는 후보 생성용 retryPoint를 만들지 않습니다. 화면의 재시도는 `restart`를 호출하므로 커밋 목록부터 다시 조회합니다. 실패한 상세 커밋부터 이어받는 경로는 없습니다. 이는 목록 성공과 상세 실패가 반복되는 로그와 부합하지만 사용자가 실제로 재시도를 눌렀는지는 확인하지 않았습니다.

`githubFetch`는 fetch 자체가 던진 원래 예외를 보존하지 않고 URL을 포함한 network 오류로 바꿉니다. 따라서 응답이 network라고 해도 연결 단계의 세부 원인은 추가 관측이 필요할 수 있습니다. JSON 파싱 실패는 parseJson에서 network로 분류하고 예외 메시지를 포함합니다.

## 검증과 한계

`npx vitest run src/lib/github/api-contract.test.ts src/lib/github/contributions.test.ts src/app/api/github/commits/route.test.ts`를 실행해 3개 파일 40건이 통과했습니다. 기존 테스트에는 부분 성공 뒤 호출 제한을 HTTP 500과 `causeKind: rate_limit`으로 반환하는 검증이 있습니다.

`.next/dev/logs/next-development.log`에는 시작 및 컴파일 로그만 있었으며 해당 실패의 원인 로그는 없었습니다. 사용자에게 실패 응답의 kind, causeKind, message와 저장소 이름을 요청했습니다. 실제 응답을 받기 전에는 GitHub 5xx, 연결 실패, 호출 제한 중 어느 것이 이번 원인인지 확정할 수 없습니다. 11~26초라는 전체 요청 시간만으로 개별 요청의 타임아웃을 단정하지 않았습니다.

서비스 코드는 수정하지 않았습니다. 이번 조사는 앞서 재현한 경험 채팅 Strict Mode 결함과 별개의 GitHub 수집 경로를 대상으로 합니다.

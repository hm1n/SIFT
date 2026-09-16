# Repository 목록 network 502 추가 진단

앞선 [수집 500 조사](2026-09-15-GitHub-수집-500-원인조사-session-log.md)에 이어 사용자가 `/api/github/repositories` GET의 HTTP 502 응답을 제공했습니다. 응답 종류는 `network`이며 메시지는 `The GitHub API request failed: https://api.github.com/user/repos?per_page=100&sort=pushed&direction=desc`입니다.

이 메시지는 `githubFetch`가 fetch의 rejection을 잡는 분기에서만 생성합니다. 이번 응답은 GitHub가 반환한 HTTP 502를 전달한 것이 아니라 서버의 GitHub fetch 실패를 애플리케이션이 502로 매핑한 것입니다. 원래 예외를 catch에서 버리고 있어 DNS, TLS, 연결 시간 초과, 연결 끊김 중 무엇인지 기존 응답으로 확정할 수 없습니다. 커밋 목록과 상세도 같은 함수를 사용하지만 과거 실패가 같은 원인이었는지는 아직 확인하지 못했습니다.

현재 쉘의 Node.js v24.18.0에서 해당 주소로 인증 없는 fetch를 5번 순차 실행했습니다. 모두 HTTP 401 응답을 받았으며 소요 시간은 각각 267, 49, 22, 20, 9ms였습니다. 인증을 보내지 않아 401은 예상한 결과입니다. 이 확인은 당시 HTTP 연결이 가능했다는 뜻이며 인증된 Repository 목록 수집의 성공을 검증하지는 않습니다. DNS 조회는 IPv4 주소 한 개를 반환했고 쉘에는 HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, NODE_USE_ENV_PROXY가 설정되어 있지 않았습니다. 실행 중인 Next.js 프로세스의 환경과 같다고 단정하지 않습니다.

다음 재발에서 원인을 확인할 수 있도록 `src/lib/github/commits.ts`의 githubFetch가 원래 예외를 cause로 보존하게 했습니다. 개발 모드에서는 `[githubFetch] network failure` 로그에 URL, 소요 시간, 예외 이름과 오류 코드를 기록합니다. AggregateError의 하위 코드도 기록합니다. 요청 헤더, 토큰과 예외 원문은 로그에 넣지 않습니다. 운영 환경에서는 이 진단 로그를 출력하지 않으며 기존 HTTP 응답 계약을 유지합니다. 재시도와 연결 설정은 변경하지 않았습니다.

연결 실패 cause 보존과 민감 값 미출력, 운영 로그 미출력 테스트를 추가했습니다. commits, repositories, api-contract 테스트 71건이 통과했습니다. 실제 네트워크 실패는 이번 확인 중 재현되지 않았습니다. 근본 원인의 확정에는 다음 실패 시 개발 서버에 남는 오류 코드가 필요합니다.

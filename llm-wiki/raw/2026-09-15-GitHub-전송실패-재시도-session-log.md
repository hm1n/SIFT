# GitHub 전송 실패 1회 재시도 구현 세션 로그 (2026-09-15)

이슈 #122 구현입니다. 앞 세션의 원인 조사(`raw/2026-09-15-GitHub-간헐실패-DNS-원인확정-session-log.md`,
아직 `hm1n/feature-experience-block-2` 워크트리에 커밋되지 않았습니다)가 확정한 결론 위에서
`githubFetch` 한 곳만 고쳤습니다. 이 세션에서 네트워크를 다시 측정하지는 않았습니다.

## 1. 시작 전에 확인한 두 가지

인계 문서가 `githubFetch`에 커밋된 버전(A)과 커밋되지 않은 진단 버전(B)이 따로 있다고 알려
줘서 먼저 어느 쪽에서 출발하는지 확인했습니다. 이 워크트리의 브랜치는 `develop`·`origin/main`과
같은 지점(`6382762`)이고 `commits.ts`는 (A)였습니다. (B)와 진단 테스트 2건은
`hm1n/feature-experience-block-2` 워크트리에 커밋되지 않은 채 남아 있었습니다.

인계 문서에 없던 사실을 하나 더 찾았습니다. **backlog 9번이 `develop`에 없습니다.**
`wiki/2026-08-20-repository-데이터조회-후속-backlog.md`는 `develop` 기준으로 8번까지고, 9번과 10번은
`hm1n/feature-experience-block-2`에만 커밋돼 있으며 그 브랜치는 PR #121로 열려 있습니다. 그래서
이슈 #122의 Definition of Done 중 "backlog 9번 갱신"은 지금 이 브랜치에서 수행할 대상 문서가
없습니다. 같은 절을 새로 쓰면 #121 머지 때 충돌합니다.

사용자와 셋 중 하나를 골랐습니다.

1. 코드와 테스트를 먼저 끝내 PR을 올리고, backlog 갱신은 #121이 `develop`에 머지된 뒤 받아 와서
   마지막 커밋으로 얹는다. **(채택)**
2. #122를 `hm1n/feature-experience-block-2` 위에서 분기한다. 문서는 바로 손에 들어오지만 #121의
   미머지 변경을 전부 끌고 옵니다.
3. backlog 갱신을 #121 쪽 후속으로 넘긴다. DoD 한 줄을 이번 PR에서 못 채웁니다.

## 2. 이슈의 확인 필요 3건을 정했습니다

- **`AbortSignal.timeout`은 넣지 않습니다.** 측정된 실패는 전부 undici의 connectTimeout 10초가 이미
  끊어 준 경우입니다. 제한 시간을 새로 얹으면 지금까지 성공하던 느린 요청까지 실패시키는데, 그
  임계값을 정할 측정이 없습니다. backlog 9번에 후속으로 남깁니다.
- **재시도 대기는 두지 않습니다(0ms).** 원인이 서버 혼잡이 아니라 로컬 이름 해석이고, 앞 세션
  측정에서 실패 직후 재요청이 245ms·304ms에 성공했습니다. 대기가 없으면 테스트에 fake timer도
  필요 없습니다.
- **라벨을 ✨ Feature에서 🐞 BugFix로 바꿉니다.** 사용자에게 실제로 보인 500·502를 없애는 작업이고
  새 기능 표면이 생기지 않습니다. 커밋 type도 `fix:`로 갔습니다.

## 3. 구현

`githubFetch`를 시도 2회 루프로 바꾸고, (B)의 진단 로그를 `logNetworkFailure`로 빼면서 `attempt`와
`attempts`를 더했습니다. HTTP 오류 응답은 `fetch`가 정상 반환하므로 루프를 그냥 빠져나갑니다.
"전송 실패만 재시도한다"는 제약에 별도 분기가 필요 없습니다.

재시도 여부는 오류 메시지(`... after 2 attempts: <url>`)에 남깁니다. `GitHubFetchError`에 필드를
더하면 `SerializedGitHubError` 직렬화 계약까지 건드리게 되는데, 제약이 "kind와 상태 코드 매핑을
바꾸지 않는다"였기 때문에 계약에 가장 덜 닿는 자리를 골랐습니다. 이 메시지가 사용자에게 보이지
않는지 먼저 확인했습니다. 화면은 `repository-analysis.ts`의 `errorCopy(kind)`가 만든 고정 문구를
쓰고 서버 메시지를 그대로 노출하지 않습니다.

(A)가 원래 예외를 `catch {}`로 버리던 것을 (B)처럼 `cause`로 보존합니다. 재시도가 실패 원인을 덮지
않게 하는 부분입니다.

## 4. 기존 테스트 3건이 함께 바뀌었습니다

`mockRejectedValueOnce`로 한 번만 실패시키던 테스트는 재시도가 들어가면 두 번째 호출에서
`undefined`를 받아 엉뚱한 곳에서 터집니다. 세 자리를 `mockRejectedValue`로 바꿔 두 시도 모두
실패하게 했습니다. `repositories.test.ts`의 "fetch 자체가 실패하면 network다",
`app/api/github/repositories/route.test.ts`의 "GitHub 연결 자체가 실패하면 network 502",
`commits.test.ts`의 partial_failure 테스트입니다.

이건 테스트 손질이 아니라 계약 변경의 반영입니다. 이제 `network`는 "두 번 다 전송에 실패했다"는
뜻입니다. 앞으로 한 번만 실패시키는 테스트는 재시도 경로를 지나 성공하므로 이 경로를 못 봅니다.
`repositories.test.ts`에 그 사실을 주석으로 남겼습니다.

## 5. 회귀 테스트 5건

이슈가 요구한 4건에 (B)에 있던 운영 모드 무로그 테스트를 더해 `describe("githubFetch")`로 묶었습니다.

1. 전송 실패 뒤 재시도가 성공하면 호출자에게 정상 응답이 가고 `fetch`는 2회 호출됩니다.
2. 403·404·409·422·429 응답은 재시도하지 않습니다(`fetch` 1회).
3. 재시도까지 실패하면 `kind: "network"`, 마지막 예외가 `cause`, 메시지에 시도 횟수가 남습니다.
4. 개발 모드 로그에 `attempt`가 1·2로 남고 토큰과 예외 원문은 남지 않습니다.
5. 운영 모드에서는 로그 없이 같은 `network` 오류를 던집니다.

## 6. 검증

전체 76파일 1303건 통과, `npx eslint` 통과, `npm run typecheck`(next typegen + tsc) 통과입니다.
인계 문서가 예고한 "타입 검사 실패"는 이 세션에서도 재현되지 않았습니다.

실제 네트워크 실패는 재현이 간헐적이라 테스트로만 검증했습니다. 실환경 확인은 다음 재발 때 개발
서버 터미널의 `[githubFetch] network failure` 로그에서 `attempt: 1` 뒤 요청이 살아났는지로 합니다.

## 7. 남은 것

- backlog 9번 갱신은 #121 머지 뒤입니다(1절).
- `hm1n/feature-experience-block-2` 워크트리에 커밋되지 않은 `commits.ts`·`commits.test.ts` (B)
  변경은 **버려야 합니다.** 이번 PR이 같은 자리를 다시 썼기 때문에 거기서 따로 커밋하면 머지 때
  충돌합니다. 같은 워크트리의 CSS 4건과 raw 로그 4개는 이번 작업과 무관합니다.
- `AbortSignal.timeout`은 backlog 9번의 후속으로 남습니다.

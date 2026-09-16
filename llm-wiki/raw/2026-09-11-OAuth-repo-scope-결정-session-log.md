# OAuth repo scope 결정 세션 로그

2026-09-11에 PR #102를 이어 진행한 세션입니다. `raw/2026-09-11-Repository-목록-조회와-선택-화면-리뷰-1차-session-log.md`가 P2로 분리해 둔 비공개 Repository 접근 scope 결정을 이 세션에서 사용자가 확정했습니다. 결론은 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 13번과 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md` 0절에 있습니다.

## 1. 결정 경위

- 1차 리뷰 판정에서 선택지 셋(`repo` scope 요구, GitHub App 전환, 공개 Repository만 지원)을 backlog 13번에 적어 두고 사용자 판단으로 남겼습니다.
- 사용자가 `repo` scope 쪽을 선택했습니다. `repo`가 비공개 Repository를 열면 함께 등록도 가능한지 물었고, `repo`는 OAuth App이 비공개 Repository를 여는 유일한 scope이며 읽기 전용으로 좁힌 옵션이 없어 쓰기 권한도 함께 부여된다는 점, 그리고 이미 로그인한 세션은 이전 scope로 발급된 토큰을 그대로 쓰므로 재로그인해야 비공개 목록이 보인다는 점을 답한 뒤 승인을 받았습니다.

## 2. 구현

- `src/lib/github/oauth.ts`의 `createGitHubAuthorizeUrl`이 요청하는 scope를 `read:user`에서 `read:user repo`로 바꿨습니다. `read:user`는 유지했습니다. `fetchAuthenticatedUserLogin`이 쓰는 `/user` 엔드포인트의 login 필드는 scope 없이도 반환되지만, 기존 결정을 좁히는 변경이 아니므로 그대로 뒀습니다.
- `oauth.test.ts`와 `login/route.test.ts`의 scope 단언을 `read:user repo`로 바꿨습니다. 두 테스트가 이번 지적의 회귀 테스트입니다. authorize URL이 실제로 `repo`를 요청하는지가 이 변경의 유일한 검증 지점입니다. GitHub 서버가 scope에 따라 비공개 Repository를 돌려주는지는 목 응답으로 재현할 수 없어, `repositories.test.ts`가 이미 갖고 있던 비공개 Repository 매핑 테스트(요약 변환 테스트의 `rawRepository(3)`, `private: true`)로 렌더링 쪽 회귀는 충분하다고 판단했습니다.
- 테스트 1016개, lint, typecheck 통과.

## 3. 남는 것

- 이미 로그인한 사용자는 재로그인해야 비공개 Repository가 목록에 나타납니다. 별도 안내 문구나 강제 재인증은 이번 결정에 포함하지 않았습니다. 필요하면 후속으로 검토합니다.
- `repo` scope가 쓰기 권한을 포함하므로, 이 서비스가 실제로 쓰기 API를 호출하지 않는다는 사실을 사용자에게 알리는 문구(예: 로그인 화면 설명)가 필요한지는 확인 필요입니다.

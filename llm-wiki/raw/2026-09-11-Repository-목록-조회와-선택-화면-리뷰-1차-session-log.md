# Repository 목록 조회와 선택 화면 리뷰 1차 세션 로그

2026-09-11에 PR #102의 Codex 1차 리뷰를 판정한 세션입니다. 구현 경위는 `raw/2026-09-11-Repository-목록-조회와-선택-화면-구현-session-log.md`에 있고, 결론은 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md`와 `wiki/2026-09-10-디자인-개편-후속-backlog.md` 13번에 있습니다.

## 1. 지적 수집

- 02:40에 Codex가 리뷰 하나와 인라인 코멘트 하나를 남겼습니다. 이슈 코멘트는 Vercel 배포 알림만 있었습니다.
- 인라인 1건은 `src/lib/github/repositories.ts` 41행의 도구 등급 P1입니다. OAuth 로그인 URL이 `read:user`만 요청하므로 `/user/repos`가 공개 Repository만 돌려주고, 비공개 Repository만 쓰는 사용자는 빈 목록 안내를 받는다는 내용입니다. scope 추가와 회귀 테스트를 요구했습니다.

## 2. 묶음과 근본 원인

- 묶음은 하나입니다. 근본 원인은 이 PR의 코드가 아니라 PR #73이 정한 OAuth scope입니다. PR #73 Decision은 "OAuth App에는 private Repository를 읽기 전용으로 여는 scope가 없다. `repo`는 쓰기 권한까지 주므로 조회만 하는 서비스가 요구할 값이 아니다"라고 적고 Trade-off에 "private Repository를 지원하지 않습니다"를 명시했습니다.
- 같은 함수와 데이터 흐름을 다시 읽었습니다. 목록 라우트, 커밋 조회, 상세 조회, 메타데이터 조회가 모두 같은 토큰을 쓰므로 비공개 Repository는 이 PR 전에도 분석할 수 없었습니다. 지적되지 않은 같은 성격의 결함은 없었습니다.
- 2026-08-19 설계 세션(`raw/2026-08-19-github-repository-입력-기능-설계-session-log.md`)은 비공개 Repository 지원을 전제했습니다. PR #73이 그 전제를 좁혔고 Review Points 🟢 Low에 "private Repository 지원이 필요하다고 판단되면 방향을 다시 정해야 한다"고 적었지만 그 뒤 결정이 없었습니다.

## 3. 등급 판정

- 프로젝트 기준으로 P2입니다. 회귀가 아니고, 이슈 #95의 Goal과 Constraints에 비공개 Repository는 없으며, 라우트는 토큰이 접근할 수 있는 목록을 그대로 돌려줍니다.
- 예외 둘을 검토했습니다. Goal이나 Constraints 직접 위반은 아닙니다. 수정 비용은 scope 문자열 한 줄과 테스트 두 곳이라 작지만, `repo` scope는 쓰기 권한을 함께 요구하는 제품 결정이고 PR #73이 명시적으로 거부한 방향이라 리뷰 반영으로 뒤집지 않았습니다.
- 접은 대안은 빈 상태 sub를 "공개 Repository만 조회합니다"로 바꾸는 것입니다. 지금 scope에서는 정확한 안내지만 scope 결정이 나면 다시 바뀌는 문구라 결정과 함께 처리하기로 했습니다.

## 4. 처리

- 스레드에 판정과 근거를 답글로 남기고 resolve했습니다.
- backlog 13번에 선택지 셋(`repo` scope, GitHub App, 공개만 지원하고 문구 명시)을 적었습니다. 새 위키 확인 필요 절에 현재 scope의 결과를 한 줄 더했습니다.
- 코드 변경이 없어 재검증 라운드는 돌리지 않았습니다. 라운드는 1차 한 번, 지적 1건, 후속 분리 1건입니다.

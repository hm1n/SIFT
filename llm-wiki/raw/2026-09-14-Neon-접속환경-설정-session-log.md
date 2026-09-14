---
날짜: 2026-09-14
주제: Neon CLI 연결과 MCP 인증 범위
근거: https://github.com/hm1n/SIFT/issues/114
---

# Neon 접속 환경 설정 세션 로그

이슈 #114의 앞부분입니다. 사용자가 Neon 온보딩 프롬프트 7단계를 그대로 주고 실행을 요청했습니다. 세션 사용자 번호 도입 경위는 `2026-09-14-세션-사용자번호-도입-session-log.md`에 따로 남깁니다.

## 패키지 확인

`npm i -g neon@latest`를 바로 돌리지 않고 `npm view neon`으로 정체를 먼저 봤습니다. `neon`이라는 이름은 Rust 바인딩 쪽에도 있어서 다른 패키지가 잡힐 수 있다고 봤습니다. 확인 결과 4.17.3, `neondatabase/neon-pkgs`의 공식 CLI가 맞았습니다.

## 로그인은 사람이 해야 했습니다

`neon me`를 돌렸더니 브라우저 OAuth URL을 띄우고 60초 뒤 타임아웃했습니다. 사용자에게 `! neon login`을 요청해 처리했습니다. 계정은 `shinhm1`입니다.

## 단계별 결과

- `neon skills -y`: 스킬 7개가 `.claude/skills/`에 들어갔습니다. 이 경로는 `.gitignore` 대상이라 저장소에 영향이 없었고, 루트에 `skills-lock.json`만 새로 생겼습니다.
- `neon mcp -y`: 설정 8곳에 기록하고 계정 전체 범위 API 키를 발급했습니다. CLI가 경고를 띄웠습니다. "This key reaches everything your account can, in every organization."
- `neon link --project-id steep-feather-35162878 --branch production -y`: `.neon`을 만들고 `.env.local`에 `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_BRANCH`를 썼습니다. `.gitignore`에 `.neon`을 덧붙였는데 obsidian 절 아래에 붙어서 주석과 항목이 어긋났습니다. 절을 새로 만들어 정리했습니다.
- `neon config init`: `neon.ts`를 만들면서 `@neon/config`와 `@neon/env`를 `dependencies`에 설치했습니다. 이슈의 "새 의존성은 접속 드라이버 하나" 제약과 부딪혀 사용자에게 보고했고, `devDependencies`로 옮기기로 했습니다.
- `neon deploy`: `defineConfig({})`라 선언한 서비스가 없어 변경이 없었습니다. `neon config plan`으로 먼저 확인한 뒤 실행했습니다.

## 접속 확인

psql이 없어서 `neon inspect db table-sizes`로 확인했습니다. `No user tables found`가 나와 접속 자체는 되는 것을 확인했습니다.

## MCP 키 범위를 좁히려다 막힌 것

사용자가 키를 이 프로젝트로 좁히라고 했습니다. 세 번 시도했습니다.

1. `neon mcp -y --project-id steep-feather-35162878`. URL에 `?projectId=`는 붙었지만 경고가 나왔습니다. "That key keeps its existing scope." 키는 그대로였습니다.
2. 키를 먼저 폐기하면 재사용할 것이 없어질 것으로 봤습니다. `neon api-keys revoke 3335681`이 auto 모드 분류기(Secret-Store Writes)에 막혀 사용자가 직접 실행했습니다. 폐기 후 `neon api-keys list`는 비었습니다. 그런데 다시 설치해도 CLI가 "Reusing the API key already configured"라며 설정 파일에 남은 폐기된 키를 그대로 썼습니다. 서버에서 지운 것을 CLI가 모릅니다. 이 시점에 MCP는 죽은 키를 든 상태였습니다.
3. `~/.claude.json`에서 Neon 항목만 지우려 했으나 Self-Modification으로 막혔습니다. 전역 설정은 손대지 않았습니다.

결국 `neon mcp -y --oauth --project-id steep-feather-35162878`로 해결했습니다. `Authorization` 헤더가 빠지고 URL만 남은 것을 확인했습니다. 요청은 "범위 좁히기"였는데 결과는 "키 없음"이라 요청보다 좁습니다.

접은 대안은 설정 8곳(JSON 6개, TOML 2개)에서 항목을 손으로 지우고 다시 발급하는 방법입니다. 같은 목적을 한 줄로 이루는 쪽이 있어서 접었습니다. 그쪽을 택하면 장기 보관 키가 다시 생깁니다.

## 커밋

`chore: Neon 프로젝트 연결과 배포 정책 설정`. 커밋 메시지를 만들 때 PowerShell here-string 문법을 Bash 도구에 써서 제목 앞에 `@`가 붙었고, heredoc으로 amend해 고쳤습니다.

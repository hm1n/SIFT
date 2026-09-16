# Production Release

## 개요

`production-release`는 SIFT의 프로덕션 릴리즈를 준비하는 Skill입니다. 최신 릴리즈 이후 `develop`에 누적된 변경사항을 확인하고, 병합된 PR을 기준으로 릴리즈 노트를 작성한 뒤 `develop → main` 릴리즈 PR을 생성합니다.

실제 배포와 GitHub Release 생성은 이 Skill의 범위가 아니며, 릴리즈 PR이 `main`에 병합되어 프로덕션에 배포된 이후 별도의 GitHub Actions 워크플로우가 자동으로 처리합니다. 이 문서는 Skill 자체의 사용법과, Skill부터 배포 후 자동화까지 이어지는 전체 릴리즈 흐름을 함께 설명합니다.

## 이 스킬의 역할과 범위

### 스킬이 하는 일

- `origin/develop`, `origin/main`, Git 태그 동기화 상태를 확인합니다.
- 최신 `vX.Y.Z` 태그 이후 `develop`에 병합된 PR을 수집합니다.
- 각 PR의 `Summary`(필요 시 `Impact`, 예외적으로 diff)를 기준으로 릴리즈 노트를 작성합니다.
- 변경 유형을 기준으로 다음 버전을 제안합니다.
- 버전 중복, 변경사항 누락 여부를 검사합니다.
- `references/release-pr-template.md`를 사용해 `develop → main` 릴리즈 PR을 생성합니다.

### 스킬이 하지 않는 일

- `package.json`의 `version`을 변경하지 않습니다.
- 릴리즈 브랜치, 릴리즈 이슈를 생성하지 않습니다.
- Git 태그를 생성하지 않습니다.
- GitHub Release를 생성하지 않습니다.
- 프로덕션 배포를 직접 수행하지 않습니다.
- GitHub 자동 릴리즈 노트, Release Drafter를 사용하지 않습니다.
- PR diff 전체 분석을 기본 동작으로 수행하지 않습니다.

## 전체 워크플로우

릴리즈는 Skill 실행 구간과 배포 이후 자동화 구간으로 나뉩니다.

### 1. 스킬 실행 전

- 기능 개발 PR이 `develop`에 병합되어 누적됩니다.
- 각 PR의 `Summary`(필요 시 `Impact`)를 릴리즈 노트 작성에 사용합니다.

### 2. 스킬 실행 구간

- `production-release` Skill을 실행해 최신 태그 이후 변경사항을 확인하고 릴리즈 노트를 작성합니다.
- `[release] vX.Y.Z` 제목으로 `develop → main` 릴리즈 PR을 생성합니다.
- 릴리즈 PR은 사람이 검토 후 `main`에 병합합니다.

### 3. 스킬 실행 이후 (자동화)

배포와 GitHub Release 생성은 `.github/workflows/create-release-note.yml`이 자동으로 처리합니다.

1. 릴리즈 PR이 `main`에 병합되면 Vercel이 `main` 최신 커밋을 프로덕션에 배포합니다.
2. Vercel 배포 성공 시 발생하는 GitHub `deployment_status` 이벤트 중 environment가 `Production`인 것만 워크플로우가 받습니다. preview 배포는 성공해도 같은 조건을 만족하지 않으므로 릴리즈를 만들지 않습니다.
3. 이벤트의 커밋이 현재 `origin/main` 최신 커밋과 일치하는지 확인합니다.
4. 해당 커밋에 연결된 PR 중 `develop → main`, `[release] vX.Y.Z` 형식, 병합 완료 조건을 모두 만족하는 PR이 정확히 1개인지 확인합니다.
5. 릴리즈 PR 제목과 본문의 버전이 일치하는지, `<!-- release-note:start -->` / `<!-- release-note:end -->` 마커가 각각 1개씩 올바른 순서로 존재하는지 검증합니다.
6. 마커 사이의 내용을 추출해 릴리즈 노트 원본으로 사용합니다.
7. 버전에 해당하는 Git 태그가 없으면 배포 커밋에 태그를 생성합니다.
8. 추출한 릴리즈 노트로 GitHub Release를 생성합니다. 태그·Release가 이미 존재하면 재실행하지 않습니다.

즉, Skill은 "무엇을 릴리즈할지"와 "릴리즈 노트 내용"까지만 책임지고, "언제 배포되었는지 확인"과 "태그·GitHub Release 생성"은 배포 이벤트를 트리거로 하는 자동화가 책임집니다.

## 사용 방법

### 실행 방법

Claude Code, Codex 등 Skill을 지원하는 Agent에서 `production-release` Skill을 호출합니다. Codex의 기본 프롬프트는 다음과 같습니다 (`agents/openai.yaml`).

> 이전 릴리즈 이후 변경사항을 확인하고 릴리즈 노트를 작성한 뒤 develop에서 main으로 프로덕션 릴리즈 PR을 생성해 주세요.

### 입력 / 전제 조건

- `origin/develop`, `origin/main`이 최신 상태여야 합니다.
- `origin/main` 릴리즈 계보에서 접근 가능한 최신 `vX.Y.Z` 태그가 있어야 합니다. 없으면 버전을 자동으로 결정하지 않고 사용자에게 확인을 요청합니다.
- 최신 태그 이후 `develop`에 병합된, 릴리즈 대상이 될 변경사항이 있어야 합니다.
- 각 PR에 `Summary`가 작성되어 있어야 릴리즈 노트 품질이 보장됩니다.

## 동작 절차

1. `origin/develop`, `origin/main`, Git 태그를 최신 상태로 동기화합니다.
2. 릴리즈 기준이 되는 최신 `vX.Y.Z` 태그를 확인합니다.
3. 최신 태그 이후 `origin/develop`에 포함된 변경사항을 확인합니다.
4. 해당 범위에 포함된 병합 PR을 수집합니다.
5. 각 PR의 번호, 제목, 라벨, `Summary`를 읽습니다.
6. `Summary`만으로 불명확한 경우에만 `Impact`를 확인합니다.
7. `Summary`가 없거나, 제목과 충돌하거나, 보안·마이그레이션·호환성 파괴 변경이거나, 정보가 부족한 경우에만 제한적으로 PR diff를 확인합니다.
8. 관련 PR을 기능 또는 목적 단위로 묶어 릴리즈 노트를 작성합니다.
9. 최근 태그와 변경 유형을 기준으로 다음 버전을 제안합니다.
10. 버전 중복과 변경사항 누락 여부를 검사합니다.
11. `references/release-pr-template.md`로 릴리즈 PR 본문을 작성합니다.
12. `[release] vX.Y.Z` 형식으로 `develop → main` 릴리즈 PR을 생성합니다.

## 버전 판단 기준 (Source of Truth)

릴리즈 정보는 다음 우선순위로 판단하며, `package.json`의 `version`은 사용하지 않습니다.

1. Git 태그
2. Pull Request
3. Git History

버전 수준은 다음 기준을 따르고, 여러 유형이 섞이면 가장 높은 수준(`major > minor > patch`)을 선택합니다.

- **Major**: 기존 기능과 호환되지 않는 변경, 주요 사용자 흐름·공개 인터페이스의 파괴적 변경
- **Minor**: 새로운 사용자 기능 추가, 기존 기능의 의미 있는 확장, 새로운 공개 페이지/흐름 추가
- **Patch**: 버그 수정, 기존 기능 개선, 성능·접근성·SEO·내부 안정성 개선

버전 판단이 신뢰하기 어려우면 자동으로 결정하지 않고 사용자에게 확인을 요청합니다.

## 릴리즈 노트 작성 기준

자세한 내용은 `references/release-note.md`를 따르며, 핵심 원칙은 다음과 같습니다.

- PR의 `Summary`를 그대로 나열하지 않고, 중복 제거·관련 PR 통합·기능 단위 재구성·사용자 관점 재작성을 거쳐 작성합니다.
- 구현 세부사항(함수명, 컴포넌트명, 파일 경로, 리팩터링 과정)보다 변경 목적과 사용자 영향을 우선 설명합니다.
- 사용자에게 영향이 없는 작업(코드 스타일, lint 설정, 단순 내부 리팩터링 등)은 제외할 수 있고, 운영 안정성·개발 생산성에 의미 있는 변화는 `내부 개선`으로 작성합니다.
- 릴리즈 요약은 2~3문장, 각 변경사항은 한두 문장으로 작성합니다.
- Merge Commit 메시지는 릴리즈 노트의 입력으로 사용하지 않습니다.
- 작성 후 `references/release-note.md`의 체크리스트로 품질을 검증합니다.

## 릴리즈 PR 템플릿과 GitHub Release 연결

릴리즈 PR은 `references/release-pr-template.md` 형식을 따르며, 본문의 `<!-- release-note:start -->`와 `<!-- release-note:end -->` 사이 내용이 이후 GitHub Release 본문으로 그대로 사용되는 연결점입니다.

- PR 제목: `[release] vX.Y.Z`
- PR 본문 중 `## 릴리즈 버전`, `## 릴리즈 요약`, `## 주요 변경사항`, `## 포함된 Pull Request` 섹션이 마커 사이에 위치합니다.
- `create-release-note.yml`은 이 마커를 grep으로 찾아 정확히 1개씩, 올바른 순서로 존재하는지 검증한 뒤 그 사이 내용을 `release-notes.md`로 추출해 `gh release create`의 `--notes-file`로 사용합니다.
- 따라서 마커 형식이 깨지거나 사이 내용이 비어 있으면 자동화가 실패하므로, 릴리즈 PR 작성 시 템플릿 구조를 임의로 변경하지 않아야 합니다.

## 릴리즈 PR을 생성하지 않는 경우

다음 조건 중 하나라도 해당하면 새 릴리즈 PR을 생성하지 않습니다.

- 릴리즈 대상 변경사항이나 병합 PR이 없는 경우
- 동일 버전의 릴리즈 PR이 이미 존재하는 경우
- 동일한 `develop → main` 열린 PR이 이미 존재하는 경우
- 제안한 버전 태그가 이미 존재하는 경우
- 변경사항 누락 검사가 실패하는 경우 (반영/제외 사유가 없는 PR이 남아있는 경우)

## 관련 파일

- [`SKILL.md`](./SKILL.md) — Skill 실행 절차와 품질 기준 정의
- [`references/release-note.md`](./references/release-note.md) — 릴리즈 노트 작성 규칙
- [`references/release-pr-template.md`](./references/release-pr-template.md) — 릴리즈 PR 제목·본문 템플릿
- [`agents/openai.yaml`](./agents/openai.yaml) — Codex 실행 시 기본 프롬프트
- [`.github/workflows/create-release-note.yml`](../../../.github/workflows/create-release-note.yml) — 배포 감지 후 Git 태그·GitHub Release 자동 생성 워크플로우


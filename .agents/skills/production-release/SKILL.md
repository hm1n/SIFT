---
name: production-release
description: SIFT의 프로덕션 릴리즈를 준비하고 develop에서 main으로 릴리즈 PR을 생성합니다.
---

# Production Release

프로덕션 릴리즈를 준비할 때 사용하는 스킬입니다.

## Source of Truth

릴리즈 정보는 다음 우선순위를 기준으로 판단합니다.

1. Git 태그
2. Pull Request
3. Git History

`package.json`의 `version`은 릴리즈 버전 판단에 사용하지 않습니다.

## Workflow

1. 원격 저장소의 `origin/develop`, `origin/main`, Git 태그를 최신 상태로 동기화합니다.
2. 릴리즈 기준이 되는 최신 `vX.Y.Z` 태그를 확인합니다.
3. 최신 태그 이후 현재 `origin/develop`에 포함된 변경사항을 확인합니다.
4. 해당 변경 범위에 포함된 병합 PR을 수집합니다.
5. 각 PR의 번호, 제목, 라벨, `Summary`를 읽습니다.
6. `Summary`만으로 사용자 영향이 불명확한 경우에만 `Impact`를 확인합니다.
7. 다음 경우에만 제한적으로 PR diff를 확인합니다.
   - `Summary`가 없는 경우
   - 제목과 `Summary`가 충돌하는 경우
   - 보안, 데이터 마이그레이션, 호환성 파괴 변경인 경우
   - 버전 판단에 필요한 정보가 부족한 경우
8. 관련 PR을 기능 또는 목적 단위로 묶어 릴리즈 노트를 작성합니다.
9. 최근 태그와 변경 유형을 기준으로 다음 버전을 제안합니다.
10. 버전 중복과 변경사항 누락 여부를 검사합니다.
11. `references/release-pr-template.md`를 사용해 릴리즈 PR 본문을 작성합니다.
12. `[release] vX.Y.Z` 형식으로 `develop → main` 릴리즈 PR을 생성합니다.

## Latest Release Tag

릴리즈 기준 태그는 `origin/main` 릴리즈 계보에서 접근 가능한 태그 중 다음 조건을 모두 만족하고 버전이 가장 높은 태그를 사용합니다.

- 정확히 `vX.Y.Z` 형식인가
- Semantic Versioning 형식인가
- 버전 순으로 가장 높은 태그인가
- 태그가 가리키는 커밋이 `origin/main` 이력에 포함되어 있는가

다음 태그는 릴리즈 기준으로 사용하지 않습니다.

- `release-*`
- 테스트 또는 임시 태그
- prerelease 태그
- `vX.Y.Z` 형식이 아닌 태그

릴리즈 기준 태그가 없으면 버전을 자동으로 결정하지 않고 사용자에게 확인을 요청합니다.

전역에서 가장 높은 버전 태그가 있더라도 `origin/main` 릴리즈 계보에서 접근할 수 없다면 릴리즈 기준으로 사용하지 않습니다.

## Release Range

릴리즈 대상 변경사항은 다음 범위를 기준으로 판단합니다.

- 최신 릴리즈 태그가 가리키는 커밋 이후
- 현재 `origin/develop`에 포함된 변경사항

기본 비교 범위는 다음과 같습니다.

latest_tag..origin/develop

이 범위는 릴리즈 PR을 merge commit으로 병합한다는 전제 위에서만 성립합니다. squash나 rebase로 병합하면 `main`에 새 커밋이 생겨 태그가 가리키는 커밋이 `origin/develop` 이력에서 벗어납니다. 그러면 다음 릴리즈의 `latest_tag..origin/develop`에 이미 릴리즈한 변경사항이 다시 들어와 릴리즈 노트와 포함 PR 목록이 중복됩니다.

최신 태그가 없으면 다음 범위를 참고하되, 자동으로 릴리즈 PR을 생성하지 않습니다.

origin/main..origin/develop

릴리즈 대상 PR은 다음 조건을 만족해야 합니다.

- `develop`에 병합된 PR인가
- 비교 범위의 커밋이 `origin/develop`에 포함되어 있는가
- 릴리즈 PR이나 merge-only PR이 아닌가
- 동일한 PR이 중복 수집되지 않았는가

Git 커밋 범위와 GitHub PR 목록을 함께 확인합니다.

1. `latest_tag..origin/develop`의 커밋을 확인합니다.
2. 해당 커밋과 연결된 병합 PR을 수집합니다.
3. PR의 merge commit 또는 포함 커밋이 비교 범위에 존재하는지 확인합니다.
4. 비교 범위에 포함되지 않은 PR은 제외합니다.
5. PR과 연결되지 않은 커밋이 있으면 누락 가능성으로 보고합니다.

릴리즈 대상 변경사항이나 병합 PR이 없다면 릴리즈 PR을 생성하지 않습니다.

## Pull Request Information

각 PR에서 다음 정보를 우선적으로 확인합니다.

1. PR 번호
2. PR 제목
3. PR 라벨
4. `Summary`
5. 필요한 경우 `Impact`
6. 예외적으로 PR diff

Merge Commit 메시지는 릴리즈 노트의 직접적인 입력으로 사용하지 않습니다.

## Version Rules

버전은 `vX.Y.Z` 형식의 Semantic Versioning을 사용합니다.

### Major

- 기존 기능과 호환되지 않는 변경
- 주요 사용자 흐름 또는 공개 인터페이스의 파괴적 변경

### Minor

- 새로운 사용자 기능 추가
- 기존 기능의 의미 있는 확장
- 새로운 공개 페이지 또는 사용자 흐름 추가

### Patch

- 버그 수정
- 기존 기능 개선
- 성능, 접근성, SEO, 내부 안정성 개선

여러 변경 유형이 포함되면 가장 높은 버전 수준을 선택합니다.

major > minor > patch

버전 수준을 신뢰성 있게 판단하기 어렵다면 자동으로 결정하지 않고 사용자에게 확인을 요청합니다.

다음 조건을 확인합니다.

- 제안한 버전 태그가 이미 존재하지 않는가
- 최신 릴리즈 태그보다 높은 버전인가
- PR 제목과 PR 본문의 버전이 일치하는가
- 동일 버전의 열린 릴리즈 PR이 존재하지 않는가
- 동일한 `develop → main` 릴리즈 PR이 이미 열려 있지 않은가

## Missing Change Check

수집한 모든 PR은 다음 중 하나로 처리합니다.

1. 주요 변경사항에 직접 반영
2. 다른 PR과 기능 또는 목적 단위로 통합하여 반영
3. 내부 변경, 중복 또는 릴리즈 제외 대상으로 분류

반영 또는 제외 사유가 없는 PR이 있다면 릴리즈 PR을 생성하지 않습니다.

`포함된 Pull Request` 섹션에는 릴리즈 대상 PR을 모두 작성합니다.

다음 항목도 확인합니다.

- 비교 범위에는 있으나 PR 목록에 없는 커밋이 있는가
- 수집한 PR 중 릴리즈 노트와 포함 PR 목록에서 누락된 항목이 있는가
- 동일 PR이 두 번 이상 포함되어 있는가
- 최신 태그 이전 변경사항이 잘못 포함되어 있는가

## Pull Request

- Base branch: `main`
- Head branch: `develop`
- Title: `[release] vX.Y.Z`
- Body: `references/release-pr-template.md` 사용
- Merge method: merge commit만 사용하고 squash와 rebase는 쓰지 않습니다

다음 조건 중 하나라도 만족하면 새 릴리즈 PR을 생성하지 않습니다.

- 릴리즈 대상 변경사항이 없음
- 동일 버전의 릴리즈 PR이 존재함
- 동일한 `develop → main` 열린 PR이 존재함
- 제안 버전 태그가 이미 존재함
- 변경사항 누락 검사가 실패함

PR 생성 전 다음을 확인합니다.

- `origin/develop`과 로컬 `develop`이 일치하는가
- `origin/main`과 로컬 `main`이 일치하는가
- 릴리즈할 변경사항이 존재하는가
- 동일한 버전의 릴리즈 PR이 존재하지 않는가
- 동일한 base와 head를 사용하는 열린 PR이 존재하지 않는가

## Constraints

- `package.json` 버전은 변경하지 않습니다.
- 릴리즈 브랜치를 생성하지 않습니다.
- 릴리즈 이슈를 생성하지 않습니다.
- Git 태그를 생성하지 않습니다.
- GitHub Release를 생성하지 않습니다.
- 프로덕션 배포를 직접 수행하지 않습니다.
- GitHub 자동 릴리즈 노트와 Release Drafter를 사용하지 않습니다.
- 코드 diff 전체 분석은 기본 동작에서 제외합니다.
- 구현 세부사항보다 기능과 사용자 영향을 우선 설명합니다.
- 릴리즈 PR은 다른 사람이 함께 보는 공유 문서이므로 본문은 존댓말(습니다체)로 작성합니다.

## References

- `references/release-note.md`
- `references/release-pr-template.md`

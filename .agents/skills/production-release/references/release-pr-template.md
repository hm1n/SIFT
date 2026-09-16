# Release PR Template

## Title

```text
[release] vX.Y.Z
```

## Body

```markdown
## 릴리즈 버전

`vX.Y.Z`

<!-- release-note:start -->

## 릴리즈 요약

이번 릴리즈의 핵심 변화와 목적을 사용자 또는 운영 관점에서 2~3문장으로 작성합니다.

## 주요 변경사항

### 기능 또는 목표 단위 제목

- 사용자 또는 운영 관점에서 달라진 내용을 작성합니다.
- 여러 PR이 하나의 기능을 구성한다면 하나의 변경사항으로 통합합니다.

## 포함된 Pull Request

- #PR번호 PR 제목

<!-- release-note:end -->

```

## Rules

- PR 제목은 반드시 `[release] vX.Y.Z` 형식을 사용합니다.
- PR 본문의 버전과 제목의 버전은 반드시 일치해야 합니다.
- `release-note:start`와 `release-note:end` 사이의 내용은 이후 GitHub Release 본문으로 사용합니다.

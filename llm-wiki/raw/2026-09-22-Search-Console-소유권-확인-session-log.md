# 2026-09-22 Search Console 소유권 확인 세션 로그

이슈 #152를 구현한 세션의 경위입니다. 도달한 계약은 `wiki/2026-09-22-랜딩-화면과-검색-노출.md` 8절에 있습니다.

## 1. 계획 단계에서 드러난 것

이슈 본문은 코드 변경을 한 줄로 적어 두었습니다. `src/copy/shell.ts`의 `DOCUMENT_COPY`에 `verification.google`을 넣는 것입니다. 나머지 Task는 전부 Search Console 화면에서 사람이 하는 일이라, 계획을 세우면서 확인할 것은 둘이었습니다. 이 Next 버전에서 `verification`이 살아 있는지와, 사용자가 화면에서 누를 버튼이 실제로 눌리는 상태인지입니다.

첫 번째는 확인됐습니다. `node_modules/next/dist/lib/metadata/metadata.js` 546줄이 `metadata.verification.google`을 읽어 `<meta name="google-site-verification">`을 만들고, 타입도 `types/metadata-interface.d.ts` 330줄에 있습니다. 빈 문자열이면 태그를 만들지 않는다는 것도 같은 자리에서 봤습니다. 뒤에 테스트 한 건이 여기서 나왔습니다.

두 번째가 이슈에 없던 선행 조건이었습니다.

## 2. 프로덕션이 #149 이전이라는 것을 찾은 경위

이슈의 Task에 "프로덕션 배포 후 응답 HTML에 meta 태그가 있는지 확인"이 있어서, 배포 전 상태를 먼저 봤습니다.

```
curl https://sift-dev.vercel.app/sitemap.xml  -> 404
curl https://sift-dev.vercel.app/robots.txt   -> 404
curl https://sift-dev.vercel.app/             -> canonical·og 태그 없음
```

#149가 만든 것이 하나도 없었습니다. `origin/main`에는 `src/app/sitemap.ts`가 아예 없고 `origin/main..origin/develop`이 56 커밋이었습니다. 배포 기록으로 확인을 마쳤습니다.

```
gh api "repos/hm1n/SIFT/deployments?environment=Production"
  -> a518b13 (2026-09-17), eae1708, 23d97f7
gh api repos/hm1n/SIFT/deployments
  -> develop 머지 커밋들은 전부 Preview
```

`a518b13`은 `origin/main`이고 v0.1.1입니다. 프로덕션은 `main`에서만 만들어집니다. 즉 소유권 확인도 sitemap 제출도 develop→main 릴리즈 전에는 성공할 수 없습니다. 이슈 본문의 Goal에는 이 단계가 들어 있는데 Tasks에는 없습니다. 계획 보고에 이것을 먼저 적고 릴리즈 시점을 사용자에게 물었습니다. 답은 아직 받지 못했습니다.

## 3. 토큰 방식 혼선

이 세션에서 가장 오래 돈 자리입니다. 사용자가 세 번에 걸쳐 서로 다른 값을 전달했습니다.

1. `google-site-verification=i96YZ...` — DNS TXT 레코드용 값입니다. 만들다 만 도메인 속성에서 나온 값으로, 이슈 본문이 "HTML 태그 방식에 쓸 수 없다"고 미리 적어 둔 그 값입니다.
2. `google56add82e7cf0d833.html` 파일 — HTML 파일 업로드 방식용입니다. 이슈가 검토하고 접은 대안입니다.
3. `<meta name="google-site-verification" content="vfWA9bPz..." />` — 이것이 필요한 값이었습니다.

중간에 사용자가 "소유권 확인이 안 되면 이 값을 확인할 수가 없는데?"라고 물었습니다. 순서를 반대로 보고 있던 것이라, Search Console이 확인 **전에** 토큰을 보여 준다는 것을 설명했습니다. 속성 추가 → 확인 방법 선택 → 그 자리에서 토큰 표시 → 사이트에 심고 배포 → 확인 버튼 순입니다. 구글이 심으라고 주는 값이라 확인이 먼저일 수 없습니다.

혼선의 원인은 **확인 방법마다 토큰의 모양과 값이 다르다**는 것이 화면에서 잘 드러나지 않는다는 데 있습니다. DNS는 `google-site-verification=<값>`, 파일은 파일 이름 자체, HTML 태그는 `content`의 값뿐입니다. 셋 다 "google-site-verification"이라는 같은 이름을 달고 있어 같은 값으로 보입니다.

이 혼선을 테스트로 막았습니다. `shell.test.ts`의 "토큰이 DNS TXT 값이나 태그 전체가 아니다"가 `^google-site-verification\s*[=:]`와 `<` 포함 여부를 봅니다. 다음에 도메인이 바뀌어 토큰을 다시 받을 때 같은 실수를 하면 테스트가 먼저 잡습니다.

## 4. 테스트 세 건과 근거

| 테스트 | 막는 것 |
| --- | --- |
| 토큰이 비어 있지 않다 | Next가 빈 문자열이면 태그를 아예 만들지 않습니다. 태그가 없으면 구글의 재확인에서 속성 확인이 해제됩니다. |
| DNS TXT 값이나 태그 전체가 아니다 | 3절의 혼선입니다. 값이 틀려도 화면은 멀쩡하고 빌드도 통과합니다. |
| 법적 고지 화면이 자기 verification을 두지 않는다 | 선언 자리를 루트 하나로 고정합니다. `LEGAL_PAGE_METADATA`가 `satisfies Metadata`라 없는 속성에 접근하면 타입 오류가 나므로 `in` 연산자로 봅니다. |

## 5. 확인한 것

- dev 서버에서 `/`와 `/privacy` 응답에 `<meta name="google-site-verification" content="vfWA9bPz..."/>`가 나갔습니다. `/privacy`는 루트에서 물려받은 것이고 선언은 한 자리입니다.
- 테스트 115파일 2,153건, lint, typecheck 통과.

## 6. 남은 것

- Search Console의 확인 버튼과 Sitemaps 제출은 릴리즈 뒤입니다.
- DNS 방식으로 만들다 만 도메인 속성 제거(사용자).
- 릴리즈 시점 결정(사용자). 2절 참고.

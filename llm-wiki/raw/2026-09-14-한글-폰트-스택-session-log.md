# 한글 폰트 스택 점검과 수정 세션 로그 (2026-09-14)

이슈 #98 구현을 마친 뒤 사용자가 "채팅 화면의 한글 폰트가 뭘로 적용돼 있는지, Pretendard가 아직
적용 안 된 건지" 점검을 요청해 확인하고 고친 경위입니다. 도달한 결론은
`wiki/2026-09-10-디자인-토큰과-공통-셸.md` 1절의 "한글은 `--font-sans`가 담당합니다"에 있습니다.

앞 작업은 `raw/2026-09-14-이슈98-인터뷰-3열-워크스페이스-구현-session-log.md`입니다.

## 1. 로드는 되는데 참조가 두 곳뿐이었습니다

`layout.tsx`가 jsDelivr CDN으로 Pretendard를 싣고 `globals.css`에 `--font-pretendard` 토큰도 있는데,
그 토큰을 참조하는 곳을 세어 보니 `repository-select-screen.module.css`의 `.contributionCopy`와
`.textarea` **두 줄뿐**이었습니다.

`--font-sans`는 `var(--font-inter), ui-sans-serif, system-ui, -apple-system, sans-serif`였고 Pretendard가
없었습니다. `interview-stream-view.module.css`에는 `font-family` 선언이 하나도 없어 body를 그대로
물려받습니다. 그래서 채팅의 한글은 Pretendard를 거치지 않고 OS 기본 폰트로 떨어지고 있었습니다.

## 2. 추측을 끊으려고 두 가지를 확인했습니다

사용자가 "이 설정 반영하면 채팅에도 pretendard가 적용돼?"와 "기존 영어 폰트가 적용되던 영역도 다
pretendard로 바뀌는 거야?"를 이어서 물었습니다. 말로 답하지 않고 빌드된 CSS를 열었습니다.

- `--font-inter`가 실제로는 `"Inter", "Inter Fallback"` 두 개로 펼쳐지고, `Inter Fallback`은
  `src: local(Arial)`입니다.
- Inter의 `@font-face`에 등록된 `unicode-range`는 라틴·라틴 확장·키릴·그리스·베트남어뿐이고 한글
  범위 `U+AC00-D7A3`이 **없습니다.** 라틴 서브셋은 `U+??`(U+0000–00FF)를 포함합니다.

두 사실을 합치면 답이 나옵니다. 한글은 Inter와 Arial을 모두 지나쳐 Pretendard에서 처음 멈추고,
영문·숫자·문장부호는 라틴 서브셋에 들어가 Inter에서 멈춥니다. 대체가 요소 단위가 아니라 글자
단위로 일어나기 때문입니다.

## 3. 고친 뒤 실제로 선택된 폰트를 쟀습니다

`--font-sans`에 Inter 다음 자리로 Pretendard를 넣었습니다.

computed style은 선언한 스택 문자열만 돌려주므로 증거가 되지 못합니다. 그래서 dev 서버에 Playwright로
붙어 CDP의 `CSS.getPlatformFontsForNode`를 썼습니다. 이건 렌더러가 글자마다 실제로 고른 폰트 이름을
돌려줍니다.

```
한글-본문   → Pretendard Variable (18자), Inter (5자 ← 공백)
영문-본문   → Inter (18자)
숫자-기호   → Inter (20자)
mono-라벨   → Geist Mono (18자)
```

예상대로 갈렸습니다.

## 4. 실패와 우회

측정 스크립트를 스크래치패드에 두고 실행했더니 `Cannot find package 'playwright'`가 났습니다.
프로젝트 밖이라 모듈 해석이 안 됩니다. 프로젝트 디렉터리로 복사하면서 `from "playwright"`를
`from "@playwright/test"`로 바꿔 실행하고 바로 지웠습니다. 이 저장소는 `@playwright/test`만
의존성에 있습니다.

dev 서버를 배경으로 띄우려다 두 번 실패했습니다. `$TMPDIR`가 비어 있어 리다이렉트가 깨졌고, `&`와
`run_in_background`를 함께 쓰니 즉시 종료로 잡혔습니다. 결국 이미 3000번에 떠 있던 서버를 그대로
썼습니다.

## 5. 재지 못한 것

**인터뷰 채팅의 실제 한글은 재지 못했습니다.** 그 화면까지 가려면 GitHub 인증과 저장소 분석이
필요합니다. 대신 둘로 나눠 확인했습니다. `interview-stream-view.module.css`에 `font-family` 선언이
없어 body를 상속한다는 것을 코드로 확인하고, body의 `--font-sans`가 한글을 Pretendard로 해석한다는
것을 같은 조건의 주입 노드로 쟀습니다. 두 단계를 이으면 채팅도 Pretendard입니다. 직접 본 것은
아니라 위키 "확인 필요"에 남겼습니다.

## 6. 접은 대안

화면 모듈마다 `font-family: var(--font-pretendard)`를 다는 방법을 먼저 떠올렸다가 버렸습니다.
빠뜨리는 모듈이 반드시 생기고, 빠뜨려도 아무 신호가 없습니다. 이번에 드러난 문제가 정확히 그
모양이었습니다. 토큰 하나를 고쳐 전역에서 갈리게 하는 쪽을 골랐습니다.

`--font-pretendard`를 지우고 `--font-sans`로 합치는 것도 검토했다가 두었습니다. 기여 항목 입력 두
곳은 영문까지 Pretendard로 그리고 있어 뜻이 다릅니다. 다만 그 두 곳만 영문 폰트가 다른 화면과
다르다는 뜻이므로 의도한 것인지 확인이 필요하다고 위키에 적었습니다.

## 7. 남긴 확인 필요

- CDN이 막힌 환경의 대체 동작은 여전히 보지 않았습니다. `--font-sans`가 한글을 담당하게 된 뒤로
  영향 범위가 두 요소에서 전 화면으로 넓어졌습니다.
- Pretendard의 자간과 굵기가 Inter와 달라 줄바꿈 위치가 바뀔 수 있습니다. 코드 패널 파일명처럼
  `text-overflow: ellipsis`로 자르는 자리는 실물로 봐야 합니다.

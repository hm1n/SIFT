# 2026-09-22 랜딩 화면과 검색 노출 구현 세션 로그

이슈 #149를 구현한 세션의 경위입니다. 도달한 계약은 `wiki/2026-09-22-랜딩-화면과-검색-노출.md`에 있습니다.

## 1. 시안 위치를 찾은 경위

이슈는 피그마 시안 파일 경로를 `확인 필요`로 두고 작업을 시작할 때 전달받기로 적어 두었습니다. 계획을 세우면서 디자인 개편 backlog 31번이 "레퍼런스 `sift-landing-page.md`의 Hero·Steps·Core Model·Evidence·Final CTA 5개 섹션"과 "`TRANSLATIONS.ko`에 이 섹션들의 한국어 문구가 이미 있다"고 적어 둔 것을 보고 기존 레퍼런스 경로를 먼저 확인했습니다.

`C:\Users\user\Desktop\Chat Interface Design`에 이미 있었습니다. `src/App.tsx`의 `LandingPage`(2039줄)와 `LandingProductPreview`(1853줄), 스펙 `src/imports/pasted_text/sift-landing-page.md`, 한국어 문구 `TRANSLATIONS.ko`(382~410줄)입니다. `App.tsx` 갱신 시각은 2026-09-18 11:30이었고 사용자가 그 뒤 갱신이 없다고 확인해 주었습니다.

즉 이슈의 `확인 필요` 첫 항목은 새 파일을 받는 일이 아니라 이미 있는 레퍼런스를 확인하는 일이었습니다.

## 2. 사용자에게 물은 것과 답

계획을 보고할 때 넷을 물었습니다.

1. 기준 도메인 — `https://sift-dev.vercel.app`으로 확정.
2. Open Graph 이미지의 출처 — 사용자가 따로 작업해 전달. 그래서 이번 구현에서는 만들지 않고, 파일만 떨어뜨리면 끝나는 구조로 두었습니다.
3. Hero의 `무료 · 카드 등록 불필요` — 없애기로 결정.
4. 시안 갱신 여부 — 갱신 없음.

3번을 없애기로 정한 뒤, 같은 주장을 하는 자리가 하나 더 있는 것을 찾아 함께 뺐습니다. `SoftwareApplication` 구조화 데이터의 `offers`입니다. 문구만 지우고 구조화 데이터에 가격을 넣으면 화면에는 없는 주장이 검색엔진에만 나갑니다.

## 3. 도구가 막은 것

두 가지를 우회했습니다.

**rtk 프록시가 `ls`와 `find` 출력을 걸러냈습니다.** `ls node_modules/next/`가 `package.json`을 빼고 보여 주고 `find node_modules/next -name "*.d.ts" | wc -l`이 0을 돌려줘, node_modules가 깨진 것으로 잠시 판단했습니다. `node -e "fs.existsSync(...)"`로 다시 확인하니 넷 다 존재했습니다. `node_modules/next/dist/docs`도 있었습니다. 파일 존재 여부는 셸 목록 명령이 아니라 Node로 확인해야 합니다.

**`smart_grep`이 패턴에 0건을 돌려줬습니다.** `filesSearched: 565`를 보고하면서 `path` 인자를 무시하고 매번 0건이었습니다. 2026-09-18 세션에서도 같은 증상이 기록되어 있습니다(`raw/2026-09-18-운영-준비-점검과-P0-이슈-분리-session-log.md`). 파일 목록을 Node로 훑어 줄 단위로 검사하는 스크립트로 우회했습니다. 세션 후반에는 token-optimizer MCP 서버 자체가 연결이 끊겼습니다.

## 4. Next 16 문서에서 확인한 것

프로젝트 규칙대로 `node_modules/next/dist/docs/`를 먼저 읽었습니다.

- `03-file-conventions/01-metadata/sitemap.md`와 `robots.md`: `MetadataRoute.Sitemap`·`MetadataRoute.Robots` 반환 형태.
- `04-functions/generate-metadata.md` 1418줄: 자식이 `openGraph`를 정의하지 않으면 부모 값을 통째로 물려받습니다. 이슈 Task는 `/privacy`·`/terms`에 canonical만 추가하라고 적었는데, 이 문장 때문에 Open Graph도 함께 내려야 한다는 것이 드러났습니다. 계획 보고에 함정으로 적고 테스트로 막았습니다.
- `01-getting-started/14-metadata-and-og-images.md`와 `03-file-conventions/01-metadata/opengraph-image.md`: 파일 규약이 절대 주소와 크기·타입 메타 태그를 만들어 줍니다. `twitter-image`는 별도 규약이지만 X가 `twitter:image` 부재 시 `og:image`로 대체하므로 파일 하나로 둘을 덮을 수 있습니다.
- `02-guides/json-ld.md`: `<`를 `\u003c`로 바꾸라는 권고.

## 5. 접은 대안

**`/login` 분리.** 이슈가 이미 검토하고 접은 대안입니다. 콜백 경로와 쿼리 수신 경로, `login_view` 위치, `page.test.tsx`가 모두 바뀝니다.

**랜딩을 클라이언트 컴포넌트 안에서 import.** 가장 단순한 배치였지만 정적 마크업 약 340줄이 JS 번들에 실립니다. `page.tsx`가 랜딩을 서버에서 그려 `children`으로 넘기는 쪽을 택했습니다.

**미리보기를 이미지로 두기.** 스펙이 실제 인터페이스를 추상 목업으로 대체하지 말라고 정했고, 이미지는 해상도마다 따로 만들어야 하며 글자가 흐려집니다. DOM으로 그리고 `role="img"`로 한 장의 그림처럼 노출했습니다.

**미리보기 예시 데이터를 컴포넌트 안에 두기.** 그림의 내용이지 제품 문구가 아니라는 이유로 컴포넌트 상수로 둘까 검토했지만, 프로젝트 규칙이 화면 문구를 `src/copy`에 모으라고 정하고 있어 `copy/landing.ts`에 넣었습니다. 예외를 만들면 어느 문구가 어디 있는지 판정 기준이 하나 더 생깁니다.

**`globals.css`에 neutral 토큰 넷을 추가.** neutral-50·600·700·800이 토큰에 없습니다. 이 화면만을 위해 공용 토큰을 늘리지 않고 `button.module.css`·`top-header.module.css`와 같이 리터럴로 뒀습니다.

**`SITE_URL`을 환경변수로.** 미리보기 배포마다 값이 달라지면 미리보기 주소가 canonical로 색인될 수 있어 상수로 고정했습니다.

**`sitemap`에 `lastModified` 넣기.** `new Date()`는 배포마다 갱신을 알리고, 손으로 적으면 고칠 자리가 하나 늘어납니다.

## 6. 테스트가 잡아낸 것

**`reference-ko.test.ts`가 `answerQuestion` 항목에서 red가 되었습니다.** 미리보기의 답변 입력칸 문구를 레퍼런스 값(`질문에 답하세요...`)으로 옮겼는데, 이 Repository는 그 자리를 이미 다르게 쓰기로 정하고 표에 사유를 적어 두었습니다. 표는 "사유를 적은 문구가 다시 쓰이기 시작하면 표가 낡은 것"이라고 판정하는데, 실제로는 표가 아니라 제 값이 틀린 경우였습니다. 미리보기는 실제 제품 화면을 보여 주는 자리이므로 `STREAM_VIEW_COPY.answerPlaceholder`와 `STREAM_VIEW_COPY.send`를 가져오도록 고쳤습니다. 레퍼런스 값을 그대로 옮기면 랜딩에서 본 화면과 로그인한 뒤 화면의 같은 자리가 달라집니다.

**`landing-page.test.tsx`에서 글자 검색이 두 곳을 잡았습니다.** `INTERVIEW`가 사용 흐름의 단계 이름이면서 핵심 제품 모델의 열 이름이고, `CODE`가 근거 종류 태그이면서 흐름 표기에 있습니다. 전자는 섹션으로 좁히고 후자는 `dt`/`dd`의 `term`·`definition` 역할로 짝을 맞춰 확인하도록 고쳤습니다.

## 7. 브라우저에서 확인하다 찾은 결함 둘

Playwright 전체 화면 캡처가 Hero와 미리보기 아래를 빈 화면으로 찍었습니다. `window.scrollTo`도 듣지 않았습니다. 원인은 이 앱의 스크롤 컨테이너가 `html`이 아니라 `body`라는 것이었습니다. `globals.css`가 `body`에 `height: 100%`와 `overflow-x: hidden`을 주고 있어 `overflow-y`가 `auto`로 계산됩니다. `document.body.scrollTo`와 마우스 휠로는 정상 동작했습니다. 랜딩의 문제가 아니라 기존 동작이었습니다.

`body`를 스크롤해 아래 섹션을 보고 결함 둘을 찾았습니다. 둘 다 테스트로는 잡히지 않는 것이었습니다.

**섹션 라벨이 mono 대체 글꼴로 떨어졌습니다.** `핵심 제품 모델`·`근거 기반 접근` 같은 한국어 라벨에 `--font-mono`를 줬는데 Geist Mono에 한글 글리프가 없습니다. 거기에 `0.1em` 자간이 붙어 글자가 흩어져 보였습니다. 레퍼런스를 다시 읽으니 이 자리는 `font-mono`가 아니라 `font-ui`이고, KO에서 `font-ui`는 Pretendard였습니다. 제가 레퍼런스를 잘못 읽은 것입니다. `--font-sans`로 고쳤습니다. 디자인 개편 backlog 29번이 적어 둔 문제와 같은 자리입니다.

**섹션 제목 색이 읽을 수 없는 회색이었습니다.** 레퍼런스의 neutral-400을 그대로 썼는데, `globals.css`가 그 색(`--color-foreground-faint`)에 "흰 배경에서 대비가 약 2.5:1이라 읽어야 하는 글자에는 쓰지 않는다"고 적어 두었습니다. 그 자리의 셋은 `h2`입니다. `site-footer.module.css`가 같은 이유로 링크 색을 올린 전례를 따라 `--color-muted-foreground`로 올렸습니다. 근거 종류 태그와 그 아래 출처 줄도 같이 올렸습니다. 장식인 큰 마크와 `01`~`04` 번호, `aria-hidden`인 흐름 표기는 원본 값으로 뒀습니다.

사용 흐름의 번호-라벨-설명 간격도 이때 고쳤습니다. 레퍼런스는 번호와 본문 사이가 20px, 라벨과 설명 사이가 8px인데 셋을 한 grid에 넣어 전부 20px이 되어 있었습니다. 라벨과 설명을 `div`로 묶었습니다.

## 8. 확인한 것과 확인하지 못한 것

확인한 것입니다.

- 테스트 114파일 2,142건, lint, typecheck 통과. 프로덕션 빌드 성공. `/robots.txt`와 `/sitemap.xml`이 정적 라우트로 생성됩니다.
- dev 서버에서 세 경로의 canonical과 Open Graph, `/robots.txt`와 `/sitemap.xml` 본문을 읽었습니다.
- 1440·820·390px 세 폭에서 가로 스크롤이 생기지 않았습니다.
- `?auth_error=access_denied`가 ERROR / AUTH를, `?withdrawn=done_kept`가 안내와 랜딩을 함께, CTA 클릭이 AUTHENTICATING을 그렸습니다.

확인하지 못한 것입니다.

- Open Graph 미리보기 카드입니다. 이미지가 없어 제목과 설명만 나갑니다.
- 실제 배포 뒤의 색인과 Search Console 등록입니다.
- 실제 GitHub 로그인 왕복입니다. dev에서 클릭 뒤 상태 전환까지만 봤습니다.

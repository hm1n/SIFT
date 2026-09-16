# 2026-09-16 Repository 선택 화면 스크롤 실측과 셀프 리뷰 session log

이슈 #135(`[bugfix/repository-selection] Repository 목록 영역 스크롤 불가`) 구현 세션입니다. 도달한 결론은 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md` 8절에 있습니다. 이 파일에는 무엇을 어떤 순서로 쟀고 무엇이 어긋났는지를 남깁니다.

## 1. 계획 단계에서 세운 가설과 그 결과

이슈 본문을 읽고 코드를 대조해 계획을 세웠습니다. 이때 세운 가설 셋 가운데 둘이 실측에서 틀렸습니다.

| 계획에서 적은 것 | 실측 결과 |
| --- | --- |
| `.screen`에 `min-height: 0`, `.body`에 `overflow-y: auto`가 없어 잘린다 | 맞았습니다 |
| 수정 후 `.footer`의 `position: sticky`는 무효화되므로 지워도 된다 | **틀렸습니다.** 수정 전에도 sticky는 동작 중이었습니다 |
| 모바일 폭에서는 이슈 말대로 페이지 스크롤이 동작할 것이다 | **틀렸습니다.** 모바일도 똑같이 막혀 있었습니다 |

사용자에게 계획을 보고할 때 "모바일 실측이 이슈 전제와 어긋나면 모바일은 별도 이슈로 분리하겠다"고 적었는데, 실제로 어긋났지만 분리할 필요는 없었습니다. 같은 수정이 두 폭을 함께 고쳤기 때문입니다.

## 2. 측정 수단을 고른 과정

이 화면은 GitHub OAuth 세션이 있어야 닿습니다. 실제 앱을 띄워 재려면 로그인이 필요하고 이 워크트리에는 OAuth 앱 설정이 없습니다(`wiki/2026-09-11-...` 7절에 같은 제약이 이미 적혀 있습니다).

검토한 대안 셋입니다.

1. `next dev`를 띄우고 세션 쿠키를 흉내 내 진입: 인증 계층을 우회하는 코드를 세션용으로 만들어야 해서 접었습니다.
2. `react-dom/server`로 실제 컴포넌트를 렌더해 HTML을 뽑기: vitest가 CSS Module을 키 이름 그대로 돌려주므로 가능하지만, 하네스 생성 스크립트를 저장소 안에 임시로 넣었다 지워야 합니다. 커밋에 섞일 위험이 있어 접었습니다.
3. **채택** — 실제 CSS 파일 네 개(`globals.css`, `top-header.module.css`, `app-shell.module.css`, `repository-select-screen.module.css`)를 그대로 읽고, CSS Module의 스코프만 클래스 접두어(`th-`, `sh-`, `sel-`)로 흉내 낸 정적 HTML 하네스. 마크업은 `repository-select-screen.tsx`의 JSX를 그대로 옮겨 적었습니다. 파일은 scratchpad에 두고 저장소에 남기지 않습니다.

접두어를 붙인 이유는 `top-header.module.css`와 `repository-select-screen.module.css`가 둘 다 `.header`를 정의해서입니다. 실제 앱에서는 CSS Module이 갈라 주지만 한 파일로 합치면 충돌합니다.

`repository-analysis.module.css`에 남아 있는 2026-09-15 실측 주석(`body.scrollHeight 422, html.scrollHeight 1036`)이 같은 방식의 선례입니다.

## 3. 테스트 하네스가 처음부터 깨져 있던 것

Playwright를 부르려는 첫 시도가 `Cannot find module 'playwright/test'`로 실패했습니다. `node_modules/playwright`와 `node_modules/playwright-core`에 `lib`만 있고 `package.json`이 없었습니다. `npm install`로 한 번 복구해 Chromium은 떴지만, 이어서 돌린 vitest가 이번에는 rolldown 네이티브 바인딩을 찾지 못했습니다.

`.node` 파일을 직접 `require`해 보니 `is not a valid Win32 application`이었습니다. 3.0MB로 크기는 그럴듯한데 내용이 깨진 파일이었습니다. **제 변경과 무관하게 기존 테스트도 같은 오류로 돌지 않는 상태**였음을 `updated-label.test.ts`로 확인하고 `npm ci`로 전체를 다시 깔았습니다. `package.json`과 lockfile은 건드리지 않았습니다.

여기서 시간을 쓴 이유는 처음에 "내가 방금 실행한 `npm install`이 깨뜨렸나"를 의심했기 때문입니다. 기존 테스트를 먼저 돌려 봤으면 더 빨리 갈랐을 것입니다.

## 4. 수정 전 측정과 전제가 뒤집힌 순간

Repository 30개, 1280x800과 390x844에서 쟀습니다.

수정 전 데스크톱에서 footer의 위치가 top 753 / bottom 800으로 나왔습니다. 화면 안입니다. 이슈 본문은 "하단의 `분석하기` 바도 화면 밖으로 밀려 보이지 않습니다"라고 적었는데 그렇지 않았습니다.

이유를 좇아 보니 `.content`의 `overflow: hidden`이 스크롤포트를 만들고 있었습니다. 스크롤포트는 사용자가 스크롤할 수 있는지와 무관하게 sticky의 기준이 됩니다. 그래서 `position: sticky; bottom: 0`이 하단 바를 붙들고 있었습니다.

**계획서에서 저는 sticky가 "무효화될 것"이라고 적었습니다.** 실제로는 반대로, 그때 하단 바를 붙들던 유일한 장치였습니다. 스크롤 컨테이너를 만들기 전에 sticky부터 지웠다면 이슈가 묘사한 "하단 바가 밀려 보이지 않는" 상태를 제가 직접 만들었을 것입니다. 순서가 안전을 결정한 자리였습니다.

같은 실행에서 모바일 폭도 `documentElement.scrollHeight`와 `clientHeight`가 844로 같았습니다. 페이지가 스크롤하지 않습니다. `@media (max-width: 720px)`는 `.shell`만 `overflow: visible`로 바꾸고 `.content`의 `overflow: hidden`은 그대로 둡니다. 이슈 본문의 "모바일에서는 지금도 페이지 스크롤이 동작합니다"는 `.shell`만 보고 `.content`를 보지 않은 판단이었습니다.

## 5. 수정과 확인

`.screen`에 `min-height: 0`, `.body`에 `overflow-y: auto`를 넣고 `.footer`의 sticky를 뺐습니다. 이때는 `saved-interview-screen.module.css`를 참조 모델로 삼아 `.body`의 `min-height: 0`과 `.header`·`.footer`의 `flex-shrink: 0`도 함께 넣었습니다.

Repository 30개와 3개, 두 폭에서 다시 쟀습니다. `.body`의 clientHeight가 2361→618(데스크톱)과 3171→529(모바일)로 스크롤 컨테이너가 되고, 마지막 Repository와 기여 textarea에 닿고, 하단 바는 sticky 없이도 계속 보였습니다. Repository 3개일 때는 데스크톱에 스크롤이 생기지 않고 하단 바는 같은 자리에 남았습니다(`.body`가 `flex: 1`이라 짧아도 공간을 채웁니다).

## 6. 회귀 테스트를 어디까지 고정할 수 있었나

jsdom은 레이아웃을 계산하지 않아 "스크롤되는지"를 렌더 테스트로 단언할 수 없습니다. 같은 제약을 이미 겪은 선례가 `css-module-class-reference.test.ts`이고 거기서 택한 방법이 렌더 대신 소스 읽기라, 같은 방법을 썼습니다.

처음 쓴 테스트는 CSS 블록 파서(`declarations()`)를 두고 `.screen`과 `.body`를 각각 떼어 보는 50줄이었습니다. 수정 전 CSS에 대고 돌려 두 단정이 모두 실패하는 것을 확인했습니다.

## 7. 셀프 리뷰(ponytail)에서 제 수정을 깎은 것

PR 전에 사용자가 셀프 리뷰를 지시했습니다. 두 가지가 나왔고 둘 다 제가 넣은 것이었습니다.

**(1) 아무 일도 하지 않는 선언 3개.** `.body`의 `min-height: 0`은 `overflow-y: auto`가 이미 automatic minimum size를 0으로 만들어 무효입니다(자동 최소 크기는 `overflow: visible`일 때만 걸립니다). `.header`와 `.footer`의 `flex-shrink: 0`은 둘 다 `min-height`가 `auto`라 내용 높이 아래로 줄지 않아 무효입니다. 줄어들 여지는 `.body`가 먼저 흡수합니다.

셋을 뺀 CSS로 1280x800, 390x844, 그리고 세로를 360px까지 줄인 1280x360에서 다시 쟀습니다. header 91px·footer 47px·스크롤 가능 여부·마지막 행 도달·기여 textarea 도달·하단 바 가시성이 전부 같았습니다. 지웠습니다.

넣을 때 제가 댄 근거는 "형제 화면과 구조를 같게 두면 나중에 `overflow-y`를 손대도 안전하다"였습니다. 일어나지 않은 일을 근거로 삼은 것이고, 재 보면 바로 갈리는 것을 재지 않고 넣었습니다. 사용자에게 보고할 때 "중복 선언이지만 남겼습니다"라고 적었는데, 그 문장 자체가 근거 없는 선언을 산문으로 방어한 것이었습니다.

`saved-interview-screen.module.css`에 있는 같은 선언들도 무효일 가능성이 있지만 이번 범위가 아니라 재지 않았습니다.

**(2) 검사보다 큰 테스트.** 정규식 두 줄이면 되는 일에 블록 파서와 "규칙을 찾지 못했습니다" 예외 경로를 들고 있었습니다. 호출처가 둘뿐이고 블록이 통째로 사라지면 인라인 정규식도 똑같이 실패합니다. 50줄에서 22줄로 줄이고, 수정 전 CSS에 대고 다시 돌려 여전히 실패하는 것을 확인했습니다.

셀프 리뷰 뒤 남은 동작 변경은 세 줄입니다. `.screen`의 `min-height: 0` 추가, `.body`의 `overflow-y: auto` 추가, `.footer`의 sticky 제거.

## 8. 함께 본 것과 손대지 않은 것

- 스크롤바 모양: `globals.css`의 `::-webkit-scrollbar`가 전역이라 새 스크롤 컨테이너가 그대로 물려받습니다. 모듈에 추가할 것이 없습니다.
- 방향키 이동: 스크롤 컨테이너가 생겨 포커스가 옮겨갈 때 브라우저가 행을 끌어옵니다. 전에는 잘려 있어 아무 일도 일어나지 않던 자리라 코드 없이 나아집니다. 라디오 그룹 동작 자체는 건드리지 않았습니다(이슈 Constraint).
- `AppShell`과 `globals.css`는 이슈 Constraint대로 건드리지 않았습니다.

## 9. 남은 것

- 실제 계정으로 여는 확인은 하지 못했습니다. 수동 확인 절차는 `wiki/2026-09-11-Repository-목록-조회와-선택-화면.md` 8절에 있습니다.
- `repository-flow.test.tsx`의 이탈 확인 테스트가 전체 실행 1회에서 실패하고 이어진 3회에서 재현되지 않았습니다. 어느 파일인지 잡지 못했고, `log.md`에 이미 두 번 기록된 부하 상황 flaky와 같은 건일 수 있습니다.

# 2026-09-15 GA4 측정 ID 배선과 브라우저 실측 세션 로그

`raw/2026-09-15-GA4-퍼널-계측-설계-session-log.md`를 이어받습니다. 앞 로그는 설계와 1단계 구현까지고,
이 로그는 실제 측정 ID(`G-FZYPE79375`)를 받아 배선하고 프로덕션 빌드를 브라우저로 두드려 본 경위입니다.

확정된 계약은 `wiki/2026-09-15-GA4-퍼널-계측.md`에 있습니다.

## 1. 로컬 배선

이 워크트리에 `.env.local`이 없었습니다(`.gitignore`가 `.env*`를 무시하므로 워크트리마다 따로
둡니다). 측정 ID와 새로 만든 `GA_USER_ID_HMAC_SECRET`(32바이트 난수)을 넣었습니다. 비밀값은 셸에
출력하지 않고 파일에 바로 썼습니다.

## 2. 프로덕션 빌드를 띄우자마자 500이 났습니다

가장 큰 수확입니다. `?auth_error=...`가 붙은 요청이 전부 500이었습니다.

```
Error: Attempted to call toAuthErrorParam() from the server but toAuthErrorParam is on the client.
```

`src/app/page.tsx`는 서버 컴포넌트인데 `login_result`의 분류를 만들려고 `toAuthErrorParam`을 불렀고,
그 함수는 `"use client"`가 붙은 `login-screen.tsx`에 있었습니다. Next.js는 클라이언트 모듈의 함수를
서버에서 부르는 것을 렌더 단계에서 끊습니다.

**vitest는 이것을 잡을 수 없습니다.** 테스트는 모듈 그래프가 하나이고 `"use client"` 지시어가
아무 경계도 만들지 않아 15개 테스트가 모두 통과했습니다. 빌드도 통과했습니다. 서버를 띄우고 그
주소를 실제로 요청해야만 드러납니다.

판정과 안내표를 `src/features/auth/auth-error.ts`로 옮겨 서버와 클라이언트가 같은 표를 보되 어느
쪽도 경계를 넘지 않게 했습니다. 왜 이 파일이 따로 있는지를 그 파일 주석에 남겼습니다.

## 3. 로그인 전에 빈 `user_id`가 실리고 있었습니다

수집 요청을 가로채 보니 `login_view`에 `uid=`가 빈 문자열로 붙어 있었습니다.

`setAnalyticsUser(null)`이 `gtag('set', { user_id: null })`을 부르는데, gtag가 null을 빈 문자열로
직렬화해 **이후 모든 이벤트에** 실어 보냅니다. 기능 정의서는 "로그인 전에는 붙지 않습니다"입니다.

한 번도 세운 적이 없으면 아예 부르지 않도록 고쳤습니다. 한 번이라도 세운 뒤의 null은 그대로
보냅니다. 로그아웃은 새로고침 없이 서버 컴포넌트만 다시 그리므로, 지우지 않으면 앞 사용자의
`user_id`가 계속 붙습니다.

## 4. `login_start`를 찾느라 오래 걸렸습니다

수집 요청에 `login_start`가 보이지 않았습니다. 네 가지를 차례로 의심했습니다.

1. **클릭이 이벤트를 안 만든다** — `dataLayer`를 직접 읽어 `["event","login_start",{}]`가 들어 있는
   것을 확인했습니다. 코드는 정상이었습니다.
2. **페이지 이동이 전송을 삼킨다** — 클릭이 곧바로 로그인 라우트로 떠나므로 캡처 단계에서
   `preventDefault`만 걸어 문서를 남겼습니다. 그래도 수집 요청에는 안 보였습니다.
3. **`route.abort()`가 gtag의 다음 전송을 접는다** — 204로 대신 응답하도록 바꿨습니다. 변화가
   없었습니다. 다만 이 편이 안전하므로 그대로 두었습니다.
4. **정답: `navigator.sendBeacon`의 본문을 Playwright가 읽지 못합니다.** 가로채기를 아예 걸지 않은
   경우에도 클릭 뒤 POST가 1건 잡히는데 `postData()`가 비어 있었습니다. gtag가 클릭 직후의 이벤트를
   beacon으로 보내기 때문입니다.

그래서 확인 대상을 **수집 요청 본문에서 `window.dataLayer`로** 바꿨습니다. 전송 경로가 아니라 우리
코드가 무엇을 실었는지를 보는 것이므로 확인하려는 것에 더 가깝습니다. 전송이 실제로 일어나는지는
수집 요청 수로 따로 봅니다.

이 과정에서 `page.evaluate` 안에 이름 붙인 화살표 함수를 두면 tsx가 넣는 `__name` 헬퍼 때문에
`ReferenceError`가 나는 것도 겪었습니다. 평가 함수 안에서는 헬퍼 없이 씁니다.

## 5. 실측 결과

`scripts/measure-ga-events.mts`로 프로덕션 빌드를 두드렸습니다.

```
가로채기 켬(204로 대신 응답) · 수집 요청 4건
  event login_view {}
  event login_start {}
  event login_result {"success":false,"error_kind":"config_missing"}
  event login_view {"auth_error":"config_missing"}
로그인 경계 이벤트가 모두 기대대로 나갔습니다.
```

`--send`로 한 번 더 돌려 실제 속성으로도 전송되는 것을 확인했습니다. 확인용 히트 4건이 속성에
들어가 있습니다.

로그인 뒤 여섯 종은 GitHub OAuth와 LLM 호출이 있어야 도달해 이 스크립트로 확인할 수 없습니다.
DebugView 절차를 위키에 남겼습니다.

전체 테스트 1,435개, typecheck, lint 통과입니다.

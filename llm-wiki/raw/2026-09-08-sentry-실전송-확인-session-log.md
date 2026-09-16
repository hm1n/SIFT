---
출처: 실제 Sentry DSN을 받아 프로덕션 빌드에서 이벤트를 실제로 보내고 ingest 응답을 확인
확인 날짜: 2026-09-08
관련: wiki/2026-09-08-sentry-클라이언트-계측.md, raw/2026-09-08-sentry-release-주입-정정-session-log.md, raw/2026-09-08-sentry-클라이언트-계측-session-log.md
---

# Sentry로 실제 전송을 확인한 세션

## 이 문서가 담는 것

앞선 두 세션은 Playwright가 ingest 요청을 가로채 envelope 내용만 확인했습니다. 실제 Sentry 프로젝트가
없었기 때문입니다. 이 세션에서 DSN을 받아 가로채기를 끄고 실제로 보냈습니다.

## 설정

DSN을 `.env.local`에 넣었습니다. `.gitignore`의 `.env*` 규칙이 이 파일을 무시하는 것을
`git check-ignore`로 확인한 뒤에 넣었습니다. `NEXT_PUBLIC_` 접두사가 붙은 값이라 빌드 시점에
번들로 인라인되므로 빌드를 다시 만들었습니다. 클라이언트 청크 하나에 DSN 호스트가 들어간 것을
확인했습니다.

프로젝트는 `o4511411247251456`의 `4512049364140032`입니다. organization과 project 슬러그는 DSN에
들어 있지 않으므로 여전히 모릅니다.

## 결과

envelope 4건이 나가고 전부 200으로 수락되었습니다.

| envelope | 항목 | 지표 | event_id |
| --- | --- | --- | --- |
| 1 | transaction, op=pageload | fcp, fp, lcp, ttfb, ttfb.requestTime, connection.rtt | `41d1417ab9c94a138211769cd2787916` |
| 2 | event | 없음, 클라이언트 런타임 오류 | `4c6fc31c82b84146adb168fd885ae29e` |
| 3 | span, op=ui.interaction.click | inp | 없음 |
| 4 | span, op=ui.webvital.cls | cls | 없음 |

가로채기를 켠 상태에서 관찰했던 전송 경로와 같습니다. 지표 다섯 개가 모두 실제로 나갔습니다.

## 오류 수집도 함께 확인했습니다

이슈 #81의 Goal에 "클라이언트 런타임 오류가 Sentry Issues에 수집됩니다"가 있어서 함께 확인했습니다.
`setTimeout` 안에서 예외를 던져 전역 오류 핸들러를 밟게 했습니다. 메시지는
`issue-81 verification: client runtime error reaches Sentry Issues`입니다. **확인용으로 일부러 만든
이벤트이므로 Sentry Issues에서 지워야 합니다.**

## 확인하지 못한 것

**Sentry 화면을 직접 보지 못했습니다.** DSN은 이벤트를 쓰는 권한만 주고 읽는 권한을 주지 않습니다.
프로젝트를 조회하려면 auth token이 필요하고 이 세션에는 없습니다.

그래서 이 기록이 말할 수 있는 것은 ingest가 이벤트를 2xx로 수락했다는 것까지입니다. Sentry 쪽
inbound filter나 quota가 이후 단계에서 이벤트를 버리는 경우는 이 응답으로 구분되지 않습니다. 위
event_id 두 개로 화면에서 직접 조회하면 닫힙니다.

**인터뷰 화면에서 재지 않았습니다.** 라우트가 `/` 하나라 SDK 동작은 화면과 무관하지만, 스트리밍이
실제로 만드는 CLS 크기는 여전히 재지 않았습니다. 앞선 세션과 같은 이유입니다.

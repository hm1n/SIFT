import type { NextConfig } from "next";
// `@sentry/nextjs` 루트에서 가져오면 v11에서 동작을 멈춘다는 deprecation 경고가 나옵니다.
import { withSentryConfig } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * 이슈 #81에서 `@sentry/nextjs`를 도입했습니다. 이 래핑은 클라이언트 스택 프레임 정규화에
 * 필요한 값(`assetPrefix`, `basePath`)을 번들에 주입합니다.
 *
 * Source Map은 이번 범위가 아니라 명시적으로 끕니다. Releases와 Source Map 업로드는 후속
 * 이슈입니다.
 *
 * `release.create`를 끕니다. 이 옵션은 Release 생성만 막는 것이 아니라 release 이름 자체를
 * 없앱니다. `resolveReleaseName`이 `create !== false`일 때만 `getSentryRelease()`와 Git
 * revision을 탐색하므로, 켜 두면 auth token이 없어도 커밋 SHA가 `_sentryRelease`로 클라이언트
 * 번들에 인라인되고 모든 이벤트에 release 값이 붙습니다. 이슈 #81의 Non-goal이 Releases를 범위
 * 밖으로 두었으므로 값이 붙지 않아야 합니다. 실측 근거는
 * `llm-wiki/raw/2026-09-08-sentry-release-주입-정정-session-log.md`에 있습니다.
 *
 * `telemetry`를 끕니다. 기본값이 켜짐이라 빌드마다 Sentry로 빌드 정보가 나갑니다. 이번 이슈의
 * 수집 대상은 브라우저 지표와 클라이언트 오류뿐이므로 빌드 도구의 사용 통계는 보내지 않습니다.
 *
 * `silent`는 켜지 않습니다. 프로덕션 빌드가 auth token이 없다는 경고를 남기는데, 그 경고 하나를
 * 지우려고 Sentry 빌드 로그를 전부 끄면 이후의 실제 경고까지 가려집니다. 경고는 Releases 후속
 * 작업에서 auth token을 넣으면 사라집니다.
 */
export default withSentryConfig(nextConfig, {
  sourcemaps: { disable: true },
  release: { create: false },
  telemetry: false,
});

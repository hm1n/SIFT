import type { NextConfig } from "next";
// `@sentry/nextjs` 루트에서 가져오면 v11에서 동작을 멈춘다는 deprecation 경고가 나옵니다.
import { withSentryConfig } from "@sentry/nextjs/config";
import type { SentryBuildOptions } from "@sentry/nextjs/config";

const nextConfig: NextConfig = {
  /* config options here */
};

/**
 * 이슈 #81에서 `@sentry/nextjs`를 도입했습니다. 이 래핑은 클라이언트 스택 프레임 정규화에
 * 필요한 값(`assetPrefix`, `basePath`)을 번들에 주입합니다.
 *
 * 이슈 #144에서 Source Map 업로드와 release 연결을 켰습니다. 이슈 #81과 #136이 오류를 모으는
 * 데까지만 하고 둘을 범위 밖에 두었는데, 그러면 오류가 들어와도 스택이 번들 기준이라 어느 코드인지
 * 드러나지 않고 release가 없어 어느 배포에서 난 것인지도 가려지지 않습니다.
 *
 * `release.create`를 켭니다. 이슈 #81은 이 옵션을 껐습니다. 옵션이 Release 생성만 막는 것이 아니라
 * release 이름 자체를 없애기 때문입니다. `resolveReleaseName`이 `create !== false`일 때만 이름을
 * 해소하고, 해소한 이름은 `setUpBuildTimeVariables`가 `next.config`의 `env._sentryRelease`로
 * 넣습니다. Next.js의 `env`는 클라이언트와 서버 양쪽 번들에 인라인되므로 커밋 SHA가 번들에 실리고
 * 모든 이벤트에 release가 붙습니다. 이슈 #81은 Releases가 범위 밖이라 그것을 막으려 껐고, 이번
 * 이슈는 배포를 구분하는 것이 목표라 같은 동작이 의도한 결과가 됩니다. 이름은 Vercel에서
 * `VERCEL_GIT_COMMIT_SHA`로, 로컬에서 `git rev-parse HEAD`로 잡힙니다. 뒤집은 경위는
 * `llm-wiki/wiki/2026-09-18-sentry-source-map-release.md`에 있습니다.
 *
 * `sourcemaps.disable`을 지우고 `deleteSourcemapsAfterUpload`를 켭니다. Next.js 16은 번들러 플래그가
 * 없으면 `TURBOPACK`을 세팅하고 Turbopack으로 빌드하므로 `@sentry/nextjs`가 Turbopack 경로를 탑니다.
 * 그 경로는 Source Map 업로드가 켜지면 `productionBrowserSourceMaps`를 자동으로 켜서 브라우저가
 * 받을 수 있는 자리에 맵을 만듭니다. 업로드한 뒤 지우지 않으면 소스가 그대로 공개됩니다. SDK가 같은
 * 조건에서 이 값을 기본으로도 켜 주지만, 누군가 `productionBrowserSourceMaps`를 직접 설정하는 순간
 * 그 기본값이 조용히 사라지므로 명시합니다. 삭제 대상은 `.next/static`뿐입니다. 서버 맵은 브라우저에
 * 노출되지 않으므로 남겨서 서버 스택도 원래 위치를 가리키게 합니다.
 *
 * `org`와 `project`를 코드에 적습니다. 둘 다 비밀값이 아니고, 환경변수로만 두면 값이 빠졌을 때 빌드는
 * 성공하면서 업로드만 조용히 건너뜁니다. 비밀값인 auth token만 `SENTRY_AUTH_TOKEN`으로 받습니다.
 * 토큰이 없으면 업로드와 Release 생성을 건너뛸 뿐 예외를 던지지 않으므로, 토큰을 넣지 않은 로컬
 * 빌드도 그대로 끝납니다.
 *
 * `telemetry`를 끕니다. 기본값이 켜짐이라 빌드마다 Sentry로 빌드 정보가 나갑니다. 수집 대상은 이 앱의
 * 지표와 오류뿐이므로 빌드 도구의 사용 통계는 보내지 않습니다.
 *
 * `silent`는 켜지 않습니다. 경고 하나를 지우려고 Sentry 빌드 로그를 전부 끄면 이후의 실제 경고까지
 * 가려집니다. auth token 경고는 토큰을 넣어 원인을 없앱니다.
 */
export const sentryBuildOptions = {
  org: "hm1n",
  project: "sift",
  sourcemaps: { deleteSourcemapsAfterUpload: true },
  telemetry: false,
} as const satisfies SentryBuildOptions;

export default withSentryConfig(nextConfig, sentryBuildOptions);

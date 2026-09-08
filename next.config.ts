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
 * Source Map은 이번 범위가 아니라 명시적으로 끕니다. `authToken`을 넣지 않는 것만으로도 업로드는
 * 일어나지 않지만, 우연히 꺼진 상태와 끄기로 결정한 상태를 코드에서 구분할 수 있게 옵션으로
 * 남깁니다. Releases와 Source Map 업로드는 후속 이슈입니다.
 *
 * `telemetry`를 끕니다. 기본값이 켜짐이라 빌드마다 Sentry로 빌드 정보가 나갑니다. 이번 이슈의
 * 수집 대상은 브라우저 지표와 클라이언트 오류뿐이므로 빌드 도구의 사용 통계는 보내지 않습니다.
 *
 * `release: { create: false }`는 넣지 않습니다. 프로덕션 빌드는 auth token이 없다는 경고를
 * 남기는데 이 옵션으로 막히지 않습니다. `handleRunAfterProductionCompile`이 `createRelease()`를
 * 조건 없이 부르고, 그 안에서 auth token 검사가 `create` 값보다 먼저 반환하기 때문입니다. 값을
 * 넣어도 동작이 바뀌지 않는 도달 불가능한 설정이므로 두지 않습니다. auth token이 없으면 release는
 * 어차피 만들어지지 않고, 경고는 Releases 후속 이슈까지 그대로 남습니다.
 *
 * `silent`도 켜지 않습니다. 위 경고 하나를 지우려고 Sentry 빌드 로그를 전부 끄면 이후의 실제
 * 경고까지 가려집니다.
 */
export default withSentryConfig(nextConfig, {
  sourcemaps: { disable: true },
  telemetry: false,
});

import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * 이슈 #144가 켠 Source Map 업로드와 release 연결이 꺼지지 않는 것을 고정합니다.
 *
 * 이 설정은 프로덕션 빌드에서만 효과가 드러나므로 되돌아가도 테스트가 빨개지지 않고, 다음 장애에서야
 * 스택이 번들 기준이라는 것을 알게 됩니다. 그래서 설정 자체가 아니라 `withSentryConfig`가 만들어 낸
 * 결과를 확인합니다.
 *
 * `TURBOPACK`을 세워 두고 import합니다. Next.js 16의 `next build`는 번들러 플래그가 없으면 이 변수를
 * 세우고 Turbopack으로 빌드하는데, vitest에는 없으므로 그대로 두면 `@sentry/nextjs`가 webpack 경로로
 * 갈라져 프로덕션과 다른 설정을 검사하게 됩니다.
 *
 * `SENTRY_RELEASE`를 넣습니다. 이름이 없으면 SDK가 CI 환경변수와 `git rev-parse HEAD`를 차례로 뒤지는데,
 * 그 값은 실행 환경마다 달라 단정할 수 없습니다. 이름을 고정하면 주입 경로만 검사할 수 있습니다.
 */
async function loadNextConfig(): Promise<NextConfig> {
  vi.resetModules();
  vi.stubEnv("TURBOPACK", "1");
  vi.stubEnv("SENTRY_RELEASE", "test-release-name");
  return (await import("./next.config")).default as NextConfig;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("next.config", () => {
  it("브라우저 소스맵 생성을 켠다", async () => {
    // Turbopack 경로에서 이 값이 켜지는 것은 Source Map 업로드가 꺼져 있지 않다는 뜻입니다.
    // `sourcemaps.disable`을 다시 켜면 SDK가 이 값을 건드리지 않아 `undefined`가 됩니다.
    const config = await loadNextConfig();

    expect(config.productionBrowserSourceMaps).toBe(true);
  });

  it("업로드와 삭제를 도는 빌드 훅을 건다", async () => {
    // 이 훅이 소스맵을 Sentry로 올리고 `.next/static`의 맵과 `sourceMappingURL` 주석을 지웁니다.
    // 없으면 맵이 브라우저가 받을 수 있는 자리에 그대로 남습니다.
    const config = await loadNextConfig();

    expect(typeof config.compiler?.runAfterProductionCompile).toBe("function");
  });

  it("release 이름을 번들에 주입한다", async () => {
    // `release.create`를 다시 끄면 SDK가 이름 해소를 건너뛰어 이 값이 사라지고, 이벤트에 release가
    // 붙지 않아 배포 사이를 가를 수 없게 됩니다.
    const config = await loadNextConfig();

    expect(config.env?._sentryRelease).toBe("test-release-name");
  });

  it("업로드 뒤 소스맵을 지우도록 명시한다", async () => {
    // SDK가 같은 조건에서 기본값으로도 켜 주지만 `productionBrowserSourceMaps`를 직접 설정하면
    // 그 기본값이 사라집니다. 명시한 값이 남아 있는지 확인합니다.
    const { sentryBuildOptions } = await import("./next.config");

    expect(sentryBuildOptions.sourcemaps.deleteSourcemapsAfterUpload).toBe(true);
  });
});

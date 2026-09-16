import { describe, expect, it } from "vitest";

/**
 * `vitest.config.mts`가 테스트 시간대를 고정합니다. 고정이 빠지면 날짜를 단정하는 테스트가
 * 실행 환경에 따라 갈립니다. 실제로 4개 파일 5건이 UTC−10에서 하루 앞으로 밀렸습니다.
 *
 * 그 5건이 이미 회귀를 잡지만 KST 기기에서는 고정을 지워도 통과합니다. 고정 자체를 여기서 봅니다.
 */
describe("테스트 시간대", () => {
  it("실행 환경과 무관하게 Asia/Seoul로 고정되어 있습니다", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Asia/Seoul");
  });
});

import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  /**
   * 화면이 날짜를 `toLocaleDateString`으로 그리므로 보이는 값이 실행 시간대를 따릅니다. 고정하지
   * 않으면 UTC 자정 근처의 fixture가 음수 오프셋 환경에서 하루 앞으로 밀려 테스트가 깨집니다.
   *
   * 구현에 `timeZone: "UTC"`를 박는 쪽은 택하지 않았습니다. KST는 UTC+9라 09시 이전에 저장한
   * 것이 전부 전날로 보입니다. 사용자에게는 현지 날짜가 맞고, 시계가 없던 쪽은 테스트입니다.
   *
   * Windows의 Node는 기동 시 `TZ` 환경변수를 읽지 않습니다. 여기서 넣는 값은 워커가
   * `process.env`에 대입하는 경로라 V8의 시간대 캐시가 갱신됩니다.
   */
  test: { env: { TZ: "Asia/Seoul" } },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});

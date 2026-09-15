import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTH_ERROR_COPY } from "@/copy/auth";
import { toAuthErrorParam } from "./auth-error";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("toAuthErrorParam", () => {
  it.each(Object.keys(AUTH_ERROR_COPY))("%s는 그대로 씁니다", (kind) => {
    expect(toAuthErrorParam(kind)).toBe(kind);
  });

  /**
   * 주소창의 쿼리는 아무 값이나 들어올 수 있습니다. 그대로 보내면 GA4 디멘션에 임의 문자열이 쌓여
   * 분류로 쓸 수 없게 되고 파라미터 값 100자 제한도 보장되지 않습니다.
   */
  it.each(["없는코드", "__proto__", "constructor", "toString", "가".repeat(300)])(
    "표에 없는 값은 unknown으로 묶습니다",
    (value) => {
      expect(toAuthErrorParam(value)).toBe("unknown");
    }
  );
});

/**
 * `src/app/page.tsx`가 서버 컴포넌트인데 `login_result`의 분류를 만들려고 이 모듈을 부릅니다.
 * 클라이언트 모듈의 함수를 서버에서 부르면 Next.js가 렌더를 500으로 끊습니다.
 *
 * 이 확인이 실제 결함을 대신하지는 못합니다. vitest는 모듈 그래프가 하나라 `"use client"`가 아무
 * 경계도 만들지 않고, 2026-09-15에 이 결함은 프로덕션 빌드를 띄워 요청해야 드러났습니다. 다만 표를
 * 다시 화면 파일로 되돌리는 변경은 여기서 막힙니다.
 */
describe("서버와 클라이언트 경계", () => {
  // 안내표가 `@/copy/auth`로 옮겨 가면서(이슈 #128) 경계가 두 파일로 늘었습니다. 한쪽만 지키면
  // import 사슬을 타고 클라이언트 경계가 다시 들어옵니다.
  it.each([
    ["auth-error.ts", join(HERE, "auth-error.ts")],
    ["copy/auth.ts", join(HERE, "..", "..", "copy", "auth.ts")],
  ])("%s는 클라이언트 모듈이 아니어야 합니다", (_name, path) => {
    expect(readFileSync(path, "utf8").trimStart().startsWith('"use client"')).toBe(false);
  });
});

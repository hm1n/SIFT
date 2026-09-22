import { describe, expect, it } from "vitest";
import { WITHDRAWN_COPY } from "@/copy/auth";
import { UNKNOWN_WITHDRAWAL_MARKER, withdrawnMarker } from "./withdrawal";

describe("withdrawnMarker", () => {
  it.each([
    [{ deleted: 2, revoked: true }, "done"],
    [{ deleted: 0, revoked: true }, "empty"],
    [{ deleted: 2, revoked: false }, "done_kept"],
    [{ deleted: 0, revoked: false }, "empty_kept"],
  ])("%o는 %s다", (result, marker) => {
    expect(withdrawnMarker(result)).toBe(marker);
  });

  /**
   * 응답 본문을 읽지 못한 경우입니다. 더 많은 일을 시키는 쪽으로 둡니다. 반대로 두면 연결이
   * 남았는데도 끊겼다고 알리게 되고, 탈퇴는 되돌릴 수 없어 다시 물어볼 수도 없습니다.
   */
  it.each([
    ["null", null],
    ["문자열", "done"],
    ["빈 객체", {}],
    ["deleted가 숫자가 아닌 본문", { deleted: "2", revoked: true }],
    ["revoked가 불리언이 아닌 본문", { deleted: 2, revoked: "yes" }],
  ])("%s는 연결이 남은 것으로 본다", (_name, result) => {
    expect(withdrawnMarker(result)).toBe(UNKNOWN_WITHDRAWAL_MARKER);
  });

  /** 표시를 만드는 쪽과 문구 표가 어긋나면 탈퇴한 사용자가 아무 안내도 받지 못합니다. */
  it("만들 수 있는 표시가 모두 문구 표에 있다", () => {
    for (const deleted of [0, 2]) {
      for (const revoked of [true, false]) {
        expect(WITHDRAWN_COPY[withdrawnMarker({ deleted, revoked })]).toBeDefined();
      }
    }
    expect(WITHDRAWN_COPY[UNKNOWN_WITHDRAWAL_MARKER]).toBeDefined();
  });
});

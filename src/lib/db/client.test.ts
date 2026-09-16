import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DATABASE_URL_ENV, DATABASE_URL_UNPOOLED_ENV, DatabaseError, getSql } from "./client";

const POOLED = "postgresql://user:pw@pooled.example.neon.tech/neondb?sslmode=require";
const UNPOOLED = "postgresql://user:pw@unpooled.example.neon.tech/neondb?sslmode=require";
const MANAGED = [DATABASE_URL_ENV, DATABASE_URL_UNPOOLED_ENV];

/**
 * 이 파일은 접속 문자열이 없는 상태를 전제로 판정합니다. 그래서 주변 환경에서 물려받은 값을 그대로
 * 두면 테스트가 셸에 따라 달라집니다. 지우기만 하면 이번에는 통과하지만 원래 값을 잃습니다.
 * 시작할 때 치우고 끝나면 원래대로 되돌립니다. 원래 없던 변수는 없는 상태로 되돌립니다.
 */
let saved: Array<string | undefined> = [];

beforeEach(() => {
  saved = MANAGED.map((name) => process.env[name]);
  for (const name of MANAGED) delete process.env[name];
});

afterEach(() => {
  MANAGED.forEach((name, index) => {
    const original = saved[index];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
});

describe("데이터베이스 접속", () => {
  it("접속 문자열이 없으면 타입이 있는 config_missing 오류를 던진다", () => {
    expect(() => getSql()).toThrow(DatabaseError);
    expect(() => getSql()).toThrow(expect.objectContaining({ kind: "config_missing" }));
  });

  // 빈 문자열이나 공백만 있는 값은 설정한 것이 아닙니다. 그대로 넘기면 드라이버가 다른 오류를 냅니다.
  it.each(["", "   "])("접속 문자열이 %o이면 설정되지 않은 것으로 본다", (value) => {
    process.env[DATABASE_URL_ENV] = value;
    expect(() => getSql()).toThrow(expect.objectContaining({ kind: "config_missing" }));
  });

  it("접속 문자열이 있으면 질의 함수를 돌려준다", () => {
    process.env[DATABASE_URL_ENV] = POOLED;
    expect(typeof getSql()).toBe("function");
  });

  it("unpooled를 요청하면 전용 접속 문자열을 쓰고 없으면 기본값으로 내려간다", () => {
    process.env[DATABASE_URL_ENV] = POOLED;
    expect(typeof getSql({ unpooled: true })).toBe("function");

    process.env[DATABASE_URL_UNPOOLED_ENV] = UNPOOLED;
    expect(typeof getSql({ unpooled: true })).toBe("function");
  });

  it("unpooled 전용 문자열만 있고 기본값이 없으면 기본 질의는 설정되지 않은 것으로 본다", () => {
    process.env[DATABASE_URL_UNPOOLED_ENV] = UNPOOLED;
    expect(() => getSql()).toThrow(expect.objectContaining({ kind: "config_missing" }));
  });
});

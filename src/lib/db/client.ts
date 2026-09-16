import { neon } from "@neondatabase/serverless";

export const DATABASE_URL_ENV = "DATABASE_URL";
export const DATABASE_URL_UNPOOLED_ENV = "DATABASE_URL_UNPOOLED";

export type DatabaseErrorKind = "config_missing" | "query_failed";

/**
 * 저장 계층이 내는 오류입니다. 호출하는 쪽이 사용자에게 무엇을 보일지 고르려면 종류가 필요합니다.
 * `config_missing`은 사용자가 할 수 있는 일이 없고, `query_failed`는 다시 시도할 여지가 있습니다.
 */
export class DatabaseError extends Error {
  readonly kind: DatabaseErrorKind;

  constructor(kind: DatabaseErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
    this.kind = kind;
  }
}

/**
 * HTTP 한 번 왕복으로 질의를 끝내는 드라이버입니다. 연결을 붙잡지 않으므로 서버리스 환경에서 연결
 * 수가 고갈되지 않고, 요청 하나에 질의 하나인 이 서비스의 접근 패턴과 맞습니다.
 *
 * 환경변수를 모듈 최상단이 아니라 호출 시점에 읽습니다. 최상단에서 읽으면 빌드 시점 값이 고정되고,
 * 값이 없는 환경에서는 이 모듈을 import하는 것만으로 실패합니다.
 *
 * `unpooled`는 DDL처럼 한 연결에서 이어 돌려야 하는 작업에 씁니다. 애플리케이션 질의는 기본값을 씁니다.
 */
export function getSql(options: { unpooled?: boolean } = {}) {
  const name = options.unpooled ? DATABASE_URL_UNPOOLED_ENV : DATABASE_URL_ENV;
  const url = process.env[name]?.trim() || (options.unpooled ? process.env[DATABASE_URL_ENV]?.trim() : undefined);
  if (!url) {
    throw new DatabaseError("config_missing", `데이터베이스 접속 문자열이 설정되지 않았습니다. ${name}을 확인해 주세요.`);
  }
  return neon(url);
}

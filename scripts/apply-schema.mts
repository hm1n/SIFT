/**
 * `db/schema.sql`을 Neon에 적용합니다. `npm run db:schema`로 돌립니다.
 *
 * 마이그레이션 도구를 쓰지 않는 이유는 두 가지입니다. 새 의존성을 접속 드라이버 하나로 제한하기로
 * 했고, 표가 둘이며 아직 배포된 적이 없어 되돌릴 이력이 없습니다. 대신 모든 문장을 `if not exists`로
 * 써서 여러 번 돌려도 같은 결과가 나오게 합니다.
 *
 * DDL은 `DATABASE_URL_UNPOOLED`를 씁니다. 없으면 `DATABASE_URL`로 내려갑니다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseError, getSql } from "../src/lib/db/client.ts";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Vercel처럼 환경변수를 직접 주입하는 곳에는 이 파일이 없습니다. 없으면 그대로 진행합니다. */
function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(join(projectRoot, file));
    } catch {
      // 파일이 없는 경우입니다.
    }
  }
}

/**
 * 문장 단위로 나눕니다. 드라이버가 HTTP 한 번에 한 문장을 보내므로 파일을 통째로 넘길 수 없습니다.
 * 이 파일에는 함수 본문이나 달러 인용 문자열이 없어서 세미콜론으로 나누는 것으로 충분합니다.
 */
function statements(sql: string): string[] {
  return sql
    .split(";")
    .map((statement) =>
      statement
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n")
        .trim()
    )
    .filter((statement) => statement.length > 0);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const sql = getSql({ unpooled: true });
  const pending = statements(readFileSync(join(projectRoot, "db", "schema.sql"), "utf8"));

  for (const statement of pending) {
    await sql.query(statement);
    console.log(`적용: ${statement.split("\n")[0]}`);
  }

  const tables = await sql.query(
    "select table_name from information_schema.tables where table_schema = 'public' order by table_name"
  );
  console.log(`\n표 ${tables.length}개: ${tables.map((row) => String(row.table_name)).join(", ")}`);
}

main().catch((error: unknown) => {
  if (error instanceof DatabaseError) console.error(`${error.kind}: ${error.message}`);
  else console.error(error);
  process.exitCode = 1;
});

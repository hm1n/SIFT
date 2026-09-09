/**
 * 컨텍스트 캐싱의 적용 조건을 응답으로 확인합니다. 이슈 #79이고 수동 실행이며 vitest 스위트에
 * 포함되지 않습니다.
 *
 * 실행:
 *   npx tsx --env-file=<.env 경로> \
 *     src/features/interview/measurement/context-cache-probe.measure.mts
 *
 * 옵션:
 *   --models=<id,id>  확인할 모델. 기본 gemini-3.1-flash-lite,gemini-3.5-flash-lite
 *
 * 확인하는 것:
 *   1. **명시적 캐싱의 최소 토큰 조건.** 아주 작은 본문으로 `cachedContents`를 만들어 보고 거절
 *      메시지에 적힌 최소값을 읽습니다. 문서를 읽지 않고 API가 실제로 거절하는 경계를 봅니다.
 *   2. **모델이 명시적 캐싱을 지원하는지.** 지원하지 않으면 최소 토큰과 무관하게 배선할 수 없습니다.
 *   3. **응답 헤더에 잔여 한도가 실리는지.** 제약이 "한도는 문서가 아니라 응답 헤더로 확인한다"
 *      이므로, 헤더가 없다는 사실 자체를 확인해 기록합니다. 값은 찍지 않고 이름만 찍습니다.
 *
 * 암묵적 캐싱이 자동으로 걸리는지는 여기서 보지 않습니다. 그 값은 실제 인터뷰 입력에서만 의미가
 * 있어 `followup-question-model.measure.mts`가 `inputTokenDetails.cacheReadTokens`로 잽니다.
 *
 * 출력에 키를 남기지 않습니다. 헤더는 이름만 찍고 값은 찍지 않습니다.
 */

import { parseCreatedCache, type CreatedCache } from "./cache-response.mjs";

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const models = flag("models", "gemini-3.1-flash-lite,gemini-3.5-flash-lite")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value !== "");

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_GENERATIVE_AI_API_KEY가 필요합니다. --env-file로 넘겨 주세요.");
  process.exit(1);
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * 응답 본문을 읽습니다. 파싱 실패를 정상 흐름으로 다룹니다.
 *
 * 거절 응답은 JSON이지만 게이트웨이가 끊으면 HTML이 옵니다. `response.json()`을 그냥 부르면
 * 그 경우 SyntaxError만 남아 어느 단계에서 깨졌는지가 사라집니다.
 */
async function readBody(response: Response): Promise<string> {
  const raw = await response.text();
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
    if (parsed.error?.message !== undefined) {
      return `${parsed.error.status ?? response.status}: ${parsed.error.message}`;
    }
    return raw.slice(0, 400);
  } catch {
    return `본문을 JSON으로 읽지 못했습니다(${response.status}): ${raw.slice(0, 200)}`;
  }
}

/** 한도 관련 헤더가 실리는지 봅니다. 값은 찍지 않고 이름만 모읍니다. */
function rateLimitHeaderNames(headers: Headers): string {
  const names = [...headers.keys()].filter(
    (name) => name.startsWith("x-ratelimit") || name === "retry-after" || name.includes("quota")
  );
  return names.length === 0 ? "없음" : names.join(", ");
}

/**
 * 최소 토큰 조건을 거절 메시지로 확인합니다.
 *
 * 성공하면 만들어진 캐시를 곧바로 지웁니다. 지우지 않으면 기본 TTL 동안 스토리지 요금이 붙습니다.
 */
async function probeMinimumTokens(model: string, chars: number): Promise<void> {
  const response = await fetch(`${BASE}/cachedContents?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: `models/${model}`,
      contents: [{ role: "user", parts: [{ text: "가".repeat(chars) }] }],
      ttl: "60s",
    }),
  });
  const limitHeaders = rateLimitHeaderNames(response.headers);
  if (!response.ok) {
    console.log(`  본문 ${chars}자 → 거절 ${response.status}`);
    console.log(`    ${await readBody(response)}`);
    console.log(`    한도 헤더: ${limitHeaders}`);
    return;
  }
  // 본문을 먼저 문자열로 받고 파싱은 감쌉니다. 여기서 분류 없이 던지면 아래 정리 경로가 돌지
  // 않아 방금 만든 캐시가 TTL이 끝날 때까지 남습니다.
  const raw = await response.text();
  let created: CreatedCache;
  try {
    created = parseCreatedCache(model, raw);
  } catch (error) {
    console.log(`  본문 ${chars}자 → 생성은 됐지만 응답을 읽지 못했습니다`);
    console.log(`    ${(error as Error).message}`);
    console.log(`    한도 헤더: ${limitHeaders}`);
    // 이름을 모르면 지울 수 없습니다. `ttl: 60s`로 만들었으므로 1분 뒤 사라집니다.
    console.log(`    정리: 캐시 이름을 몰라 지우지 못했습니다. ttl 60초가 지나면 사라집니다.`);
    return;
  }
  console.log(`  본문 ${chars}자 → 생성됨 (캐시 토큰 ${created.totalTokenCount ?? "?"})`);
  console.log(`    한도 헤더: ${limitHeaders}`);
  if (created.name !== undefined) {
    const deleted = await fetch(`${BASE}/${created.name}?key=${apiKey}`, { method: "DELETE" });
    console.log(`    정리: DELETE ${deleted.status}`);
  }
}

async function main(): Promise<void> {
  console.log("명시적 캐싱 최소 토큰 조건과 잔여 한도 헤더를 응답으로 확인합니다.\n");
  for (const model of models) {
    console.log(`--- ${model} ---`);
    // 작은 본문으로 먼저 부딪혀 거절 메시지에 적힌 경계를 읽고, 그 다음 큰 본문으로 실제 생성이
    // 되는지를 봅니다. 경계를 이분 탐색하지 않는 이유는 거절 메시지가 최소값을 직접 알려주기
    // 때문입니다. 알려주지 않으면 그 사실이 결과입니다.
    for (const chars of [100, 8_000]) {
      await probeMinimumTokens(model, chars);
    }
    console.log("");
  }
}

await main();

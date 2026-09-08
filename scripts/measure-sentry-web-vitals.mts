/**
 * Sentry 클라이언트 계측이 실제로 Core Web Vitals를 실어 보내는지 확인합니다. 이슈 #81의
 * Definition of Done 가운데 브라우저에서만 확인할 수 있는 항목이 대상입니다.
 *
 * 실행:
 *   1. DSN을 넣고 프로덕션 빌드를 만듭니다. `NEXT_PUBLIC_*`는 Next.js가 빌드 시점에 번들로
 *      인라인하므로 서버 실행 시점에 넣으면 브라우저가 읽지 못합니다.
 *        NEXT_PUBLIC_SENTRY_DSN="https://examplePublicKey@o0.ingest.sentry.io/0" npm run build
 *   2. `npm start -- -p 3101`로 띄웁니다.
 *   3. `node scripts/measure-sentry-web-vitals.mts http://localhost:3101 on`
 *
 * DSN을 뺀 빌드는 `off` 모드로 확인합니다. 그때는 envelope 요청이 0건이어야 합니다.
 *        npm run build && npm start -- -p 3101
 *        node scripts/measure-sentry-web-vitals.mts http://localhost:3101 off
 *
 * Chromium이 없으면 `npx playwright install chromium`이 먼저 필요합니다.
 *
 * **기대와 다르면 종료 코드가 1입니다.** 확인 절차가 실패를 확정하지 못하면 절차가 아닙니다.
 * 그래서 지표를 전역으로 합쳐서 세지 않고, 지표마다 어떤 span에 어떤 measurement로 와야 하는지를
 * 고정해 그 조합이 맞을 때만 통과시킵니다. op 문자열에 지표 이름이 들어 있는지로 판별하면 값이
 * 없는 span만 와도 통과하므로 쓰지 않습니다.
 *
 * 고정 대기로 도착을 추정하지 않습니다. pageload envelope가 실제로 도착한 뒤에 레이아웃을 밀고,
 * 기대 조합이 모두 모일 때까지 제한 시간 안에서 기다립니다.
 *
 * Sentry ingest 요청은 실제로 내보내지 않고 Playwright가 가로채 200으로 응답합니다. 실제 Sentry
 * 프로젝트 없이 envelope 내용을 확인할 수 있게 하려는 것입니다. Sentry 화면에서 최종 확인하는
 * 것은 실제 DSN이 생긴 뒤의 별도 단계입니다.
 *
 * CLS와 INP는 관측 조건이 LCP와 다릅니다. CLS는 레이아웃이 실제로 밀려야 값이 생기고, INP는
 * 실제 상호작용이 있어야 생깁니다. 미인증 첫 화면에는 로그인 링크 하나뿐이라 앱이 스스로 만드는
 * 레이아웃 변화가 없습니다. 그래서 클릭은 그 링크로 실제로 하고, 레이아웃 시프트는 스크립트가
 * 요소를 넣어 만듭니다. 후자는 앱이 만든 시프트가 아니므로 **CLS 수치를 성능 근거로 쓰지
 * 않습니다.** 이 스크립트가 확인하는 것은 값의 크기가 아니라 전송 경로입니다.
 */

import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const baseUrl = process.argv[2] ?? "http://localhost:3000";
const mode = process.argv[3] === "off" ? "off" : "on";

/** Sentry ingest 경로입니다. DSN 호스트가 무엇이든 envelope 경로는 이 모양입니다. */
const ENVELOPE_URL_PATTERN = "**/envelope/**";

/**
 * 지표마다 어떤 span에 어떤 measurement로 와야 하는지입니다. `@sentry/browser` 10.73.0에서 실측한
 * 조합이고, SDK 업그레이드로 경로가 바뀌면 이 목록이 먼저 실패합니다.
 */
const EXPECTED_VITALS = [
  { vital: "lcp", op: "pageload" },
  { vital: "fcp", op: "pageload" },
  { vital: "ttfb", op: "pageload" },
  { vital: "cls", op: "ui.webvital.cls" },
  { vital: "inp", op: "ui.interaction.click" },
] as const;

const PAGELOAD_TIMEOUT_MS = 20_000;
const VITALS_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 250;

interface CapturedItem {
  readonly transaction: string | undefined;
  readonly op: string | undefined;
  readonly measurements: readonly string[];
}

/**
 * envelope는 줄바꿈으로 구분된 JSON입니다. 첫 줄이 envelope 헤더고 그 뒤로 항목 헤더와 항목
 * 본문이 번갈아 옵니다. 어떤 줄이 헤더인지 구분하지 않고 전부 파싱합니다. 찾으려는 것이
 * `measurements`와 trace `op`뿐이라 항목 경계를 정확히 나눌 필요가 없습니다.
 */
function parseEnvelope(body: string): CapturedItem[] {
  const items: CapturedItem[] = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // 본문이 압축되어 있거나 잘린 줄이면 건너뜁니다. 읽을 수 있는 줄만 봅니다.
      continue;
    }
    const measurements = parsed.measurements;
    const contexts = parsed.contexts as { trace?: { op?: unknown } } | undefined;
    const op = typeof parsed.op === "string" ? parsed.op : contexts?.trace?.op;
    items.push({
      transaction: typeof parsed.transaction === "string" ? parsed.transaction : undefined,
      op: typeof op === "string" ? op : undefined,
      measurements:
        measurements && typeof measurements === "object" ? Object.keys(measurements).sort() : [],
    });
  }
  return items;
}

/** 같은 item이 기대한 op와 measurement를 함께 가질 때만 수집된 것으로 봅니다. */
function isCollected(items: readonly CapturedItem[], vital: string, op: string): boolean {
  return items.some((item) => item.op === op && item.measurements.includes(vital));
}

function missingVitals(items: readonly CapturedItem[]): string[] {
  return EXPECTED_VITALS.filter(({ vital, op }) => !isCollected(items, vital, op)).map(
    ({ vital, op }) => `${vital}@${op}`
  );
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return predicate();
}

/**
 * 커밋 SHA가 클라이언트 번들에 release로 인라인되지 않았는지 확인합니다.
 *
 * `withSentryConfig`의 `release.create`가 기본값이면 `resolveReleaseName`이 Git revision을 탐색해
 * `_sentryRelease`로 번들에 주입합니다. 그러면 auth token이 없어도 모든 이벤트에 release 값이
 * 붙습니다. 이슈 #81의 Non-goal이 Releases를 범위 밖으로 두었으므로 붙지 않아야 합니다.
 *
 * 이 검사는 프로덕션 빌드 산출물을 읽으므로 vitest 스위트에 넣을 수 없습니다. 확인 절차가 이미
 * 프로덕션 빌드를 전제하므로 여기에 둡니다.
 */
function checkReleaseNotInjected(): { ok: boolean; detail: string } {
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return { ok: true, detail: "git revision을 읽을 수 없어 건너뜁니다." };
  }
  const staticDir = join(".next", "static");
  let files: string[];
  try {
    files = readdirSync(staticDir, { recursive: true, encoding: "utf8" }).filter((name) =>
      name.endsWith(".js")
    );
  } catch {
    return { ok: false, detail: `${staticDir}를 읽을 수 없습니다. 프로덕션 빌드가 필요합니다.` };
  }
  if (files.length === 0) {
    return { ok: false, detail: `${staticDir}에 JS 청크가 없습니다. 프로덕션 빌드가 필요합니다.` };
  }
  const leaked = files.filter((name) => readFileSync(join(staticDir, name), "utf8").includes(sha));
  if (leaked.length > 0) {
    return { ok: false, detail: `커밋 SHA가 ${leaked.join(", ")}에 인라인되어 있습니다.` };
  }
  return { ok: true, detail: `커밋 SHA가 클라이언트 청크 ${files.length}개에 없습니다.` };
}

async function main() {
  const items: CapturedItem[] = [];
  let envelopeRequests = 0;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });

  await page.route(ENVELOPE_URL_PATTERN, async (route) => {
    envelopeRequests += 1;
    const body = route.request().postData();
    if (body) items.push(...parseEnvelope(body));
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(baseUrl, { waitUntil: "load" });

  // 링크 클릭이 OAuth로 넘어가지 않게 기본 동작만 막습니다. 클릭 자체는 실제 입력이어야 INP가
  // 생기고, 페이지는 남아 있어야 이후 flush를 볼 수 있습니다. 요청을 abort로 막는 방식은
  // Playwright의 클릭이 네비게이션을 기다려 멈추게 하므로 쓰지 않습니다.
  await page.evaluate(() => {
    document.addEventListener("click", (event) => event.preventDefault(), true);
  });

  const timing = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0] as
      | PerformanceNavigationTiming
      | undefined;
    const paints = performance
      .getEntriesByType("paint")
      .map((entry) => `${entry.name} ${Math.round(entry.startTime)}ms`);
    return {
      domContentLoaded: Math.round(navigation?.domContentLoadedEventEnd ?? 0),
      loadEventEnd: Math.round(navigation?.loadEventEnd ?? 0),
      paints,
    };
  });

  // 실제 클릭입니다. 위에서 기본 동작을 막았으므로 화면은 그대로 남습니다.
  const loginLink = page.getByRole("link", { name: /로그인/ });
  if (await loginLink.count()) {
    await loginLink.first().click({ noWaitAfter: true });
  }

  // pageload envelope가 도착한 뒤에 레이아웃을 밉니다. 스트리밍이 화면을 미는 시점이 로드보다
  // 한참 뒤이므로 이 순서가 실제 상황에 해당하고, standalone CLS span이 꺼져 있으면 이 시점의
  // 시프트는 어디에도 기록되지 않습니다. 앱이 만든 시프트가 아니므로 값의 크기는 성능 근거로
  // 쓰지 않고 전송 경로만 확인합니다.
  const pageloadArrived =
    mode === "off" ||
    (await waitUntil(() => items.some((item) => item.op === "pageload"), PAGELOAD_TIMEOUT_MS));

  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "320px";
    document.body.prepend(filler);
  });
  await page.mouse.click(640, 700);

  // CLS와 INP는 페이지가 숨겨질 때 flush됩니다. 실제 이탈 대신 visibilitychange를 만듭니다.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });

  if (mode === "on") {
    await waitUntil(() => missingVitals(items).length === 0, VITALS_TIMEOUT_MS);
  } else {
    // 요청이 늦게 나가는 경우를 놓치지 않도록 관찰 창을 둡니다.
    await waitUntil(() => envelopeRequests > 0, 5_000);
  }

  await browser.close();

  console.log(`대상: ${baseUrl} (mode=${mode})`);
  console.log(`envelope 요청: ${envelopeRequests}건`);
  console.log(`paint: ${timing.paints.join(", ") || "없음"}`);
  console.log(`domContentLoaded ${timing.domContentLoaded}ms, load ${timing.loadEventEnd}ms`);
  for (const item of items) {
    if (!item.op && item.measurements.length === 0) continue;
    console.log(
      `  item op=${item.op ?? "-"} transaction=${item.transaction ?? "-"} measurements=${item.measurements.join(",") || "-"}`
    );
  }

  const failures: string[] = [];

  if (mode === "on") {
    if (!pageloadArrived) failures.push("pageload envelope가 제한 시간 안에 도착하지 않았습니다.");
    for (const { vital, op } of EXPECTED_VITALS) {
      const ok = isCollected(items, vital, op);
      console.log(`${vital.toUpperCase()} @ ${op}: ${ok ? "수집됨" : "없음"}`);
    }
    const missing = missingVitals(items);
    if (missing.length > 0) failures.push(`수집되지 않은 지표: ${missing.join(", ")}`);
  } else {
    console.log(`DSN 없는 빌드 기대값: envelope 요청 0건`);
    if (envelopeRequests > 0) {
      failures.push(`DSN이 없는데 envelope 요청이 ${envelopeRequests}건 나갔습니다.`);
    }
  }

  const release = checkReleaseNotInjected();
  console.log(`release 주입: ${release.ok ? "없음" : "있음"} — ${release.detail}`);
  if (!release.ok) failures.push(release.detail);

  if (failures.length > 0) {
    console.error("실패");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("통과");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

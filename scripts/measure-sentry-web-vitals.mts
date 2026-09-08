/**
 * Sentry 클라이언트 계측이 실제로 Core Web Vitals를 실어 보내는지 확인하고, 그 김에
 * `instrumentation-client.ts`가 있는 페이지의 초기 구간을 잽니다. 이슈 #81의 Definition of Done
 * 가운데 브라우저에서만 확인할 수 있는 항목이 대상입니다.
 *
 * 실행:
 *   1. DSN을 넣고 프로덕션 빌드를 만듭니다. `NEXT_PUBLIC_*`는 Next.js가 빌드 시점에 번들로
 *      인라인하므로 서버 실행 시점에 넣으면 브라우저가 읽지 못합니다.
 *        NEXT_PUBLIC_SENTRY_DSN="https://examplePublicKey@o0.ingest.sentry.io/0" npm run build
 *   2. `npm start -- -p 3101`로 띄웁니다.
 *   3. `node scripts/measure-sentry-web-vitals.mts http://localhost:3101`
 *
 * DSN을 뺀 빌드로 같은 명령을 돌리면 envelope 요청이 0건이어야 합니다. 그 경우도 이 스크립트로
 * 확인합니다.
 *
 * Chromium이 없으면 `npx playwright install chromium`이 먼저 필요합니다.
 *
 * Sentry ingest 요청은 실제로 내보내지 않고 Playwright가 가로채 200으로 응답합니다. 실제 Sentry
 * 프로젝트 없이 envelope 내용을 확인할 수 있게 하려는 것입니다. Sentry 화면에서 최종 확인하는
 * 것은 실제 DSN이 생긴 뒤의 별도 단계입니다.
 *
 * 측정하는 지표가 어떤 경로로 오는지는 SDK 구현에 따라 다릅니다. `@sentry/browser` 10.73.0의
 * `webVitalsIntegration`은 standalone span 옵션이 실험 기능이고 기본값이 꺼짐이므로, LCP와 CLS를
 * pageload 트랜잭션의 measurement로 싣습니다. INP만 `startTrackingINP`로 따로 보냅니다. 그래서
 * 이 스크립트는 measurement 이름과 span op를 함께 봅니다.
 *
 * CLS와 INP는 관측 조건이 LCP와 다릅니다. CLS는 레이아웃이 실제로 밀려야 값이 생기고, INP는
 * 실제 상호작용이 있어야 생깁니다. 미인증 첫 화면에는 로그인 링크 하나뿐이라 앱이 스스로
 * 만드는 레이아웃 변화가 없습니다. 그래서 클릭은 그 링크로 실제로 하고, 레이아웃 시프트는
 * 스크립트가 요소를 넣어 만듭니다. 후자는 앱이 만든 시프트가 아니므로 CLS 수치를 성능 근거로
 * 쓰지 않습니다. 이 스크립트가 확인하는 것은 값의 크기가 아니라 전송 경로입니다.
 */

import { chromium } from "@playwright/test";

const baseUrl = process.argv[2] ?? "http://localhost:3000";

/** Sentry ingest 경로입니다. DSN 호스트가 무엇이든 envelope 경로는 이 모양입니다. */
const ENVELOPE_URL_PATTERN = "**/envelope/**";

/** 우리가 찾는 Core Web Vitals입니다. 이슈 #81의 첫 수집 대상입니다. */
const TARGET_VITALS = ["lcp", "cls", "inp", "fcp", "ttfb"] as const;

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

  // pageload 트랜잭션이 끝난 뒤에 레이아웃을 밉니다. 스트리밍이 화면을 미는 시점이 로드보다
  // 한참 뒤이므로 이 순서가 실제 상황에 해당합니다. standalone CLS span이 꺼져 있으면 이 시점의
  // 시프트는 어디에도 기록되지 않습니다. 앱이 만든 시프트가 아니므로 값의 크기는 성능 근거로
  // 쓰지 않고 전송 경로만 확인합니다.
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const filler = document.createElement("div");
    filler.style.height = "320px";
    document.body.prepend(filler);
  });
  await page.waitForTimeout(300);
  await page.mouse.click(640, 700);

  // CLS와 INP는 페이지가 숨겨질 때 flush됩니다. 실제 이탈 대신 visibilitychange를 만듭니다.
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
  });

  // flush가 나갈 시간을 줍니다. 이 대기는 측정값이 아니라 관찰 창입니다.
  await page.waitForTimeout(5000);
  await browser.close();

  const allMeasurements = new Set(items.flatMap((item) => item.measurements));
  const allOps = new Set(items.map((item) => item.op).filter((op): op is string => Boolean(op)));

  console.log(`대상: ${baseUrl}`);
  console.log(`envelope 요청: ${envelopeRequests}건`);
  console.log(`paint: ${timing.paints.join(", ") || "없음"}`);
  console.log(`domContentLoaded ${timing.domContentLoaded}ms, load ${timing.loadEventEnd}ms`);
  for (const item of items) {
    if (!item.op && item.measurements.length === 0) continue;
    console.log(
      `  item op=${item.op ?? "-"} transaction=${item.transaction ?? "-"} measurements=${item.measurements.join(",") || "-"}`
    );
  }
  for (const vital of TARGET_VITALS) {
    const viaMeasurement = allMeasurements.has(vital);
    const viaOp = [...allOps].some((op) => op.includes(vital));
    console.log(`${vital.toUpperCase()}: ${viaMeasurement ? "measurement" : viaOp ? "span" : "없음"}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

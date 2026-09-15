/**
 * GA4 퍼널 이벤트가 실제 브라우저에서 나가는지 확인합니다.
 *
 * DebugView는 사람이 눈으로 보는 화면이라 자동으로 확인할 수 없고, 로그인 뒤 경로는 GitHub OAuth와
 * LLM 호출이 있어야 도달합니다. 그래서 이 스크립트는 **자격 증명 없이 확인할 수 있는 로그인 경계
 * 이벤트**를 프로덕션 빌드에서 확인합니다. 나머지 여섯 종은 DebugView로 확인하고 절차는
 * `llm-wiki/wiki/2026-09-15-GA4-퍼널-계측.md`에 있습니다.
 *
 * 무엇을 어디서 보는지가 둘로 나뉩니다.
 *
 * - **이벤트와 파라미터는 `window.dataLayer`에서 읽습니다.** gtag가 클릭 직후의 이벤트를
 *   `navigator.sendBeacon`으로 보내는데 Playwright가 그 본문을 읽지 못합니다. 2026-09-15에
 *   `login_start`가 수집 요청에서만 보이지 않아 한참을 찾았고, `dataLayer`에는 정확히 들어 있었습니다.
 *   전송 경로가 아니라 우리 코드가 무엇을 실었는지를 보는 것이므로 이쪽이 확인하려는 것에 더 가깝습니다.
 * - **전송이 실제로 일어나는지는 수집 요청 수로 봅니다.** 스크립트도 라이브러리도 살아 있어야
 *   요청이 나갑니다.
 *
 * 기본은 가로채기입니다. 수집 요청에 204로 대신 응답해 확인용 히트가 실제 GA4 속성에 쌓이지
 * 않습니다. `--send`를 주면 통과시켜 DebugView에서 함께 볼 수 있습니다.
 *
 * 실행 절차입니다.
 *
 *   NEXT_PUBLIC_GA_MEASUREMENT_ID가 있는 .env.local을 두고
 *   npm run build
 *   npx next start -p 3125
 *   npx tsx scripts/measure-ga-events.mts --url http://127.0.0.1:3125
 *
 * 기대와 다르면 종료 코드 1입니다. 이 프로젝트는 측정 스크립트를 vitest 스위트에 넣지 않으므로
 * 스크립트 자신이 실패를 알립니다(`llm-wiki/wiki/2026-09-08-sentry-계측-후속-backlog.md` 8번).
 */
import { chromium, type Browser, type Page } from "@playwright/test";

const GA_COLLECT = /google-analytics\.com\/(g\/)?collect/;
const GA_LIBRARY = /googletagmanager\.com\/gtag\/js/;

interface Pushed {
  readonly command: string;
  readonly name: string;
  readonly params: Record<string, unknown>;
}

function argValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

/**
 * 지금 문서의 `dataLayer`를 읽습니다. gtag는 `arguments` 객체를 그대로 밀어 넣으므로 배열로 폅니다.
 * `['event', name, params]`와 `['set', params]` 둘만 봅니다.
 */
async function readDataLayer(page: Page): Promise<Pushed[]> {
  return page.evaluate(() => {
    const layer = (window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? [];
    /**
     * gtag 라이브러리 자신도 dataLayer에 값을 밀어 넣습니다. 우리가 부른 모양만 남깁니다.
     *
     * 이 안에서 이름 붙인 함수를 만들지 않습니다. tsx가 넣는 `__name` 헬퍼가 브라우저 쪽에 없어
     * `page.evaluate`가 `ReferenceError`로 끊깁니다.
     */
    const rows: { command: string; name: string; params: Record<string, unknown> }[] = [];
    for (const entry of Array.from(layer)) {
      const [command, second, third] = Array.from(entry) as [unknown, unknown, unknown];
      if (command !== "event" && command !== "set") continue;
      const raw = command === "event" ? third : second;
      rows.push({
        command,
        name: command === "event" ? String(second) : "",
        params: typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {},
      });
    }
    return rows;
  });
}

async function main(): Promise<void> {
  const baseUrl = argValue("--url", "http://127.0.0.1:3125");
  const send = process.argv.includes("--send");

  const pushed: Pushed[] = [];
  let collectRequests = 0;
  let libraryRequested = false;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();

    page.on("request", (request) => {
      if (GA_LIBRARY.test(request.url())) libraryRequested = true;
      else if (GA_COLLECT.test(request.url())) collectRequests += 1;
    });

    if (!send) {
      /**
       * 204로 대신 응답합니다. `abort`로 끊으면 gtag가 전송을 실패로 보고 그 뒤를 접을 수 있어,
       * 막는 것과 이벤트가 나가지 않는 것을 구분할 수 없게 됩니다.
       */
      await page.route(GA_COLLECT, (route) => route.fulfill({ status: 204, body: "" }));
    }

    await page.goto(baseUrl, { waitUntil: "networkidle" });

    /**
     * 클릭의 기본 동작만 막습니다. React의 onClick은 그대로 실행되므로 `login_start`는 `dataLayer`에
     * 쌓이고 문서는 그대로 남습니다. 막지 않으면 곧바로 로그인 라우트로 떠나 이 문서의 `dataLayer`를
     * 읽을 수 없습니다.
     */
    await page.evaluate(() => document.addEventListener("click", (event) => event.preventDefault(), true));
    await page.getByRole("link", { name: "Continue with GitHub" }).click();
    await page.waitForTimeout(1_500);
    pushed.push(...(await readDataLayer(page)));

    // 로그인 라우트는 OAuth 설정이 없으면 이 주소로 되돌려 보냅니다. 이동 자체가 아니라 그 화면이
    // 무엇을 남기는지를 보므로 주소로 바로 들어갑니다.
    await page.goto(`${baseUrl}/?auth_error=config_missing`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1_500);
    pushed.push(...(await readDataLayer(page)));
  } finally {
    // 중간에 던져도 브라우저를 남기지 않습니다. Node가 종료하지 못하는 것을 막습니다.
    await browser?.close();
  }

  const events = pushed.filter((entry) => entry.command === "event");
  console.log(`가로채기 ${send ? "끔(실제 전송)" : "켬(204로 대신 응답)"} · 수집 요청 ${collectRequests}건`);
  for (const entry of pushed) {
    console.log(`  ${entry.command} ${entry.name} ${JSON.stringify(entry.params)}`);
  }

  const failures: string[] = [];
  if (!libraryRequested) failures.push("gtag 라이브러리를 내려받지 않았습니다.");
  if (collectRequests === 0) failures.push("수집 요청이 한 건도 나가지 않았습니다.");

  const found = (name: string) => events.filter((event) => event.name === name);
  for (const expected of ["login_view", "login_start", "login_result"]) {
    if (found(expected).length === 0) failures.push(`${expected}가 나가지 않았습니다.`);
  }

  const loginResult = found("login_result")[0];
  if (loginResult?.params.success !== false) {
    failures.push(`login_result의 success가 false가 아닙니다: ${String(loginResult?.params.success)}`);
  }
  if (loginResult?.params.error_kind !== "config_missing") {
    failures.push(`login_result의 error_kind가 config_missing이 아닙니다: ${String(loginResult?.params.error_kind)}`);
  }

  const [firstView, errorView] = found("login_view");
  if (firstView && "auth_error" in firstView.params) {
    failures.push("오류 없이 들어온 login_view에 auth_error가 붙었습니다.");
  }
  if (errorView?.params.auth_error !== "config_missing") {
    failures.push(`오류 화면의 login_view에 auth_error가 실리지 않았습니다: ${String(errorView?.params.auth_error)}`);
  }

  /**
   * 로그인 전에는 `user_id`가 붙지 않아야 합니다. `gtag('set', { user_id: null })`을 부르면 gtag가
   * 빈 문자열로 직렬화해 이후 모든 이벤트에 `uid=`를 실어 보냅니다(2026-09-15 실측).
   */
  for (const entry of pushed) {
    if ("user_id" in entry.params) failures.push(`${entry.command} ${entry.name}에 user_id가 붙었습니다.`);
  }
  // 저장소 owner와 이름, 커밋 SHA, 파일 경로는 이 경로에 올 수 없지만 값이 새는지 함께 봅니다.
  const serialized = JSON.stringify(events);
  for (const forbidden of ["owner", "repo_name", "sha", "file_path", "email"]) {
    if (serialized.includes(`"${forbidden}"`)) failures.push(`금지한 파라미터 ${forbidden}이 실렸습니다.`);
  }

  if (failures.length > 0) {
    console.error("\n실패");
    for (const failure of failures) console.error(`  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log("\n로그인 경계 이벤트가 모두 기대대로 나갔습니다.");
}

await main();

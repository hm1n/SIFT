// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider } from "@/components/shell/auth-transition";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { GA_USER_ID_SECRET_ENV } from "@/lib/analytics/user-id";
import {
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
  encryptGitHubSession,
} from "@/lib/github/auth-session";
import Home from "./page";

/** 서버가 읽는 쿠키입니다. 테스트가 세션 유무를 여기로 정합니다. */
const cookieNames = new Set<string>();
/** `page.tsx`가 GA4 `user_id`를 만들려고 값까지 읽습니다. 기본값은 복호화할 수 없는 값입니다. */
let sessionCookieValue = "not-a-real-session";
vi.mock("next/headers", () => ({
  cookies: async () => ({
    has: (name: string) => cookieNames.has(name),
    get: (name: string) => (cookieNames.has(name) ? { name, value: sessionCookieValue } : undefined),
  }),
}));

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

/** 계측 전송부를 대체합니다. 무엇을 보내는지만 보고 실제 gtag는 부르지 않습니다. */
const trackEvent = vi.fn();
const setAnalyticsUser = vi.fn();
const clearFlow = vi.fn();
vi.mock("@/features/analytics/events", () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
  setAnalyticsUser: (...args: unknown[]) => setAnalyticsUser(...args),
  startFlow: vi.fn(),
  clearFlow: (...args: unknown[]) => clearFlow(...args),
}));

/** layout이 감싸는 provider를 함께 둡니다. 로그인 화면은 provider 밖에서 그릴 수 없습니다. */
async function renderHome(searchParams: { auth_error?: string | string[]; login?: string | string[] } = {}) {
  return <AuthTransitionProvider>{await Home({ searchParams: Promise.resolve(searchParams) })}</AuthTransitionProvider>;
}

/** 보낸 이벤트 가운데 이름이 같은 것만 거릅니다. */
function eventsNamed(name: string) {
  return trackEvent.mock.calls.map(([event]) => event).filter((event) => event?.name === name);
}

// 세션이 있으면 Repository 선택 화면이 목록을 조회합니다. 이 스위트는 화면 분기만 보므로 응답을 돌려주지 않습니다.
beforeEach(() => {
  cookieNames.clear();
  sessionCookieValue = "not-a-real-session";
  trackEvent.mockClear();
  setAnalyticsUser.mockClear();
  clearFlow.mockClear();
  routerMock.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete process.env[GITHUB_SESSION_KEY_ENV];
  delete process.env[GA_USER_ID_SECRET_ENV];
});

describe("Home", () => {
  it("세션 쿠키가 없으면 로그인 화면만 그리고 Repository 목록을 조회하지 않는다", async () => {
    render(await renderHome());
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("세션 쿠키가 있으면 Repository 선택 흐름을 시작하고 로그인 화면을 그리지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome());
    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
    expect(fetch).toHaveBeenCalledWith("/api/github/repositories", undefined);
    expect(screen.queryByRole("link", { name: "GitHub으로 계속하기" })).not.toBeInTheDocument();
  });

  /**
   * 푸터는 로그인 화면 밖, 세션 없는 분기 전체에 있습니다(이슈 #141). 로그인 화면은 상태가 셋인데
   * 인증 중과 오류는 `StatusScreen`이라 동의 문장이 없습니다. `LoginScreen` 안쪽에 두면 기본 상태에서만
   * 링크가 보입니다. 오류 상태까지 함께 보는 이유입니다.
   */
  it.each([
    ["기본", {}],
    ["오류", { auth_error: "access_denied" }],
  ])("세션이 없으면 %s 상태에서도 푸터의 법적 고지 링크를 그린다", async (_name, params) => {
    render(await renderHome(params));
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: LEGAL_LINK_COPY.privacy })).toHaveAttribute("href", "/privacy");
    expect(within(footer).getByRole("link", { name: LEGAL_LINK_COPY.terms })).toHaveAttribute("href", "/terms");
  });

  /** 로그인한 뒤에는 계정 메뉴가 같은 역할을 합니다. 워크스페이스가 푸터에 세로 공간을 내주지 않습니다. */
  it("세션이 있으면 푸터를 그리지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome());
    expect(screen.queryByRole("contentinfo")).not.toBeInTheDocument();
  });

  it("세션 쿠키가 없고 auth_error가 있으면 ERROR / AUTH 상태를 그린다", async () => {
    render(await renderHome({ auth_error: "access_denied" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ERROR / AUTH");
  });

  it("auth_error가 여러 번 오면 첫 값만 쓴다", async () => {
    render(await renderHome({ auth_error: ["state_mismatch", "access_denied"] }));
    expect(screen.getByRole("alert")).toHaveTextContent("로그인 요청을 확인할 수 없습니다.");
  });

  // 로그인이 이미 끝난 뒤 남은 쿼리입니다. 세션이 있으면 오류가 아닙니다.
  it("세션 쿠키가 있으면 auth_error 쿼리가 있어도 오류를 그리지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome({ auth_error: "access_denied" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
  });

  // 로그아웃은 세션 삭제 뒤 router.refresh()로 서버가 이 페이지를 다시 실행하는 방식입니다. 그 결과가 화면을 바꿔야 합니다.
  it("서버가 세션 없이 다시 그리면 Repository 흐름을 내리고 로그인 진입점을 표시한다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    const { rerender } = render(await renderHome());
    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");

    cookieNames.delete(GITHUB_SESSION_COOKIE);
    rerender(await renderHome());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toBeInTheDocument();
  });
});

describe("Home 계측", () => {
  /**
   * 콜백이 붙여 주는 성공 표시가 로그인 성공을 세는 유일한 근거입니다. "세션이 있는 첫 렌더"로
   * 판정하면 새로고침과 재방문까지 로그인 성공으로 세어집니다(이슈 #125).
   */
  it("로그인 성공 표시가 있으면 login_result를 한 번 보내고 표시를 지운다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome({ login: "success" }));
    expect(eventsNamed("login_result")).toEqual([{ name: "login_result", success: true }]);
    expect(routerMock.replace).toHaveBeenCalledWith("/");
  });

  it("성공 표시가 없으면 세션이 있어도 login_result를 보내지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome());
    expect(eventsNamed("login_result")).toEqual([]);
    expect(routerMock.replace).not.toHaveBeenCalled();
  });

  it("실패 표시가 있으면 실패로 남기고 auth_error만 남긴 주소로 바꾼다", async () => {
    render(await renderHome({ auth_error: "state_mismatch", login: "failed" }));
    expect(eventsNamed("login_result")).toEqual([
      { name: "login_result", success: false, error_kind: "state_mismatch" },
    ]);
    // 오류 안내의 근거는 남기고 일회성 표시만 지웁니다.
    expect(routerMock.replace).toHaveBeenCalledWith("/?auth_error=state_mismatch");
  });

  /**
   * `auth_error`가 있다는 사실로 실패를 세면 그 주소를 새로고침할 때마다 같은 로그인 실패가 다시
   * 세어집니다. 성공은 표시를 지워 한 번만 세는데 실패만 그러지 않아 둘이 어긋나 있었습니다
   * (PR #129 리뷰).
   */
  it("표시 없이 auth_error만 남은 주소는 실패로 세지 않는다", async () => {
    render(await renderHome({ auth_error: "state_mismatch" }));
    expect(eventsNamed("login_result")).toEqual([]);
    expect(routerMock.replace).not.toHaveBeenCalled();
    // 안내는 그대로 그립니다. 지우는 것은 세는 근거이지 보여 주는 근거가 아닙니다.
    expect(eventsNamed("login_view")).toEqual([{ name: "login_view", auth_error: "state_mismatch" }]);
  });

  /** 주소창의 쿼리는 아무 값이나 들어올 수 있습니다. 그대로 보내면 GA4 디멘션에 임의 문자열이 쌓입니다. */
  it("표에 없는 auth_error는 unknown으로 묶는다", async () => {
    render(await renderHome({ auth_error: "아무거나".repeat(100), login: "failed" }));
    expect(eventsNamed("login_result")).toEqual([
      { name: "login_result", success: false, error_kind: "unknown" },
    ]);
    expect(eventsNamed("login_view")).toEqual([{ name: "login_view", auth_error: "unknown" }]);
  });

  // 로그인이 이미 끝난 뒤 주소에 남은 쿼리입니다. 세션이 있으면 실패가 아닙니다.
  it("세션이 있으면 auth_error가 있어도 실패로 세지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome({ auth_error: "access_denied" }));
    expect(eventsNamed("login_result")).toEqual([]);
  });

  it("세션이 없으면 user_id를 붙이지 않는다", async () => {
    render(await renderHome());
    expect(setAnalyticsUser).toHaveBeenCalledWith(null);
  });

  /**
   * 로그아웃은 새로고침 없이 서버 컴포넌트만 다시 그려 `RepositoryFlow`가 통째로 내려갑니다. 그때
   * 화면의 이동 함수를 지나지 않으므로, 여기서 지우지 않으면 뒤이어 그려지는 로그인 화면의
   * `login_view`와 `login_start`가 지난 분석의 묶음에 붙습니다(PR #129 리뷰).
   */
  it("세션이 없으면 분석 묶음도 함께 비운다", async () => {
    render(await renderHome());
    expect(clearFlow).toHaveBeenCalled();
  });

  it("세션이 있으면 분석 묶음을 비우지 않는다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    render(await renderHome());
    expect(clearFlow).not.toHaveBeenCalled();
  });

  it("세션 쿠키를 HMAC으로 바꿔 user_id로 내려보낸다", async () => {
    process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
    process.env[GA_USER_ID_SECRET_ENV] = "hmac-secret";
    cookieNames.add(GITHUB_SESSION_COOKIE);
    sessionCookieValue = encryptGitHubSession({ token: "gho_token", githubUserId: 4242 });

    render(await renderHome());

    const userId = setAnalyticsUser.mock.calls[0]?.[0];
    expect(userId).toMatch(/^[0-9a-f]{64}$/);
    // 원본 GitHub 사용자 번호를 그대로 보내면 GitHub 공개 API로 계정을 역추적할 수 있습니다.
    expect(userId).not.toContain("4242");
  });

  /**
   * 이 페이지는 지금까지 쿠키의 존재만 보고 화면을 갈랐습니다. 만료되거나 손상된 쿠키를 든 사용자는
   * 화면을 받은 뒤 API 호출에서 재로그인 안내를 받습니다. 계측 하나 때문에 그 경로가 서버 오류로
   * 바뀌면 안 됩니다.
   */
  it("세션 쿠키를 복호화하지 못해도 화면은 그대로 그리고 user_id만 비운다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    sessionCookieValue = "broken-session-cookie";

    render(await renderHome());

    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
    expect(setAnalyticsUser).toHaveBeenCalledWith(null);
  });

  it("암호화 키가 없는 서버에서도 화면이 그대로 그려진다", async () => {
    cookieNames.add(GITHUB_SESSION_COOKIE);
    process.env[GA_USER_ID_SECRET_ENV] = "hmac-secret";
    // 키 없이 만든 값은 없으므로 존재만 하는 쿠키를 그대로 씁니다.
    render(await renderHome());

    expect(screen.getByRole("status")).toHaveTextContent("Loading Repositories");
    expect(setAnalyticsUser).toHaveBeenCalledWith(null);
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider, LoginLink } from "@/components/shell/auth-transition";
import { TopHeader } from "@/components/shell/top-header";
import { LOGIN_COPY, WITHDRAWN_COPY, WITHDRAWN_GRANT_GUIDE } from "@/copy/auth";
import { LOGIN_PATH } from "@/lib/github/auth-paths";
import { UnauthenticatedScreen } from "./unauthenticated-screen";

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const trackEvent = vi.fn();
vi.mock("@/features/analytics/events", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

afterEach(() => {
  cleanup();
  routerMock.replace.mockClear();
  trackEvent.mockClear();
});

/**
 * 기본 상태에 들어오는 화면의 자리입니다. 실제로는 랜딩이 들어오지만 이 스위트가 보는 것은 상태를
 * 가르는 규칙이라 랜딩 전체를 끌어오지 않습니다. 진입점 하나만 랜딩과 같은 `LoginLink`로 둡니다.
 * 랜딩 자체는 `features/landing/landing-page.test.tsx`가, 둘을 합친 결과는 `app/page.test.tsx`가 봅니다.
 */
function StubLanding() {
  return (
    <main>
      <LoginLink variant="primary" iconSize={15}>{LOGIN_COPY.continueWithGitHub}</LoginLink>
    </main>
  );
}

/** 이 화면은 layout의 `AuthTransitionProvider` 안에서만 그려집니다. */
function renderScreen(props: { authError?: string; withdrawn?: string } = {}) {
  return render(
    <AuthTransitionProvider>
      <UnauthenticatedScreen {...props}>
        <StubLanding />
      </UnauthenticatedScreen>
    </AuthTransitionProvider>,
  );
}

/** layout과 같은 배치입니다. 헤더 진입점이 이 화면의 상태를 바꾸는지 볼 때 씁니다. */
function renderWithHeader(authError?: string) {
  return render(
    <AuthTransitionProvider>
      <TopHeader isAuthenticated={false} />
      <UnauthenticatedScreen authError={authError}>
        <StubLanding />
      </UnauthenticatedScreen>
    </AuthTransitionProvider>,
  );
}

/** jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다. React의 onClick은 그대로 실행됩니다. */
function click(name: string, init?: MouseEventInit) {
  const link = screen.getByRole("link", { name });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
}

function expectAuthenticating() {
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("data-status-kind", "loading");
  expect(status).toHaveTextContent("Authenticating");
  expect(status).toHaveTextContent("GitHub에 연결 중…");
  expect(screen.queryByRole("link", { name: LOGIN_COPY.continueWithGitHub })).not.toBeInTheDocument();
}

describe("UnauthenticatedScreen", () => {
  it("기본 상태에서는 넘겨받은 화면을 그린다", () => {
    renderScreen();
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toHaveAttribute("href", LOGIN_PATH);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("로그인 진입점을 누르면 브라우저가 이동하기 전까지 AUTHENTICATING 상태를 그린다", () => {
    renderScreen();
    click(LOGIN_COPY.continueWithGitHub);
    expectAuthenticating();
  });

  // PR #100 리뷰: 헤더의 로그인 링크도 진입점이므로 같은 AUTHENTICATING을 그려야 합니다.
  it("헤더의 로그인 링크로 시작한 인증도 AUTHENTICATING 상태를 그린다", () => {
    renderWithHeader();
    click("GitHub으로 로그인");
    expectAuthenticating();
    expect(screen.getByRole("link", { name: "GitHub에 연결 중…" })).toHaveAttribute("aria-busy", "true");
  });

  // 오류 판정이 인증 중 판정보다 앞에 있으면 오류 화면 위에서 시작한 인증이 오류 화면에 머무릅니다.
  it("ERROR / AUTH 화면에서 헤더 로그인을 눌러도 AUTHENTICATING으로 바뀐다", () => {
    renderWithHeader("exchange_failed");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    click("GitHub으로 로그인");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectAuthenticating();
  });

  // 새 탭으로 열면 이 화면은 그대로 남습니다. 인증 중으로 바꾸면 사용자가 돌아와도 버튼을 다시 누를 수 없습니다.
  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["가운데 버튼", { button: 1 }],
  ])("%s 클릭은 새 탭으로 여는 것이므로 기본 화면을 유지한다", (_name, init) => {
    renderScreen();
    click(LOGIN_COPY.continueWithGitHub, init);
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    [LOGIN_COPY.continueWithGitHub, () => renderScreen()],
    ["GitHub으로 로그인", () => renderWithHeader()],
  ])("%s 로 시작한 인증은 bfcache에서 복원되면 풀려 기본 화면으로 돌아간다", (name, renderTarget) => {
    renderTarget();
    click(name);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    fireEvent(window, pageshow);
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toBeInTheDocument();
  });

  it("bfcache가 아닌 pageshow는 상태를 바꾸지 않는다", () => {
    renderScreen();
    click(LOGIN_COPY.continueWithGitHub);
    fireEvent(window, new Event("pageshow"));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // 이슈 #94 Constraint: 오류 종류별 안내가 사라지지 않습니다. 종류를 합쳐 한 문구로 만들지 않습니다.
  it.each([
    ["access_denied", "GitHub 권한 승인을 취소했습니다. 다시 로그인할 수 있습니다."],
    ["state_mismatch", "로그인 요청을 확인할 수 없습니다. 다시 로그인해 주세요."],
    ["exchange_failed", "GitHub 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요."],
    ["config_missing", "GitHub 로그인 설정이 없어 로그인할 수 없습니다. 서버 관리자가 설정을 고쳐야 합니다."],
  ])("%s 는 ERROR / AUTH 상태와 종류별 안내를 그린다", (authError, message) => {
    renderScreen({ authError });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-status-kind", "error");
    expect(alert).toHaveTextContent("ERROR / AUTH");
    expect(alert).toHaveTextContent("GitHub에 연결할 수 없습니다.");
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole("link", { name: LOGIN_COPY.continueWithGitHub })).not.toBeInTheDocument();
  });

  it("다시 시도는 auth_error 쿼리를 지워 기본 화면으로 돌아간다", () => {
    renderScreen({ authError: "exchange_failed" });
    fireEvent.click(screen.getByRole("button", { name: LOGIN_COPY.tryAgain }));
    expect(routerMock.replace).toHaveBeenCalledWith("/");
  });

  // 프로토타입 키는 안내 표에 없는데도 조회를 통과해, 객체가 그대로 렌더되면 화면이 죽습니다.
  it.each(["__proto__", "constructor", "toString", "없는코드"])("%s 는 로그인 오류 안내로 취급하지 않는다", (authError) => {
    renderScreen({ authError });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toBeInTheDocument();
  });
});

describe("UnauthenticatedScreen 계측", () => {
  it("화면에 들어오면 login_view를 한 번 보낸다", () => {
    renderScreen();
    expect(trackEvent.mock.calls.map(([event]) => event)).toEqual([{ name: "login_view" }]);
  });

  it("오류로 돌아온 진입은 분류를 함께 남긴다", () => {
    renderScreen({ authError: "access_denied" });
    expect(trackEvent).toHaveBeenCalledWith({ name: "login_view", auth_error: "access_denied" });
  });

  /** 주소창의 쿼리는 아무 값이나 들어올 수 있습니다. 판정 근거를 화면 안내표와 같은 표에 둡니다. */
  it("안내표에 없는 값은 unknown으로 묶는다", () => {
    renderScreen({ authError: "없는코드" });
    expect(trackEvent).toHaveBeenCalledWith({ name: "login_view", auth_error: "unknown" });
  });

  /** `다시 시도`는 쿼리를 지워 같은 진입 안에서 기본 화면으로 돌아갑니다. 새 진입이 아닙니다. */
  it("오류 안내에서 기본 화면으로 돌아가도 다시 세지 않는다", () => {
    const { rerender } = renderScreen({ authError: "access_denied" });
    rerender(
      <AuthTransitionProvider>
        <UnauthenticatedScreen>
          <StubLanding />
        </UnauthenticatedScreen>
      </AuthTransitionProvider>,
    );
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });
});

/**
 * 회원 탈퇴를 끝낸 직후의 안내입니다(이슈 #145). 계정 메뉴가 표시를 주소에 실어 보내고 이 화면이
 * 문구를 고릅니다. 탈퇴한 사용자가 마지막으로 보는 화면이라 결과를 여기서 알려야 합니다.
 */
describe("UnauthenticatedScreen 탈퇴 안내", () => {
  it.each(Object.keys(WITHDRAWN_COPY))("%s 표시의 문구를 그린다", (marker) => {
    renderScreen({ withdrawn: marker });
    expect(screen.getByRole("status")).toHaveTextContent(WITHDRAWN_COPY[marker].text);
  });

  /** 남았다는 사실만 알리고 끝내면 사용자가 할 수 있는 일이 없습니다. */
  it.each(Object.keys(WITHDRAWN_COPY).filter((marker) => WITHDRAWN_COPY[marker].grantKept))(
    "%s 표시에는 GitHub 설정에서 직접 해제하는 방법을 함께 준다",
    (marker) => {
      renderScreen({ withdrawn: marker });
      const link = within(screen.getByRole("status")).getByRole("link", { name: WITHDRAWN_GRANT_GUIDE.link });
      expect(link).toHaveAttribute("href", WITHDRAWN_GRANT_GUIDE.href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.getByRole("status")).toHaveTextContent(WITHDRAWN_GRANT_GUIDE.tail);
    },
  );

  it.each(Object.keys(WITHDRAWN_COPY).filter((marker) => !WITHDRAWN_COPY[marker].grantKept))(
    "%s 표시에는 해제 방법을 덧붙이지 않는다",
    (marker) => {
      renderScreen({ withdrawn: marker });
      expect(screen.getByRole("status")).not.toHaveTextContent(WITHDRAWN_GRANT_GUIDE.tail);
    },
  );

  /** 주소창의 쿼리는 아무 값이나 올 수 있습니다. `auth_error`와 같은 기준으로 표에 있는 값만 씁니다. */
  it.each([["표시가 없으면", undefined], ["표에 없는 값이면", "지워짐"], ["프로토타입 키면", "toString"]])(
    "%s 안내를 그리지 않는다",
    (_name, marker) => {
      renderScreen({ withdrawn: marker });
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  /** 안내가 로그인 자리를 가리면 다시 시작할 수 없습니다. 같은 화면에 함께 있어야 합니다. */
  it("안내와 함께 기본 화면을 그린다", () => {
    renderScreen({ withdrawn: "done" });
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toHaveAttribute("href", LOGIN_PATH);
  });
});

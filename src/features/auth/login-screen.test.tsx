// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider } from "@/components/shell/auth-transition";
import { LOGIN_COPY, WITHDRAWN_COPY, WITHDRAWN_GRANT_GUIDE } from "@/copy/auth";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { TopHeader } from "@/components/shell/top-header";
import { LOGIN_PATH } from "@/lib/github/auth-paths";
import { LoginScreen } from "./login-screen";

const routerMock = { push: vi.fn(), refresh: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

const trackEvent = vi.fn();
vi.mock("@/features/analytics/events", () => ({ trackEvent: (...args: unknown[]) => trackEvent(...args) }));

afterEach(() => {
  cleanup();
  routerMock.replace.mockClear();
  trackEvent.mockClear();
});

/** 로그인 화면은 layout의 `AuthTransitionProvider` 안에서만 그려집니다. */
function renderLogin(authError?: string) {
  return render(<AuthTransitionProvider><LoginScreen authError={authError} /></AuthTransitionProvider>);
}

/** layout과 같은 배치입니다. 헤더 진입점이 로그인 화면의 상태를 바꾸는지 볼 때 씁니다. */
function renderWithHeader(authError?: string) {
  return render(
    <AuthTransitionProvider>
      <TopHeader isAuthenticated={false} />
      <LoginScreen authError={authError} />
    </AuthTransitionProvider>,
  );
}

/** jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다. React의 onClick은 그대로 실행됩니다. */
function click(name: string, init?: MouseEventInit) {
  const link = screen.getByRole("link", { name });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
}

/**
 * 동의 문장이 들어 있는 문단입니다. 문장 안에 링크가 있어 `getByText`로는 잡히지 않습니다.
 * `getByText`는 자식 요소로 쪼개진 글자를 한 덩어리로 보지 않습니다.
 */
function termsParagraph(): HTMLElement {
  const link = screen.getByRole("link", { name: LOGIN_COPY.termsSentence.link });
  const paragraph = link.closest("p");
  if (paragraph === null) throw new Error("약관 동의 문장을 찾지 못했습니다.");
  return paragraph;
}

function expectAuthenticating() {
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("data-status-kind", "loading");
  expect(status).toHaveTextContent("Authenticating");
  expect(status).toHaveTextContent("GitHub에 연결 중…");
  expect(screen.queryByRole("link", { name: "GitHub으로 계속하기" })).not.toBeInTheDocument();
}

describe("LoginScreen", () => {
  it("세션이 없으면 로고 자리, 제목, 설명, GitHub 로그인 버튼, 약관 문구를 그린다", () => {
    renderLogin();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/코드 속에 숨겨진/);
    expect(screen.getByText(/GitHub의 코드와 커밋을 근거로/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toHaveAttribute("href", LOGIN_PATH);
    expect(termsParagraph()).toHaveTextContent(LOGIN_COPY.terms);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * 동의 문장을 조각으로 나눠 링크를 넣었습니다(이슈 #141). 나눈 조각이 원래 문장을 그대로 이루는지
   * 화면에서 읽은 글자로 확인합니다. `copy/auth.ts`에서 조각과 `terms`가 어긋나면 여기서 드러납니다.
   */
  it("약관 동의 문장의 `이용약관`만 링크이고 문장 전체는 그대로다", () => {
    renderLogin();
    const terms = termsParagraph();
    expect(terms).toHaveTextContent(LOGIN_COPY.terms);
    expect(within(terms).getByRole("link", { name: LOGIN_COPY.termsSentence.link })).toHaveAttribute("href", "/terms");
  });

  /**
   * 처리방침은 동의 대상이 아니라 이 화면이 링크를 갖지 않습니다. 작성지침 Part 02가 처리방침은
   * 동의를 얻어야 하는 문서가 아니라고 밝히고 있습니다. 링크는 이 화면 아래의 푸터에 있고 그쪽은
   * `site-footer.test.tsx`와 `page.test.tsx`가 봅니다.
   */
  it("처리방침 링크를 동의 문장에 넣지 않는다", () => {
    renderLogin();
    expect(screen.queryByRole("link", { name: LEGAL_LINK_COPY.privacy })).not.toBeInTheDocument();
  });

  it("버튼을 누르면 브라우저가 이동하기 전까지 AUTHENTICATING 상태를 그린다", () => {
    renderLogin();
    click("GitHub으로 계속하기");
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
  ])("%s 클릭은 새 탭으로 여는 것이므로 로그인 화면을 유지한다", (_name, init) => {
    renderLogin();
    click("GitHub으로 계속하기", init);
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it.each([
    ["GitHub으로 계속하기", renderLogin],
    ["GitHub으로 로그인", renderWithHeader],
  ])("%s 로 시작한 인증은 bfcache에서 복원되면 풀려 로그인 화면으로 돌아간다", (name, renderScreen) => {
    renderScreen();
    click(name);
    expect(screen.getByRole("status")).toBeInTheDocument();
    const pageshow = new Event("pageshow");
    Object.defineProperty(pageshow, "persisted", { value: true });
    fireEvent(window, pageshow);
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toBeInTheDocument();
  });

  it("bfcache가 아닌 pageshow는 상태를 바꾸지 않는다", () => {
    renderLogin();
    click("GitHub으로 계속하기");
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
    renderLogin(authError);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-status-kind", "error");
    expect(alert).toHaveTextContent("ERROR / AUTH");
    expect(alert).toHaveTextContent("GitHub에 연결할 수 없습니다.");
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole("link", { name: "GitHub으로 계속하기" })).not.toBeInTheDocument();
  });

  it("Try again은 auth_error 쿼리를 지워 로그인 화면으로 돌아간다", () => {
    renderLogin("exchange_failed");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(routerMock.replace).toHaveBeenCalledWith("/");
  });

  // 프로토타입 키는 안내 표에 없는데도 조회를 통과해, 객체가 그대로 렌더되면 화면이 죽습니다.
  it.each(["__proto__", "constructor", "toString", "없는코드"])("%s 는 로그인 오류 안내로 취급하지 않는다", (authError) => {
    renderLogin(authError);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "GitHub으로 계속하기" })).toBeInTheDocument();
  });
});

describe("LoginScreen 계측", () => {
  it("화면에 들어오면 login_view를 한 번 보낸다", () => {
    renderLogin();
    expect(trackEvent.mock.calls.map(([event]) => event)).toEqual([{ name: "login_view" }]);
  });

  it("오류로 돌아온 진입은 분류를 함께 남긴다", () => {
    renderLogin("access_denied");
    expect(trackEvent).toHaveBeenCalledWith({ name: "login_view", auth_error: "access_denied" });
  });

  /** 주소창의 쿼리는 아무 값이나 들어올 수 있습니다. 판정 근거를 화면 안내표와 같은 표에 둡니다. */
  it("안내표에 없는 값은 unknown으로 묶는다", () => {
    renderLogin("없는코드");
    expect(trackEvent).toHaveBeenCalledWith({ name: "login_view", auth_error: "unknown" });
  });

  /** `Try again`은 쿼리를 지워 같은 진입 안에서 기본 화면으로 돌아갑니다. 새 진입이 아닙니다. */
  it("오류 안내에서 기본 화면으로 돌아가도 다시 세지 않는다", () => {
    const { rerender } = renderLogin("access_denied");
    rerender(<AuthTransitionProvider><LoginScreen /></AuthTransitionProvider>);
    expect(trackEvent).toHaveBeenCalledTimes(1);
  });
});

/**
 * 회원 탈퇴를 끝낸 직후의 안내입니다(이슈 #145). 계정 메뉴가 표시를 주소에 실어 보내고 이 화면이
 * 문구를 고릅니다. 탈퇴한 사용자가 마지막으로 보는 화면이라 결과를 여기서 알려야 합니다.
 */
describe("LoginScreen 탈퇴 안내", () => {
  function renderWithdrawn(withdrawn?: string) {
    return render(
      <AuthTransitionProvider>
        <LoginScreen withdrawn={withdrawn} />
      </AuthTransitionProvider>,
    );
  }

  it.each(Object.keys(WITHDRAWN_COPY))("%s 표시의 문구를 그린다", (marker) => {
    renderWithdrawn(marker);
    expect(screen.getByRole("status")).toHaveTextContent(WITHDRAWN_COPY[marker].text);
  });

  /** 남았다는 사실만 알리고 끝내면 사용자가 할 수 있는 일이 없습니다. */
  it.each(Object.keys(WITHDRAWN_COPY).filter((marker) => WITHDRAWN_COPY[marker].grantKept))(
    "%s 표시에는 GitHub 설정에서 직접 해제하는 방법을 함께 준다",
    (marker) => {
      renderWithdrawn(marker);
      const link = within(screen.getByRole("status")).getByRole("link", { name: WITHDRAWN_GRANT_GUIDE.link });
      expect(link).toHaveAttribute("href", WITHDRAWN_GRANT_GUIDE.href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(screen.getByRole("status")).toHaveTextContent(WITHDRAWN_GRANT_GUIDE.tail);
    },
  );

  it.each(Object.keys(WITHDRAWN_COPY).filter((marker) => !WITHDRAWN_COPY[marker].grantKept))(
    "%s 표시에는 해제 방법을 덧붙이지 않는다",
    (marker) => {
      renderWithdrawn(marker);
      expect(screen.getByRole("status")).not.toHaveTextContent(WITHDRAWN_GRANT_GUIDE.tail);
    },
  );

  /** 주소창의 쿼리는 아무 값이나 올 수 있습니다. `auth_error`와 같은 기준으로 표에 있는 값만 씁니다. */
  it.each([["표시가 없으면", undefined], ["표에 없는 값이면", "지워짐"], ["프로토타입 키면", "toString"]])(
    "%s 안내를 그리지 않는다",
    (_name, marker) => {
      renderWithdrawn(marker);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );

  /** 안내가 로그인 자리를 가리면 다시 시작할 수 없습니다. 같은 화면에 함께 있어야 합니다. */
  it("안내와 함께 로그인 버튼을 그린다", () => {
    renderWithdrawn("done");
    expect(screen.getByRole("link", { name: LOGIN_COPY.continueWithGitHub })).toHaveAttribute("href", LOGIN_PATH);
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNT_MENU_COPY } from "@/copy/shell";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { ACCOUNT_PATH, LOGIN_PATH, SESSION_PATH } from "@/lib/github/auth-paths";
import { AuthTransitionProvider } from "./auth-transition";
import { TopHeader, type TopHeaderProps } from "./top-header";

const routerMock = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));

afterEach(() => {
  cleanup();
  routerMock.push.mockClear();
  routerMock.refresh.mockClear();
});

/** 헤더는 layout의 `AuthTransitionProvider` 안에서만 그려집니다. */
function renderHeader(props: TopHeaderProps) {
  return render(<AuthTransitionProvider><TopHeader {...props} /></AuthTransitionProvider>);
}

/** jsdom은 링크 이동을 구현하지 않아 기본 동작을 막고 클릭만 전달합니다. React의 onClick은 그대로 실행됩니다. */
function clickLogin(init?: MouseEventInit) {
  const link = screen.getByRole("link", { name: "GitHub으로 로그인" });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(link, init);
}

describe("TopHeader", () => {
  it("로그인 전에는 제품명과 GitHub 로그인 링크를 그린다", () => {
    renderHeader({ isAuthenticated: false });
    expect(screen.getByRole("banner")).toHaveTextContent("SIFT");
    expect(screen.getByRole("link", { name: "GitHub으로 로그인" })).toHaveAttribute("href", LOGIN_PATH);
    expect(screen.queryByRole("button", { name: /계정/ })).not.toBeInTheDocument();
  });

  // PR #100 리뷰: 헤더 로그인도 로그인 화면 버튼과 같은 진입점이므로 인증 중 상태를 함께 보여야 합니다.
  it("헤더 로그인 링크를 누르면 브라우저가 이동하기 전까지 인증 중 표시로 바뀐다", () => {
    renderHeader({ isAuthenticated: false });
    clickLogin();
    const link = screen.getByRole("link", { name: "GitHub에 연결 중…" });
    expect(link).toHaveAttribute("aria-busy", "true");
    expect(link).toHaveAttribute("href", LOGIN_PATH);
  });

  it.each([
    ["ctrl", { ctrlKey: true }],
    ["meta", { metaKey: true }],
    ["shift", { shiftKey: true }],
    ["가운데 버튼", { button: 1 }],
  ])("헤더 로그인의 %s 클릭은 새 탭으로 여는 것이므로 인증 중으로 바꾸지 않는다", (_name, init) => {
    renderHeader({ isAuthenticated: false });
    clickLogin(init);
    expect(screen.getByRole("link", { name: "GitHub으로 로그인" })).not.toHaveAttribute("aria-busy");
  });

  it("로그인 후에는 계정 메뉴를 그리고 Sign out이 세션을 지운 뒤 첫 화면으로 이동해 다시 그린다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
    renderHeader({ isAuthenticated: true, fetchImpl });

    expect(screen.queryByRole("link", { name: "GitHub으로 로그인" })).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: /계정/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByRole("menuitem", { name: "로그아웃" }));

    expect(fetchImpl).toHaveBeenCalledWith(SESSION_PATH, { method: "DELETE" });
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    expect(routerMock.push).toHaveBeenCalledWith("/");
  });

  it("세션 삭제 요청이 실패해도 이동하고, 헤더가 남아 있으면 Sign out을 다시 누를 수 있다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network"));
    renderHeader({ isAuthenticated: true, fetchImpl });
    const trigger = screen.getByRole("button", { name: /계정/ });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    await waitFor(() => expect(routerMock.refresh).toHaveBeenCalledTimes(1));
    // 쿠키가 남아 서버가 같은 헤더를 다시 그린 상황입니다. 메뉴가 닫히고 항목이 잠겨 있지 않아야 합니다.
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeEnabled();
  });

  /**
   * 푸터가 로그인 후 화면에서 사라졌으므로 로그인한 사용자가 처리방침에 닿는 길은 이 메뉴뿐입니다.
   * 작성지침이 로그인 여부와 상관없이 확인할 수 있어야 한다고 요구하므로 주소까지 고정합니다(이슈 #141).
   */
  it("계정 메뉴에 처리방침과 약관 링크를 둔다", () => {
    renderHeader({ isAuthenticated: true });
    fireEvent.click(screen.getByRole("button", { name: /계정/ }));
    expect(screen.getByRole("menuitem", { name: LEGAL_LINK_COPY.privacy })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("menuitem", { name: LEGAL_LINK_COPY.terms })).toHaveAttribute("href", "/terms");
  });

  it("법적 고지 링크를 누르면 메뉴가 닫힌다", () => {
    renderHeader({ isAuthenticated: true });
    fireEvent.click(screen.getByRole("button", { name: /계정/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: LEGAL_LINK_COPY.privacy }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Escape와 바깥 클릭으로 메뉴가 닫힌다", async () => {
    renderHeader({ isAuthenticated: true });
    const trigger = screen.getByRole("button", { name: /계정/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

/**
 * 회원 탈퇴입니다(이슈 #145). 라우트는 데이터 삭제와 GitHub 연결 해제와 쿠키 삭제를 함께 하고,
 * 이 메뉴는 확인을 받고 결과를 로그인 화면으로 넘기는 일만 합니다.
 */
describe("회원 탈퇴", () => {
  function openMenu(): void {
    fireEvent.click(screen.getByRole("button", { name: /계정/ }));
  }

  function respondWith(body: unknown, status = 200) {
    return vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status }));
  }

  /** 이슈 #145 Constraint입니다. 확인 없이 지워지는 경로를 만들지 않습니다. */
  it("항목을 누르는 것만으로는 요청을 보내지 않고 확인을 먼저 묻는다", () => {
    const fetchImpl = respondWith({ deleted: 1, revoked: true });
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByText(ACCOUNT_MENU_COPY.withdrawConfirm)).toBeInTheDocument();
    expect(screen.getByText(ACCOUNT_MENU_COPY.withdrawWarning)).toBeInTheDocument();
    // 되돌릴 수 없는 쪽에 초점을 두면 Enter 한 번으로 지워집니다.
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.cancel })).toHaveFocus();
  });

  it("취소하면 요청 없이 항목으로 돌아온다", () => {
    const fetchImpl = respondWith({ deleted: 1, revoked: true });
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.cancel }));

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw })).toBeInTheDocument();
  });

  it("메뉴를 닫고 다시 열면 확인 단계가 남아 있지 않다", () => {
    renderHeader({ isAuthenticated: true });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));
    fireEvent.keyDown(document, { key: "Escape" });

    openMenu();

    expect(screen.queryByText(ACCOUNT_MENU_COPY.withdrawConfirm)).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw })).toBeInTheDocument();
  });

  /**
   * 표시 넷을 응답에서 만듭니다. 사용자가 알아야 할 것이 지울 데이터가 있었는지와 GitHub 연결이
   * 실제로 끊겼는지, 둘입니다. 문구는 로그인 화면이 이 표시로 고릅니다.
   */
  it.each([
    [{ deleted: 2, revoked: true }, "/?withdrawn=done"],
    [{ deleted: 0, revoked: true }, "/?withdrawn=empty"],
    [{ deleted: 2, revoked: false }, "/?withdrawn=done_kept"],
    [{ deleted: 0, revoked: false }, "/?withdrawn=empty_kept"],
  ])("%o를 받으면 %s로 보낸다", async (body, url) => {
    const fetchImpl = respondWith(body);
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));

    expect(fetchImpl).toHaveBeenCalledWith(ACCOUNT_PATH, {
      method: "DELETE",
      // 제한 시간이 없으면 응답이 오지 않을 때 `탈퇴 중…`에서 멈추고 메뉴도 닫히지 않습니다.
      signal: expect.any(AbortSignal),
    });
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith(url));
    expect(routerMock.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  /**
   * 200을 받았다면 삭제는 끝났습니다. 본문을 읽지 못한 것을 실패로 보이면 사용자가 이미 지워진
   * 데이터를 지우려고 다시 시도합니다. 표시는 확인할 일이 남은 쪽으로 둡니다.
   */
  it("본문을 읽지 못해도 이동하고 연결이 남은 표시를 쓴다", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("본문 아님", { status: 200 }));
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/?withdrawn=done_kept"));
  });

  it.each([
    ["오류 응답", () => vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: {} }, { status: 503 }))],
    ["전송 실패", () => vi.fn<typeof fetch>().mockRejectedValue(new TypeError("network"))],
  ])("%s이면 안내를 보이고 이동하지 않는다", async (_name, makeFetch) => {
    renderHeader({ isAuthenticated: true, fetchImpl: makeFetch() });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(ACCOUNT_MENU_COPY.withdrawFailed));
    expect(routerMock.push).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawRetry })).toBeEnabled();
  });

  it("실패한 뒤 다시 시도해서 끝낼 수 있다", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: {} }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ deleted: 1, revoked: true }, { status: 200 }));
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawRetry }));

    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/?withdrawn=done"));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  /** 확인 단계와 같은 규칙입니다. 요청이 도는 중에 취소로 빠져나가면 결과를 받을 자리가 사라집니다. */
  it("실패 뒤 다시 시도하는 중에도 취소가 잠긴다", async () => {
    let finish: (value: Response) => void = () => undefined;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: {} }, { status: 503 }))
      .mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          finish = resolve;
        })
      );
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawRetry }));

    expect(await screen.findByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawing })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.cancel })).toBeDisabled();

    finish(Response.json({ deleted: 1, revoked: true }, { status: 200 }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/?withdrawn=done"));
  });

  /** 닫히면 실패 안내가 갈 자리가 사라지고, 잠기지 않으면 같은 요청이 두 번 나갑니다. */
  it("탈퇴 중에는 버튼이 잠기고 바깥 클릭으로 닫히지 않는다", async () => {
    let finish: (value: Response) => void = () => undefined;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    const fetchImpl = vi.fn<typeof fetch>().mockReturnValue(pending);
    renderHeader({ isAuthenticated: true, fetchImpl });
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdraw }));

    fireEvent.click(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawConfirmAction }));

    const confirming = await screen.findByRole("menuitem", { name: ACCOUNT_MENU_COPY.withdrawing });
    expect(confirming).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: ACCOUNT_MENU_COPY.cancel })).toBeDisabled();
    fireEvent.mouseDown(document.body);
    expect(screen.getByRole("menu")).toBeInTheDocument();

    finish(Response.json({ deleted: 1, revoked: true }, { status: 200 }));
    await waitFor(() => expect(routerMock.push).toHaveBeenCalledWith("/?withdrawn=done"));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

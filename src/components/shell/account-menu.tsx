"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ACCOUNT_MENU_COPY } from "@/copy/shell";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { UNKNOWN_WITHDRAWAL_MARKER, withdrawnMarker } from "@/features/auth/withdrawal";
import { ACCOUNT_PATH, SESSION_PATH } from "@/lib/github/auth-paths";
import styles from "./top-header.module.css";

export interface AccountMenuProps {
  fetchImpl?: typeof fetch;
}

/**
 * 메뉴 본문의 상태입니다. 회원 탈퇴는 되돌릴 수 없어 확인 단계를 거칩니다(이슈 #145).
 *
 * 대화상자를 띄우지 않고 메뉴 본문을 갈아 끼웁니다. 저장된 인터뷰 목록의 삭제 확인이 같은 방식이고
 * 레퍼런스 디자인의 계정 메뉴도 그렇습니다.
 */
type MenuMode = "items" | "confirm" | "failed";

/**
 * 로그인 뒤 헤더 오른쪽의 계정 메뉴입니다. 항목은 개인정보 처리방침과 이용약관, 로그아웃, 회원 탈퇴입니다.
 *
 * 법적 고지 링크가 여기 있는 이유입니다(이슈 #141). 푸터는 로그인 화면과 문서 화면에만 있고 로그인한
 * 뒤에는 그리지 않습니다. 디자인 파일이 앱 화면에 푸터를 두지 않고, 인터뷰 워크스페이스가 세로 공간을
 * 55px 잃기 때문입니다. 그러면 로그인한 사용자가 처리방침에 닿을 곳이 필요한데, 개인정보 처리방침
 * 작성지침이 "로그인 여부와 상관없이" 확인할 수 있어야 한다고 요구합니다. 그 자리가 이 메뉴입니다.
 *
 * 회원 탈퇴도 같은 자리에 둡니다(이슈 #145). 작성지침 16번이 권리 행사 절차가 수집 절차보다 어렵지
 * 않아야 한다고 요구하므로, 로그인이 한 번의 클릭이면 삭제를 요구하는 자리도 한 번의 클릭으로 닿아야 합니다.
 *
 * 세션 쿠키에는 GitHub 사용자 정보가 없으므로 이니셜과 사용자명 자리에 GitHub 마크 문구를 둡니다.
 * 로그아웃은 세션 삭제 라우트를 부른 뒤 첫 화면으로 이동하고 서버 컴포넌트를 다시 그립니다. 헤더는 layout이
 * 쿠키를 읽어 그리므로 갱신만으로 로그인 전 상태가 되고, `RepositoryAnalysisView`는 바뀐 `hasSession` prop을
 * 따라갑니다.
 */
export function AccountMenu({ fetchImpl }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [mode, setMode] = useState<MenuMode>("items");
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    // 탈퇴 요청이 도는 중에는 닫지 않습니다. 닫히면 실패 안내가 갈 자리가 사라집니다.
    if (isWithdrawing) return;
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) closeMenu();
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [isOpen, isWithdrawing]);

  // 확인 단계에서는 취소에 초점을 둡니다. 되돌릴 수 없는 쪽에 초점을 두면 Enter 한 번으로 지워집니다.
  useEffect(() => {
    if (mode === "confirm") cancelRef.current?.focus();
  }, [mode]);

  function closeMenu() {
    setIsOpen(false);
    // 확인 단계를 남겨 두면 다시 열었을 때 묻는 화면부터 보입니다.
    setMode("items");
  }

  async function signOut() {
    setIsSigningOut(true);
    const doFetch = fetchImpl ?? fetch;
    // 삭제 요청이 실패해도 진행합니다. 쿠키가 남아 있으면 다음 화면이 다시 로그인 상태로 그려지므로 사용자가 알 수 있습니다.
    await doFetch(SESSION_PATH, { method: "DELETE" }).catch(() => undefined);
    router.push("/");
    router.refresh();
    // 삭제가 실패해 쿠키가 남으면 다시 그린 헤더에 이 메뉴가 그대로 있습니다. 버튼을 다시 누를 수 있게 되돌립니다.
    setIsSigningOut(false);
    closeMenu();
  }

  /**
   * 회원 탈퇴입니다. 데이터 삭제와 GitHub 연결 해제와 세션 쿠키 삭제를 라우트 하나가 합니다.
   *
   * 응답을 받으면 표시를 붙여 로그인 화면으로 보냅니다. 이 화면에 남아 있을 수 없습니다. 쿠키가 이미
   * 사라져서 여기서 보내는 다음 요청은 모두 401로 답합니다.
   *
   * 본문을 읽지 못해도 이동합니다. 200을 받았다면 삭제는 끝났고, 그때 실패로 보이면 사용자가 이미
   * 지워진 데이터를 지우려고 다시 시도합니다. 그 경우 표시는 확인할 일이 남은 쪽으로 둡니다
   * (`withdrawnMarker`).
   */
  async function withdraw() {
    setIsWithdrawing(true);
    const doFetch = fetchImpl ?? fetch;
    try {
      const response = await doFetch(ACCOUNT_PATH, { method: "DELETE" });
      if (!response.ok) {
        setMode("failed");
        return;
      }
      let marker = UNKNOWN_WITHDRAWAL_MARKER;
      try {
        marker = withdrawnMarker(await response.json());
      } catch {
        // 기본값을 그대로 씁니다. 이유는 `UNKNOWN_WITHDRAWAL_MARKER` 주석에 있습니다.
      }
      router.push(`/?withdrawn=${marker}`);
      router.refresh();
      closeMenu();
    } catch {
      setMode("failed");
    } finally {
      setIsWithdrawing(false);
    }
  }

  return (
    <div className={styles.account} ref={rootRef}>
      <button
        type="button"
        className={styles.accountButton}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => (isOpen ? closeMenu() : setIsOpen(true))}
      >
        <span className={styles.avatar} aria-hidden="true">G</span>
        <span className={styles.accountLabel}>{ACCOUNT_MENU_COPY.trigger}</span>
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </button>
      {isOpen ? (
        <div className={styles.menu} id={menuId} role="menu">
          <div className={styles.menuHeader}>
            <span className={styles.avatar} aria-hidden="true">G</span>
            <div>
              <p className={styles.menuTitle}>{ACCOUNT_MENU_COPY.signedIn}</p>
              <p className={styles.menuSub}>{ACCOUNT_MENU_COPY.account}</p>
            </div>
          </div>
          {mode === "items" ? (
            <div className={styles.menuBody}>
              {/* 메뉴를 열어 둔 채로 이동하면 돌아왔을 때 열려 있으므로 누를 때 닫습니다. */}
              <Link role="menuitem" className={styles.menuLink} href="/privacy" onClick={closeMenu}>
                {LEGAL_LINK_COPY.privacy}
              </Link>
              <Link role="menuitem" className={styles.menuLink} href="/terms" onClick={closeMenu}>
                {LEGAL_LINK_COPY.terms}
              </Link>
              <div className={styles.menuDivider} role="separator" />
              <button type="button" role="menuitem" className={styles.menuItem} onClick={signOut} disabled={isSigningOut}>
                {isSigningOut ? ACCOUNT_MENU_COPY.signingOut : ACCOUNT_MENU_COPY.signOut}
              </button>
              {/* 되돌릴 수 없는 항목이라 로그아웃과 색으로도 가릅니다. 누르면 확인 단계로 바뀝니다. */}
              <button type="button" role="menuitem" className={styles.menuItemDanger} onClick={() => setMode("confirm")}>
                {ACCOUNT_MENU_COPY.withdraw}
              </button>
            </div>
          ) : null}
          {mode === "confirm" ? (
            <div className={styles.confirm} role="group" aria-label={ACCOUNT_MENU_COPY.withdrawConfirm}>
              <p className={styles.confirmTitle}>{ACCOUNT_MENU_COPY.withdrawConfirm}</p>
              <p className={styles.confirmText}>{ACCOUNT_MENU_COPY.withdrawWarning}</p>
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.cancel}
                  ref={cancelRef}
                  onClick={() => setMode("items")}
                  disabled={isWithdrawing}
                >
                  {ACCOUNT_MENU_COPY.cancel}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.withdraw}
                  onClick={withdraw}
                  disabled={isWithdrawing}
                >
                  {isWithdrawing ? ACCOUNT_MENU_COPY.withdrawing : ACCOUNT_MENU_COPY.withdrawConfirmAction}
                </button>
              </div>
            </div>
          ) : null}
          {mode === "failed" ? (
            <div className={styles.confirm} role="group" aria-label={ACCOUNT_MENU_COPY.withdrawFailed}>
              <p className={styles.confirmText} role="alert">{ACCOUNT_MENU_COPY.withdrawFailed}</p>
              <div className={styles.confirmActions}>
                <button type="button" role="menuitem" className={styles.cancel} onClick={() => setMode("items")}>
                  {ACCOUNT_MENU_COPY.cancel}
                </button>
                <button type="button" role="menuitem" className={styles.withdraw} onClick={withdraw} disabled={isWithdrawing}>
                  {isWithdrawing ? ACCOUNT_MENU_COPY.withdrawing : ACCOUNT_MENU_COPY.withdrawRetry}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

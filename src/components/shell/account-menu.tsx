"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import styles from "./top-header.module.css";

const SESSION_PATH = "/api/auth/session";

export interface AccountMenuProps {
  fetchImpl?: typeof fetch;
  onSignedOut?: () => void;
}

/**
 * 로그인 뒤 헤더 오른쪽의 계정 메뉴입니다. 항목은 Sign out 하나입니다.
 *
 * 세션 쿠키에는 GitHub 사용자 정보가 없으므로 이니셜과 사용자명 자리에 GitHub 마크 문구를 둡니다.
 * Sign out은 세션 삭제 라우트를 부른 뒤 첫 화면으로 이동하고 서버 컴포넌트를 다시 그립니다. 헤더는 layout이
 * 쿠키를 읽어 그리므로 갱신만으로 로그인 전 상태가 되고, `RepositoryAnalysisView`는 바뀐 `hasSession` prop을
 * 따라갑니다.
 */
export function AccountMenu({ fetchImpl, onSignedOut }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const router = useRouter();

  useEffect(() => {
    if (!isOpen) return;
    function close(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [isOpen]);

  async function signOut() {
    setIsSigningOut(true);
    const doFetch = fetchImpl ?? fetch;
    // 삭제 요청이 실패해도 진행합니다. 쿠키가 남아 있으면 다음 화면이 다시 로그인 상태로 그려지므로 사용자가 알 수 있습니다.
    await doFetch(SESSION_PATH, { method: "DELETE" }).catch(() => undefined);
    if (onSignedOut) {
      onSignedOut();
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <div className={styles.account} ref={rootRef}>
      <button
        type="button"
        className={styles.accountButton}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className={styles.avatar} aria-hidden="true">G</span>
        <span className={styles.accountLabel}>Account</span>
        <span className={styles.chevron} aria-hidden="true">▾</span>
      </button>
      {isOpen ? (
        <div className={styles.menu} id={menuId} role="menu">
          <div className={styles.menuHeader}>
            <span className={styles.avatar} aria-hidden="true">G</span>
            <div>
              <p className={styles.menuTitle}>Signed in</p>
              <p className={styles.menuSub}>GitHub account</p>
            </div>
          </div>
          <div className={styles.menuBody}>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={signOut} disabled={isSigningOut}>
              {isSigningOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

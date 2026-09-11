import Link from "next/link";
import { AccountMenu } from "./account-menu";
import { LoginLink } from "./auth-transition";
import { SiftMark } from "./sift-mark";
import styles from "./top-header.module.css";

export interface TopHeaderProps {
  /**
   * 세션 쿠키가 있는지입니다. 사용자명은 세션에 없어 그리지 않습니다.
   * #94에서 쿠키 계약을 바꾸지 않기로 해 사용자 정보는 쿠키에 넣지 않습니다. 표시 여부는 Repository 목록 API를 만드는 #95가 정합니다.
   */
  isAuthenticated: boolean;
  /** 테스트에서 fetch를 대체하는 통로입니다. */
  fetchImpl?: typeof fetch;
}

/**
 * 모든 화면 위에 놓이는 상단 헤더입니다. 로고 마크와 제품명, 그리고 로그인 전에는 로그인 버튼, 로그인 후에는 계정 메뉴를 그립니다.
 * 디자인 파일 `App.tsx`의 `TopHeader`를 옮겼고 계정 삭제 항목은 MVP 범위 밖이라 빼두었습니다.
 * 로그인 링크는 로그인 화면의 버튼과 같은 `LoginLink`라 인증 중 상태를 함께 봅니다. `AuthTransitionProvider` 안에서만 그릴 수 있습니다.
 */
export function TopHeader({ isAuthenticated, fetchImpl }: TopHeaderProps) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="SIFT home">
        <SiftMark size={16} />
        <span className={styles.brandName}>SIFT</span>
      </Link>
      {isAuthenticated ? (
        <AccountMenu fetchImpl={fetchImpl} />
      ) : (
        <LoginLink variant="secondary" iconSize={13}>Log in with GitHub</LoginLink>
      )}
    </header>
  );
}

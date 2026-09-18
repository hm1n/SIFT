import Link from "next/link";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import styles from "./site-footer.module.css";

/**
 * 모든 화면 아래에 놓이는 공통 푸터입니다(이슈 #141).
 *
 * 개인정보 처리방침 작성지침 Part 02가 "로그인 여부와 상관없이 웹 첫 화면에서 바로 찾을 수 있도록"
 * 공개하라고 요구합니다. 로그인 화면의 안내 문구에만 링크를 걸면 로그인한 뒤에는 처리방침에 닿을
 * 길이 없어져 그 요구를 만족하지 못합니다.
 *
 * `flex-shrink: 0`인 28px 줄 하나라 아래 화면들의 배치 규칙을 바꾸지 않습니다. `.shell`과 로그인
 * 화면은 `flex: 1`로 남은 높이를 받으므로 이 줄의 높이만큼만 줄어듭니다.
 *
 * 처리방침 링크를 약관 링크보다 진하게 그립니다. 표준지침 제20조가 "개인정보 처리방침"이라는 명칭을
 * 글자 크기나 색상으로 다른 고지사항과 구분하라고 정하고 있습니다.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer} aria-label={LEGAL_LINK_COPY.footerLabel}>
      <Link className={styles.privacyLink} href="/privacy">
        {LEGAL_LINK_COPY.privacy}
      </Link>
      <Link className={styles.link} href="/terms">
        {LEGAL_LINK_COPY.terms}
      </Link>
    </footer>
  );
}

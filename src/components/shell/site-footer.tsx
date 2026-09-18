import Link from "next/link";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { SiftMark } from "./sift-mark";
import styles from "./site-footer.module.css";

/**
 * 로그인 화면과 법적 고지 문서 화면 아래에 놓이는 푸터입니다(이슈 #141).
 *
 * 로그인한 뒤에는 그리지 않습니다. 그 자리는 계정 메뉴가 맡습니다. layout이 아니라 `page.tsx`의
 * 세션 없는 분기와 문서 화면이 이 컴포넌트를 부릅니다.
 *
 * 개인정보 처리방침 작성지침 Part 02가 "로그인 여부와 상관없이 웹 첫 화면에서 바로 찾을 수 있도록"
 * 공개하라고 요구합니다. 로그인 화면의 안내 문구에만 링크를 걸면 로그인한 뒤에는 처리방침에 닿을
 * 길이 없어져 그 요구를 만족하지 못합니다.
 *
 * 배치와 타이포그래피는 디자인 파일 `App.tsx`의 랜딩 푸터를 옮겼습니다. 왼쪽에 마크와 워드마크,
 * 오른쪽에 한 덩어리입니다. 원본의 오른쪽은 `DEVELOPER TOOL · AI INTERVIEW` 태그라인인데 그 자리에
 * 법적 고지 링크를 넣었습니다. 태그라인은 이 저장소에 없는 랜딩 화면의 문구입니다.
 *
 * 원본과 다른 것이 하나 있습니다. 원본의 오른쪽 글자는 neutral-300이라 흰 배경에서 대비가 약
 * 1.6:1입니다. 그 색을 링크에 쓰면 표준지침 제20조가 요구하는 "쉽게 확인할 수 있도록"에 어긋나므로
 * 링크만 `--color-muted-foreground`로 올렸습니다. 왼쪽 브랜드는 원본 색 그대로입니다.
 *
 * 처리방침 링크를 약관 링크보다 진하게 그립니다. 같은 조항이 "개인정보 처리방침"이라는 명칭을
 * 글자 크기나 색상으로 다른 고지사항과 구분하라고 정하고 있습니다.
 */
export function SiteFooter() {
  return (
    <footer className={styles.footer} aria-label={LEGAL_LINK_COPY.footerLabel}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <SiftMark size={14} />
          <span className={styles.brandName}>SIFT</span>
        </div>
        <div className={styles.links}>
          <Link className={styles.privacyLink} href="/privacy">
            {LEGAL_LINK_COPY.privacy}
          </Link>
          <Link className={styles.link} href="/terms">
            {LEGAL_LINK_COPY.terms}
          </Link>
        </div>
      </div>
    </footer>
  );
}

import Link from "next/link";
import {
  LEGAL_DOCUMENT_COPY,
  type LegalBlock,
  type LegalDocument as LegalDocumentData,
} from "@/copy/legal";
import styles from "./legal-document.module.css";

export interface LegalDocumentProps {
  readonly document: LegalDocumentData;
}

/**
 * 개인정보 처리방침과 이용약관을 그리는 공통 화면입니다(이슈 #141).
 *
 * 두 문서의 구조가 같아 컴포넌트를 하나만 둡니다. 다른 것은 본문 데이터뿐이고 그것은 `copy/legal.ts`에
 * 있습니다.
 *
 * 상태가 없습니다. 서버에서 한 번 그리고 끝나므로 Loading과 Empty와 Error 상태가 생기지 않습니다.
 * 데이터가 상수이고 사용자 입력도 서버 조회도 없기 때문입니다.
 *
 * 목차와 앵커는 작성지침 Part 04의 권장사항입니다. 절이 열한 개라 처음부터 읽지 않고 필요한 절로
 * 바로 갈 수 있어야 합니다.
 */
export function LegalDocument({ document }: LegalDocumentProps) {
  return (
    <main className={styles.screen}>
      <article className={styles.document}>
        <header className={styles.header}>
          <h1 className={styles.title}>{document.title}</h1>
          <p className={styles.effectiveDate}>
            {LEGAL_DOCUMENT_COPY.effectiveDatePrefix} {document.effectiveDate}
          </p>
          {document.intro.map((paragraph) => (
            <p className={styles.intro} key={paragraph}>
              {paragraph}
            </p>
          ))}
        </header>

        <nav className={styles.contents} aria-label={document.tableOfContentsLabel}>
          <h2 className={styles.contentsLabel}>{document.tableOfContentsLabel}</h2>
          <ol className={styles.contentsList}>
            {document.sections.map((section) => (
              <li key={section.id}>
                <a className={styles.contentsLink} href={`#${section.id}`}>
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {document.sections.map((section) => (
          <section className={styles.section} key={section.id} id={section.id}>
            <h2 className={styles.heading}>{section.heading}</h2>
            {section.blocks.map((block, index) => (
              <LegalBlockView block={block} label={section.heading} key={index} />
            ))}
          </section>
        ))}

        <footer className={styles.documentFooter}>
          <Link className={styles.backLink} href="/">
            {LEGAL_DOCUMENT_COPY.backToHome}
          </Link>
        </footer>
      </article>
    </main>
  );
}

/**
 * 표는 가로로 넘칠 수 있어 스크롤 상자로 감쌉니다. 국외 이전 표가 여섯 칸이라 좁은 화면에서 칸이
 * 뭉개집니다. 칸을 줄이는 쪽은 택하지 않았습니다. 여섯 칸 모두 법이 요구하는 기재사항입니다.
 *
 * 그 상자에 `tabIndex`와 이름을 답니다. 스크롤이 생겨도 상자 안에 포커스 받을 요소가 없어서, 브라우저에
 * 따라 Tab 순서에 들어가지 않고 키보드만 쓰는 사용자가 오른쪽 칸으로 갈 수 없습니다(PR #146 리뷰).
 * 이름은 그 표가 속한 절의 제목입니다. 이름 없는 포커스 지점을 만들면 어디에 있는지 알 수 없습니다.
 *
 * key를 내용이 아니라 순서로 답니다. 한 행에 같은 값이 두 칸 들어가는 순간 중복 key가 되는데, 표의
 * 행과 칸은 데이터 순서가 그대로 화면 순서라 순서가 안정된 식별자입니다.
 */
function LegalBlockView({ block, label }: { readonly block: LegalBlock; readonly label: string }) {
  if (block.kind === "paragraph") return <p className={styles.paragraph}>{block.text}</p>;

  if (block.kind === "list") {
    return (
      <ul className={styles.list}>
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }

  return (
    <div className={styles.tableScroll} tabIndex={0} role="group" aria-label={label}>
      <table className={styles.table}>
        <thead>
          <tr>
            {block.head.map((cell) => (
              <th key={cell} scope="col">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row) => (
            <tr key={row.join("|")}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  {/* 셀 안에서 줄을 나눠야 하는 값이 있습니다. 이전받는 자의 이름과 연락처가 그렇습니다. */}
                  {cell.split("\n").map((line, lineIndex) => (
                    <span className={styles.cellLine} key={lineIndex}>
                      {line}
                    </span>
                  ))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

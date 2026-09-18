// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PRIVACY_OFFICER, PRIVACY_POLICY, TERMS_OF_SERVICE, type LegalDocument as LegalDocumentData } from "@/copy/legal";
import { LegalDocument } from "./legal-document";

afterEach(cleanup);

const DOCUMENTS: readonly { readonly name: string; readonly document: LegalDocumentData }[] = [
  { name: "개인정보 처리방침", document: PRIVACY_POLICY },
  { name: "이용약관", document: TERMS_OF_SERVICE },
];

describe("LegalDocument", () => {
  it.each(DOCUMENTS)("$name: 제목과 시행일과 서문을 그린다", ({ document }) => {
    render(<LegalDocument document={document} />);
    expect(screen.getByRole("heading", { level: 1, name: document.title })).toBeInTheDocument();
    // 시행일은 머리글과 마지막 절에 모두 나옵니다. 머리글의 것만 보려고 라벨을 붙여 찾습니다.
    expect(screen.getByText(`시행일 ${document.effectiveDate}`)).toBeInTheDocument();
    for (const paragraph of document.intro) expect(screen.getByText(paragraph)).toBeInTheDocument();
  });

  /**
   * 목차 링크가 실제 절로 가야 합니다. 앵커는 눈에 보이지 않아 어긋나도 화면만 봐서는 드러나지
   * 않습니다. 절이 열한 개라 목차가 제 구실을 못하면 필요한 절을 찾을 방법이 없습니다.
   */
  it.each(DOCUMENTS)("$name: 목차 링크가 모두 실제 절의 앵커를 가리킨다", ({ document }) => {
    const { container } = render(<LegalDocument document={document} />);
    const contents = screen.getByRole("navigation", { name: document.tableOfContentsLabel });
    const links = within(contents).getAllByRole("link");
    expect(links).toHaveLength(document.sections.length);

    for (const [index, link] of links.entries()) {
      const section = document.sections[index];
      expect(link).toHaveTextContent(section.heading);
      expect(link).toHaveAttribute("href", `#${section.id}`);
      expect(container.querySelector(`#${section.id}`)).not.toBeNull();
    }
  });

  it.each(DOCUMENTS)("$name: 모든 절의 제목을 본문에 그린다", ({ document }) => {
    render(<LegalDocument document={document} />);
    for (const section of document.sections) {
      expect(screen.getByRole("heading", { level: 2, name: section.heading })).toBeInTheDocument();
    }
  });

  it("표의 머리글을 열 이름으로 읽을 수 있다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    // 국외 이전 표 둘입니다. 법이 요구하는 기재사항이 한 칸도 빠지지 않아야 합니다.
    expect(screen.getAllByRole("columnheader", { name: "이전 국가" })).toHaveLength(2);
    expect(screen.getAllByRole("columnheader", { name: "이전 시기와 방법" })).toHaveLength(2);
    expect(screen.getAllByRole("columnheader", { name: "보유·이용 기간" })).toHaveLength(2);
  });

  it("홈으로 돌아가는 링크를 둔다", () => {
    render(<LegalDocument document={TERMS_OF_SERVICE} />);
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/");
  });
});

/**
 * 본문이 법이 요구하는 것을 담고 있는지 보는 테스트입니다. 화면 구조가 아니라 내용을 봅니다.
 *
 * 이 절들은 지우거나 이름을 바꾸면 문서가 법정 기재사항을 잃습니다. 화면 테스트는 "절이 그려지는지"만
 * 보므로 절 하나를 통째로 지워도 통과합니다.
 */
describe("개인정보 처리방침의 법정 기재사항", () => {
  const headings = PRIVACY_POLICY.sections.map((section) => section.heading).join("\n");

  it.each([
    "처리 목적",
    "보유 기간",
    "파기",
    "제3자 제공",
    "국외 이전",
    "안전성 확보 조치",
    "자동 수집 장치",
    "권리",
    "고충사항을 처리하는 창구",
    "권익침해 구제",
    "변경",
  ])("'%s'를 다루는 절이 있다", (keyword) => {
    expect(headings).toContain(keyword);
  });

  it("국외 이전의 법적 근거와 거부 방법과 그 효과를 적는다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    expect(screen.getByText(/제28조의8제1항제3호/)).toBeInTheDocument();
    expect(screen.getByText(/위 표의 이전을 거부하면 서비스를 이용할 수 없습니다/)).toBeInTheDocument();
  });

  /**
   * PR #146 리뷰가 지적한 것입니다. 이용 통계는 측정 ID가 없으면 스크립트를 싣지 않고 없어도 서비스가
   * 그대로 돕니다. 서비스 실행에 필요한 이전과 한 표에 담으면 거부의 효과가 정반대인 둘을 한 문장이
   * 덮습니다. 표를 나눈 것과 거부 효과를 가른 것을 함께 고정합니다.
   */
  it("서비스 실행에 필요한 이전과 선택적 이전을 나눠 적는다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    expect(
      screen.getByText(/거부해도 서비스의 모든 기능을 그대로 이용할 수 있습니다/)
    ).toBeInTheDocument();

    // 국외 이전 표 둘만 고릅니다. 문서에는 처리 목적 표와 쿠키 표도 있습니다.
    const [required, optional] = screen
      .getAllByRole("table")
      .filter((table) => table.textContent?.includes("이전 국가"));
    // 이용 통계는 선택적 이전 표에만 있어야 합니다.
    expect(within(required).queryByText(/Google Analytics/)).not.toBeInTheDocument();
    expect(within(optional).getByText(/Google Analytics/)).toBeInTheDocument();
  });

  /**
   * 이용 통계의 보유 기간은 이 저장소가 정한 GA4 속성 설정(14개월)입니다. "Google Analytics가 정한
   * 기간"이라고 쓰면 사용자가 보는 문서가 실제 설정과 달라집니다(PR #146 리뷰).
   */
  it("이용 통계의 보유 기간을 14개월로 적는다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    expect(screen.getAllByText("14개월").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Google Analytics가 정한 기간/)).not.toBeInTheDocument();
  });

  /**
   * 법 제30조제1항제6호는 보호책임자의 성명 또는 고충사항을 처리하는 부서의 명칭과 연락처 중
   * 하나를 요구합니다. 이 서비스는 뒤쪽을 골랐으므로 창구 이름과 전자우편이 둘 다 있어야 합니다.
   */
  it("고충사항을 처리하는 창구의 이름과 연락처를 적는다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    expect(screen.getByText(`창구 : ${PRIVACY_OFFICER.department}`)).toBeInTheDocument();
    expect(screen.getByText(`전자우편 : ${PRIVACY_OFFICER.email}`)).toBeInTheDocument();
  });

  it("Google Analytics 거부 방법을 안내한다", () => {
    render(<LegalDocument document={PRIVACY_POLICY} />);
    expect(screen.getByText(/tools\.google\.com\/dlpage\/gaoptout/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { SiteFooter } from "./site-footer";

afterEach(cleanup);

describe("SiteFooter", () => {
  /**
   * 이 링크가 사라지면 로그인한 사용자가 처리방침에 닿을 길이 없어집니다. 작성지침이 로그인 여부와
   * 상관없이 확인할 수 있어야 한다고 요구하므로 주소까지 고정합니다.
   */
  it("처리방침과 약관 링크를 그린다", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: LEGAL_LINK_COPY.privacy })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: LEGAL_LINK_COPY.terms })).toHaveAttribute("href", "/terms");
  });

  it("이름을 가진 contentinfo landmark로 그린다", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("contentinfo", { name: LEGAL_LINK_COPY.footerLabel })).toBeInTheDocument();
  });

  /**
   * 디자인 파일의 랜딩 푸터를 옮기면서 왼쪽에 브랜드가 생겼습니다. 마크는 `aria-hidden`이라 워드마크
   * 글자만 읽힙니다.
   */
  it("왼쪽에 브랜드 워드마크를 그린다", () => {
    render(<SiteFooter />);
    const footer = screen.getByRole("contentinfo", { name: LEGAL_LINK_COPY.footerLabel });
    expect(footer).toHaveTextContent("SIFT");
  });

  /** 브랜드는 링크가 아닙니다. 상단 헤더의 마크가 이미 홈으로 가는 링크라 같은 자리를 둘로 만들지 않습니다. */
  it("브랜드를 링크로 만들지 않는다", () => {
    render(<SiteFooter />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});

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
});

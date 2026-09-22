// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthTransitionProvider } from "@/components/shell/auth-transition";
import { LOGIN_COPY } from "@/copy/auth";
import { LANDING_COPY } from "@/copy/landing";
import { LEGAL_LINK_COPY } from "@/copy/legal";
import { DOCUMENT_COPY, SITE_URL } from "@/copy/shell";
import { LOGIN_PATH } from "@/lib/github/auth-paths";
import { LandingPage } from "./landing-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/features/analytics/events", () => ({ trackEvent: vi.fn() }));

afterEach(cleanup);

/** 랜딩 안의 `LoginLink`는 layout의 provider 안에서만 그려집니다. */
function renderLanding() {
  return render(<AuthTransitionProvider><LandingPage /></AuthTransitionProvider>);
}

/** 구조화 데이터입니다. 화면에 보이지 않아 `<script>` 태그에서 직접 읽습니다. */
function structuredData(): { "@graph": { "@type": string; [key: string]: unknown }[] } {
  const script = document.querySelector('script[type="application/ld+json"]');
  if (script === null) throw new Error("구조화 데이터를 찾지 못했습니다.");
  return JSON.parse(script.textContent ?? "");
}

describe("LandingPage", () => {
  it("Hero의 제목과 설명, 태그라인을 그린다", () => {
    renderLanding();
    const heading = screen.getByRole("heading", { level: 1 });
    for (const line of LANDING_COPY.hero.headline) expect(heading).toHaveTextContent(line);
    expect(screen.getByText(LANDING_COPY.hero.tagline)).toBeInTheDocument();
    for (const line of LANDING_COPY.hero.subtext) expect(screen.getByText(new RegExp(escape(line)))).toBeInTheDocument();
  });

  /**
   * 스펙이 "경쟁하는 CTA를 늘리지 말라"고 정했습니다. 로그인 진입점은 Hero와 마지막 둘이고 둘 다
   * 같은 로그인 라우트로 갑니다. 셋째가 생기면 여기서 드러납니다.
   */
  it("로그인 CTA는 Hero와 마지막 둘이고 둘 다 로그인 라우트로 간다", () => {
    renderLanding();
    const ctas = screen.getAllByRole("link", { name: LANDING_COPY.cta });
    expect(ctas).toHaveLength(2);
    for (const cta of ctas) expect(cta).toHaveAttribute("href", LOGIN_PATH);
  });

  it("사용 흐름 네 단계를 순서대로 그린다", () => {
    renderLanding();
    // 보이는 제목이 없는 섹션이라 landmark 이름으로 찾습니다. 이름이 빠지면 여기서 드러납니다.
    const section = screen.getByRole("region", { name: LANDING_COPY.steps.sectionLabel });
    const steps = within(section).getAllByRole("listitem");
    expect(steps).toHaveLength(LANDING_COPY.steps.items.length);
    steps.forEach((step, index) => {
      const expected = LANDING_COPY.steps.items[index];
      expect(step).toHaveTextContent(`0${index + 1}`);
      expect(step).toHaveTextContent(expected.label);
      expect(step).toHaveTextContent(expected.description);
    });
  });

  /**
   * 섹션 안으로 좁혀서 찾습니다. `INTERVIEW`는 이 표의 열 이름이면서 위 사용 흐름의 단계 이름이라,
   * 화면 전체에서 글자로 찾으면 어느 쪽을 잡았는지 알 수 없습니다.
   */
  it("CODE → CHAT → PAAR 세 열의 라벨과 질문과 설명을 그린다", () => {
    renderLanding();
    const heading = screen.getByRole("heading", { name: LANDING_COPY.coreModel.title });
    const section = heading.closest("section");
    if (section === null) throw new Error("핵심 제품 모델 섹션을 찾지 못했습니다.");
    for (const column of LANDING_COPY.coreModel.columns) {
      expect(within(section).getByText(column.label)).toBeInTheDocument();
      expect(within(section).getByText(column.question)).toBeInTheDocument();
      expect(within(section).getByText(column.description)).toBeInTheDocument();
    }
  });

  /**
   * 태그와 값을 `dt`/`dd`로 묶습니다. `CODE`는 이 목록에도 있고 위 `CODE → CHAT → PAAR` 표기에도
   * 있어, 글자로만 찾으면 어느 쪽을 잡았는지 알 수 없습니다.
   */
  it("근거 종류 네 가지를 예시와 짝지어 그린다", () => {
    renderLanding();
    const tags = screen.getAllByRole("term");
    const values = screen.getAllByRole("definition");
    expect(tags.map((tag) => tag.textContent)).toEqual(LANDING_COPY.evidence.samples.map((sample) => sample.tag));
    LANDING_COPY.evidence.samples.forEach((sample, index) => {
      expect(values[index]).toHaveTextContent(sample.value);
      expect(values[index]).toHaveTextContent(sample.sub);
    });
    expect(screen.getByText(LANDING_COPY.evidence.subtext)).toBeInTheDocument();
  });

  /**
   * 미리보기는 인터뷰 워크스페이스를 DOM으로 다시 그린 그림입니다. 안쪽 예시 대화를 보조기술이
   * 읽으면 실제 인터뷰 내용으로 오해합니다. 한 장의 그림으로 보여야 합니다.
   */
  it("제품 미리보기는 한 장의 그림으로 노출하고 안쪽 예시는 읽히지 않는다", () => {
    renderLanding();
    expect(screen.getByRole("img", { name: LANDING_COPY.preview.alt })).toBeInTheDocument();
    const sampleAnswer = LANDING_COPY.preview.chat.messages[1].text;
    expect(screen.queryByText(sampleAnswer)).toBeInTheDocument();
    // 그림 안쪽은 `aria-hidden`이라 접근성 트리에 없습니다. 이름으로는 찾히지 않아야 합니다.
    expect(screen.queryByRole("button", { name: LANDING_COPY.preview.chat.composerSubmit })).not.toBeInTheDocument();
  });

  /**
   * 동의 문장을 조각으로 나눠 링크를 넣었습니다(이슈 #141). 나눈 조각이 원래 문장을 그대로 이루는지
   * 화면에서 읽은 글자로 확인합니다. `copy/auth.ts`에서 조각과 `terms`가 어긋나면 여기서 드러납니다.
   */
  it("약관 동의 문장의 `이용약관`만 링크이고 문장 전체는 그대로다", () => {
    renderLanding();
    const link = screen.getByRole("link", { name: LOGIN_COPY.termsSentence.link });
    const paragraph = link.closest("p");
    expect(paragraph).toHaveTextContent(LOGIN_COPY.terms);
    expect(link).toHaveAttribute("href", "/terms");
  });

  /**
   * 처리방침은 동의 대상이 아니라 이 화면이 링크를 갖지 않습니다. 작성지침 Part 02가 처리방침은
   * 동의를 얻어야 하는 문서가 아니라고 밝히고 있습니다. 링크는 이 화면 아래의 푸터에 있습니다.
   */
  it("처리방침 링크를 동의 문장에 넣지 않는다", () => {
    renderLanding();
    expect(screen.queryByRole("link", { name: LEGAL_LINK_COPY.privacy })).not.toBeInTheDocument();
  });
});

describe("LandingPage 구조화 데이터", () => {
  it("WebSite와 SoftwareApplication을 기준 도메인으로 내보낸다", () => {
    renderLanding();
    const graph = structuredData()["@graph"];
    expect(graph.map((entry) => entry["@type"])).toEqual(["WebSite", "SoftwareApplication"]);
    for (const entry of graph) {
      // canonical과 `og:url`은 끝의 `/`가 떨어진 모양으로 나갑니다. 같은 화면을 세 값이 같게 가리켜야 합니다.
      expect(entry.url).toBe(SITE_URL);
      expect(entry.description).toBe(DOCUMENT_COPY.description);
      expect(entry.inLanguage).toBe("ko-KR");
    }
  });

  /** 정해진 과금 정책이 없습니다. Hero에서 `무료 · 카드 등록 불필요`를 뺀 것과 같은 이유입니다. */
  it("가격 정보를 담지 않는다", () => {
    renderLanding();
    for (const entry of structuredData()["@graph"]) expect(entry).not.toHaveProperty("offers");
  });

  /** 값에 `<`가 섞이면 `</script>`로 태그가 먼저 닫혀 뒤쪽이 마크업으로 읽힙니다. */
  it("`<`를 이스케이프해서 script 태그가 먼저 닫히지 않는다", () => {
    renderLanding();
    const script = document.querySelector('script[type="application/ld+json"]');
    expect(script?.innerHTML).not.toContain("<");
  });
});

/** 정규식 특수문자가 든 문구를 그대로 찾기 위한 이스케이프입니다. */
function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

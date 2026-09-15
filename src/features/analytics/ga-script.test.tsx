import { isValidElement, type ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { GoogleAnalyticsScript } from "./ga-script";

/**
 * 렌더하지 않고 돌려준 엘리먼트 트리만 봅니다. `next/script`는 Next.js 런타임 위에서 동작하므로
 * jsdom에서 실제로 그리면 확인하려는 것(측정 ID가 없을 때 아무것도 내보내지 않는다)과 상관없는
 * 이유로 깨질 수 있습니다.
 */
function childrenOf(element: ReactElement | null): ReactElement[] {
  if (!element) return [];
  const children = (element.props as { children?: unknown }).children;
  return (Array.isArray(children) ? children : [children]).filter((child): child is ReactElement =>
    isValidElement(child)
  );
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
});

describe("GoogleAnalyticsScript", () => {
  /**
   * 이슈 #125의 Definition of Done입니다. 측정 ID 없이 빌드하고 실행했을 때 네트워크 요청이
   * 발생하지 않아야 하고, 이 분기가 그것을 보장합니다.
   */
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["whitespace only", "   "],
    ["malformed", "G-ABC</script>"],
  ])("renders nothing when the measurement id is %s", (_label, value) => {
    if (value !== undefined) process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = value;
    expect(GoogleAnalyticsScript()).toBeNull();
  });

  it("loads the library and bootstraps gtag with the measurement id", () => {
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID = "G-ABC123XYZ";
    const children = childrenOf(GoogleAnalyticsScript());

    const bootstrap = children.find((child) => child.type === "script");
    const html = (bootstrap?.props as { dangerouslySetInnerHTML?: { __html: string } })
      .dangerouslySetInnerHTML?.__html;
    expect(html).toContain("window.dataLayer");
    expect(html).toContain("gtag('config', 'G-ABC123XYZ')");

    const library = children.find((child) => child.type !== "script");
    expect((library?.props as { src?: string }).src).toBe(
      "https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"
    );
    // 부트스트랩이 hydration 전에 실행돼야 로그인 화면이 보내는 첫 이벤트를 놓치지 않습니다.
    expect((library?.props as { strategy?: string }).strategy).toBe("afterInteractive");
  });
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";

afterEach(cleanup);

describe("AppShell", () => {
  it("사이드바에 Repository 정보와 Change repository 액션, Interviews 빈 상태를 그리고 본문을 옆에 둔다", async () => {
    const onChangeRepository = vi.fn();
    render(
      <AppShell repository={{ owner: "shinhm1", name: "Kori_Front_MVP2", visibility: "private", language: "TypeScript" }} onChangeRepository={onChangeRepository}>
        <main>content</main>
      </AppShell>,
    );

    const sidebar = screen.getByRole("complementary", { name: "Workspace" });
    const repository = within(sidebar).getByRole("region", { name: "Repository" });
    expect(repository).toHaveTextContent("Kori_Front_MVP2");
    expect(repository).toHaveTextContent("shinhm1 / Kori_Front_MVP2");
    expect(repository).toHaveTextContent("PRIVATE · TypeScript");

    const interviews = within(sidebar).getByRole("region", { name: "Interviews" });
    expect(interviews).toHaveTextContent("No interviews yet. Select an experience candidate to begin.");

    fireEvent.click(within(sidebar).getByRole("button", { name: "← Change repository" }));
    expect(onChangeRepository).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("main")).toHaveTextContent("content");
  });

  it("공개 여부와 언어를 모르면 메타 줄을 그리지 않는다", () => {
    render(
      <AppShell repository={{ owner: "hm1n", name: "demian" }} onChangeRepository={() => undefined}>
        <div />
      </AppShell>,
    );
    const repository = screen.getByRole("region", { name: "Repository" });
    expect(within(repository).getAllByText(/demian/)).toHaveLength(2);
    expect(repository).not.toHaveTextContent("·");
  });
});

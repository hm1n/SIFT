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

  /**
   * 저장된 인터뷰 목록이 사이드바에 있고, 그 목록은 Repository를 고르기 전에도 골라 이어갈 수 있어야
   * 합니다(이슈 #115). 그래서 고른 Repository가 없어도 셸을 그립니다.
   */
  it("고른 Repository가 없으면 빈 자리를 알리고 Change repository를 그리지 않는다", () => {
    render(
      <AppShell repository={null}>
        <main>content</main>
      </AppShell>,
    );

    const repository = screen.getByRole("region", { name: "Repository" });
    expect(repository).toHaveTextContent("No repository selected");
    expect(screen.queryByRole("button", { name: "← Change repository" })).not.toBeInTheDocument();
  });

  it("Interviews 자리에 넘긴 내용을 빈 상태 문구 대신 그린다", () => {
    render(
      <AppShell repository={null} interviews={<p>저장된 인터뷰 목록</p>}>
        <div />
      </AppShell>,
    );

    const interviews = screen.getByRole("region", { name: "Interviews" });
    expect(interviews).toHaveTextContent("저장된 인터뷰 목록");
    expect(interviews).not.toHaveTextContent("No interviews yet");
  });

  it("새 경험 찾기를 누르면 알린다", () => {
    const onFindNewExperience = vi.fn();
    render(
      <AppShell repository={null} onFindNewExperience={onFindNewExperience}>
        <div />
      </AppShell>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Find new experience" }));
    expect(onFindNewExperience).toHaveBeenCalledTimes(1);
  });

  it("새 경험 찾기를 넘기지 않으면 그 버튼을 그리지 않는다", () => {
    render(
      <AppShell repository={null}>
        <div />
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: /Find new experience/ })).not.toBeInTheDocument();
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

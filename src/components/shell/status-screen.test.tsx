// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusScreen } from "./status-screen";

afterEach(cleanup);

describe("StatusScreen", () => {
  it("Loading은 status 역할로 조용히 알리고 기호와 코드를 함께 그린다", () => {
    render(<StatusScreen kind="loading" code="Analyzing" label="Reading commits" sub="This may take a moment." />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-status-kind", "loading");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("●");
    expect(region).toHaveTextContent("Analyzing");
    expect(screen.getByText("Reading commits")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("Empty는 status 역할이고 액션이 있으면 secondary 버튼으로 그린다", async () => {
    const onClick = vi.fn();
    render(
      <StatusScreen kind="empty" code="No candidates" label="Nothing to interview yet" sub="Try another repository." action={{ label: "Change repository", onClick }} />,
    );
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("data-status-kind", "empty");
    expect(region).toHaveTextContent("○");
    fireEvent.click(screen.getByRole("button", { name: "Change repository" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("Error는 alert 역할로 즉시 낭독하고 ✕ 기호를 붙인다", () => {
    render(<StatusScreen kind="error" code="Error 401" label="Session expired" sub="Log in again to continue." />);
    const region = screen.getByRole("alert");
    expect(region).toHaveAttribute("data-status-kind", "error");
    expect(region).not.toHaveAttribute("aria-live");
    expect(region).toHaveTextContent("✕");
    expect(region).toHaveTextContent("Error 401");
  });
});

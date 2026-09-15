// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewListItemPayload } from "./payload";
import { SavedInterviewList } from "./saved-interview-list";

afterEach(cleanup);

function item(overrides: Partial<InterviewListItemPayload> = {}): InterviewListItemPayload {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    repoOwner: "hm1n",
    repoName: "SIFT",
    title: "스트리밍 렌더링 최적화",
    status: "in_progress",
    completedBlockCount: 2,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    ...overrides,
  };
}

function renderList(
  state: Parameters<typeof SavedInterviewList>[0]["state"],
  handlers: Partial<{ onSelect: () => void; onDelete: () => void; onRetry: () => void }> = {},
  activeInterviewId: string | null = null
) {
  const props = {
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onRetry: vi.fn(),
    ...handlers,
  };
  render(<SavedInterviewList state={state} activeInterviewId={activeInterviewId} {...props} />);
  return props;
}

describe("SavedInterviewList", () => {
  it("저장된 인터뷰를 제목과 저장소와 진행도와 날짜로 그린다", () => {
    renderList({ status: "ready", interviews: [item()] });

    const row = screen.getByRole("button", { name: /^스트리밍 렌더링 최적화/ });
    expect(row).toHaveTextContent("hm1n / SIFT");
    expect(row).toHaveTextContent("PAAR 2/4");
    // 저장된 값은 ISO 문자열입니다. 사람이 읽는 형식으로 바꿔서 보입니다.
    expect(row).toHaveTextContent("Sep 12");
  });

  it("고르면 그 인터뷰를 알린다", () => {
    const { onSelect } = renderList({ status: "ready", interviews: [item()] });

    fireEvent.click(screen.getByRole("button", { name: /^스트리밍 렌더링 최적화/ }));

    expect(onSelect).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("지금 열려 있는 인터뷰를 표시한다", () => {
    renderList({ status: "ready", interviews: [item()] }, {}, "11111111-1111-4111-8111-111111111111");

    expect(screen.getByRole("button", { name: /^스트리밍 렌더링 최적화/ })).toHaveAttribute("aria-current", "true");
  });

  it("개수를 함께 보인다", () => {
    renderList({ status: "ready", interviews: [item(), item({ id: "b", title: "두 번째" })] });
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  /**
   * 되돌릴 수 없는 조작이라 한 번 더 묻습니다. 목록이 좁아 대화상자로 물으면 어느 인터뷰를 지우는지가
   * 화면에서 멀어지므로 그 행 자리에서 묻습니다(디자인 원본).
   */
  it("삭제는 그 행에서 확인을 받은 뒤에 알린다", () => {
    const { onDelete } = renderList({ status: "ready", interviews: [item()] });

    fireEvent.click(screen.getByRole("button", { name: "Delete interview: 스트리밍 렌더링 최적화" }));

    expect(screen.getByText("Delete this interview? This cannot be undone.")).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("확인을 취소하면 아무것도 지우지 않고 행으로 돌아온다", () => {
    const { onDelete } = renderList({ status: "ready", interviews: [item()] });
    fireEvent.click(screen.getByRole("button", { name: "Delete interview: 스트리밍 렌더링 최적화" }));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^스트리밍 렌더링 최적화/ })).toBeInTheDocument();
  });

  it("끝난 인터뷰와 진행 중인 인터뷰를 다른 기호로 그린다", () => {
    renderList({
      status: "ready",
      interviews: [item(), item({ id: "b", title: "끝난 것", status: "completed", completedBlockCount: 4 })],
    });

    const done = screen.getByRole("button", { name: /^끝난 것/ });
    expect(within(done).getByText("✓")).toBeInTheDocument();
    expect(within(screen.getByRole("button", { name: /^스트리밍/ })).getByText("●")).toBeInTheDocument();
  });

  it("저장된 인터뷰가 없으면 시작하는 방법을 알린다", () => {
    renderList({ status: "ready", interviews: [] });
    expect(screen.getByText("No interviews yet. Select an experience candidate to begin.")).toBeInTheDocument();
  });

  it("불러오는 중임을 알린다", () => {
    renderList({ status: "loading" });
    expect(screen.getByText("Loading interviews...")).toBeInTheDocument();
  });

  it("실패하면 다시 시도할 수 있다", () => {
    const { onRetry } = renderList({ status: "error" });

    expect(screen.getByText("Couldn't load interviews.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

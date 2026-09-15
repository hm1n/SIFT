// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InterviewListItemPayload } from "./payload";
import { RETENTION_DAYS } from "./retention";
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
    // 기본값은 방금 연 것입니다. 기한이 가까운 경우는 그 테스트가 직접 넘깁니다.
    openedAt: new Date().toISOString(),
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

  describe("자동 삭제까지 남은 기간", () => {
    const DAY_MS = 86_400_000;
    const openedDaysAgo = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();

    it("기한이 가까운 행에만 D-n 배지를 붙인다", () => {
      renderList({
        status: "ready",
        interviews: [
          item({ id: "soon", title: "곧 지워짐", openedAt: openedDaysAgo(RETENTION_DAYS - 3) }),
          item({ id: "fresh", title: "여유 있음", openedAt: openedDaysAgo(1) }),
        ],
      });

      expect(screen.getByText("D-3")).toBeInTheDocument();
      expect(screen.queryByText(`D-${RETENTION_DAYS - 1}`)).not.toBeInTheDocument();
    });

    // 배지의 설명 문구도 같은 자리입니다(PR #130 리뷰).
    it("하루가 남으면 배지 설명을 단수형으로 적는다", () => {
      renderList({
        status: "ready",
        interviews: [item({ id: "soon", title: "곧 지워짐", openedAt: openedDaysAgo(RETENTION_DAYS - 1) })],
      });

      expect(screen.getByTitle("Automatically deleted in 1 day")).toBeInTheDocument();
    });

    /**
     * 정리 작업은 하루에 한 번 돌고 호출 시각도 한 시간 안에서 흔들립니다. 기한이 지난 줄이 잠시
     * 남는데, 그것을 눌러 열면 기준 시각이 갱신돼 다시 90일을 사는 인터뷰가 됩니다.
     */
    it("기한이 지난 인터뷰는 그리지 않고 개수에도 세지 않는다", () => {
      renderList({
        status: "ready",
        interviews: [
          item({ id: "expired", title: "기한이 지남", openedAt: openedDaysAgo(RETENTION_DAYS + 1) }),
          item({ id: "fresh", title: "남아 있음", openedAt: openedDaysAgo(1) }),
        ],
      });

      expect(screen.queryByText("기한이 지남")).not.toBeInTheDocument();
      expect(screen.getByText("남아 있음")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("전부 기한이 지났으면 비어 있는 것으로 안내한다", () => {
      renderList({
        status: "ready",
        interviews: [item({ openedAt: openedDaysAgo(RETENTION_DAYS + 5) })],
      });

      expect(screen.getByText("No interviews yet. Select an experience candidate to begin.")).toBeInTheDocument();
    });
  });
});

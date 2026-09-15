// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSavedInterviews } from "./use-saved-interviews";

afterEach(cleanup);

const ITEM = {
  id: "11111111-1111-4111-8111-111111111111",
  repoOwner: "hm1n",
  repoName: "SIFT",
  title: "스트리밍 렌더링 최적화",
  status: "in_progress",
  completedBlockCount: 2,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-12T09:00:00.000Z",
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function noContentResponse(): Response {
  return { ok: true, status: 204, json: async () => undefined } as unknown as Response;
}

describe("useSavedInterviews", () => {
  it("마운트하면 목록을 불러온다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { interviews: [ITEM] }));

    const { result } = renderHook(() => useSavedInterviews(fetchImpl));

    expect(result.current.state).toEqual({ status: "loading" });
    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", interviews: [ITEM] }));
  });

  it("조회에 실패하면 error로 두고 다시 시도하면 다시 부른다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: { kind: "storage_failed", message: "끊김" } }))
      .mockResolvedValueOnce(jsonResponse(200, { interviews: [ITEM] }));
    const { result } = renderHook(() => useSavedInterviews(fetchImpl));
    await waitFor(() => expect(result.current.state).toEqual({ status: "error" }));

    act(() => {
      result.current.reload();
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", interviews: [ITEM] }));
  });

  /**
   * 응답을 기다린 뒤에 지우면 누른 뒤에도 그 인터뷰가 목록에 남아 있어 한 번 더 누르게 됩니다.
   */
  it("지우면 화면에서 먼저 없애고 요청을 보낸다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { interviews: [ITEM] }))
      .mockResolvedValueOnce(noContentResponse());
    const { result } = renderHook(() => useSavedInterviews(fetchImpl));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready" }));

    act(() => {
      result.current.remove(ITEM.id);
    });

    expect(result.current.state).toEqual({ status: "ready", interviews: [] });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1][1].method).toBe("DELETE");
  });

  // 지워지지 않았는데 지워진 것처럼 보이면 사용자가 지웠다고 믿고 떠납니다.
  it("삭제에 실패하면 목록을 다시 조회해 남아 있는 그대로 보인다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { interviews: [ITEM] }))
      .mockResolvedValueOnce(jsonResponse(503, { error: { kind: "storage_failed", message: "끊김" } }))
      .mockResolvedValueOnce(jsonResponse(200, { interviews: [ITEM] }));
    const { result } = renderHook(() => useSavedInterviews(fetchImpl));
    await waitFor(() => expect(result.current.state).toMatchObject({ status: "ready" }));

    act(() => {
      result.current.remove(ITEM.id);
    });

    await waitFor(() => expect(result.current.state).toEqual({ status: "ready", interviews: [ITEM] }));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

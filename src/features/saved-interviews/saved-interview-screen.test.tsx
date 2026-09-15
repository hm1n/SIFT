// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { emptyExperienceBlockState, type Claim } from "@/features/experience-block/types";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import type { StoredInterviewPayload } from "./payload";
import { SavedInterviewScreen } from "./saved-interview-screen";

afterEach(cleanup);

const citedClaim: Claim = {
  id: "c1",
  block: "problem",
  text: "로그가 청크마다 전체를 다시 그렸다",
  sources: [{ source: "repository", commitSha: "abc1234def5678", filePath: "src/log.tsx" }],
  status: "active",
  turnId: "t1",
};

/** 저장 응답입니다. 실제 경로는 새 블록 버전만 돌려줍니다. */
function savedResponse(blockVersion: number): Response {
  return { ok: true, status: 200, json: async () => ({ blockVersion }) } as unknown as Response;
}

function errorResponse(status: number, kind: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { kind, message: "흉내 낸 오류" } }),
  } as unknown as Response;
}

function payload(overrides: Partial<StoredInterviewPayload> = {}): StoredInterviewPayload {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    analysisId: "22222222-2222-4222-8222-222222222222",
    candidateKey: "sha-b",
    repoOwner: "hm1n",
    repoName: "SIFT",
    title: "스트리밍 렌더링 최적화",
    status: "in_progress",
    completedBlockCount: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-12T09:00:00.000Z",
    evidence: evidenceSnapshotFixture(),
    history: [
      { role: "question", text: "문제 상황을 알려주세요" },
      { role: "answer", text: "화면이 비어 있었습니다." },
    ],
    blockState: {
      ...emptyExperienceBlockState(),
      version: 1,
      claims: [citedClaim],
      display: { ...emptyExperienceBlockState().display, problem: [{ text: "모델이 쓴 문장", claimIds: ["c1"] }] },
      evaluation: {
        ...emptyExperienceBlockState().evaluation,
        problem: { sufficient: true, askable: false, reason: "sufficient" },
        alternatives: { sufficient: false, askable: true, reason: "askable" },
      },
    },
    blockVersion: 1,
    progress: emptyInterviewProgress(),
    candidate: { sha: "sha-b", evidence: "커밋 31개에 걸친 렌더링 개선입니다.", technicalTopics: ["React", "SSE"] },
    ...overrides,
  };
}

describe("SavedInterviewScreen", () => {
  it("고른 경험과 저장소와 마지막으로 이어간 날짜를 보인다", () => {
    render(<SavedInterviewScreen interview={payload()} onResume={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1, name: "스트리밍 렌더링 최적화" })).toBeInTheDocument();
    expect(screen.getByText("hm1n / SIFT")).toBeInTheDocument();
    expect(screen.getAllByText(/9월 12일/)[0]).toBeInTheDocument();
  });

  /** 근거 스냅샷에는 없는 값입니다. 저장된 분석에서 그 후보 하나를 골라 함께 받아 그립니다. */
  it("저장된 분석의 선정 이유와 기술 토픽을 그린다", () => {
    render(<SavedInterviewScreen interview={payload()} onResume={vi.fn()} />);

    expect(screen.getByText("커밋 31개에 걸친 렌더링 개선입니다.")).toBeInTheDocument();
    const topics = screen.getByRole("region", { name: "Technical topics" });
    expect(within(topics).getByText("React")).toBeInTheDocument();
    expect(within(topics).getByText("SSE")).toBeInTheDocument();
  });

  // 분석을 함께 받지 못해도 이어가기 자체는 성립합니다. 없는 것을 있는 것처럼 그리지 않습니다.
  it("후보를 찾지 못한 인터뷰는 그 사실을 알린다", () => {
    render(<SavedInterviewScreen interview={payload({ candidate: null })} onResume={vi.fn()} />);

    expect(screen.getByText("이 인터뷰는 해당 후보의 분석 없이 저장되었습니다.")).toBeInTheDocument();
    expect(screen.getByText("이 인터뷰에는 기술 토픽이 함께 저장되지 않았습니다.")).toBeInTheDocument();
  });

  it("저장된 근거를 읽지 못하면 그 사실을 알린다", () => {
    render(<SavedInterviewScreen interview={payload({ evidence: { 이상한: "값" } })} onResume={vi.fn()} />);

    expect(screen.getByText("저장된 근거를 더 이상 읽을 수 없습니다.")).toBeInTheDocument();
  });

  /**
   * 겉보기에는 스냅샷인데 화면이 읽는 칸이 빠진 경우입니다. 예전 검사는 후보 sha와 대표 커밋이
   * 있는지만 봐서 이런 값을 통과시켰고, 커밋의 `files.length`에서 화면 전체가 멈췄습니다
   * (PR #127 리뷰).
   */
  it("근거의 칸이 빠져 있어도 화면이 깨지지 않고 안내로 바뀐다", () => {
    const snapshot = evidenceSnapshotFixture();
    render(
      <SavedInterviewScreen
        interview={payload({
          evidence: { ...snapshot, representativeCommit: { ...snapshot.representativeCommit, files: undefined } },
        })}
        onResume={vi.fn()}
      />
    );

    expect(screen.getByText("저장된 근거를 더 이상 읽을 수 없습니다.")).toBeInTheDocument();
  });

  it("저장된 블록 상태를 읽지 못하면 그 사실을 알린다", () => {
    render(<SavedInterviewScreen interview={payload({ blockState: { version: 1 } as never })} onResume={vi.fn()} />);

    expect(screen.getByText("저장된 PAAR 블록을 더 이상 읽을 수 없습니다.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: / 편집$/ })).not.toBeInTheDocument();
  });

  it("블록마다 어디까지 왔는지를 기호로 보인다", () => {
    render(<SavedInterviewScreen interview={payload()} onResume={vi.fn()} />);

    const paar = screen.getByRole("region", { name: "PAAR experience" });
    const symbols = within(paar).getAllByText(/[✓●○]/);
    // problem 충분, alternatives 진행 중, action·result 미확인입니다.
    expect(symbols.map((node) => node.textContent)).toEqual(["✓", "●", "○", "○"]);
    expect(within(paar).getByText("PAAR 1/4")).toBeInTheDocument();
  });

  it("이어가기를 누르면 알린다", () => {
    const onResume = vi.fn();
    render(<SavedInterviewScreen interview={payload()} onResume={onResume} />);

    fireEvent.click(screen.getByRole("button", { name: /인터뷰 계속하기/ }));

    expect(onResume).toHaveBeenCalledTimes(1);
  });

  // 끝난 인터뷰는 이어갈 것이 아니라 다시 보는 것입니다.
  it("끝난 인터뷰는 다시 보기로 들어간다", () => {
    render(<SavedInterviewScreen interview={payload({ status: "completed" })} onResume={vi.fn()} />);

    expect(screen.getByRole("button", { name: /인터뷰 다시 보기/ })).toBeInTheDocument();
  });
});

/**
 * 블록 편집입니다. 이슈 #91이 인터뷰 화면의 PAAR 패널에 만든 것을 #115에서 이 화면으로 옮겼습니다.
 * 저장된 인터뷰의 화면이라 고친 문장을 서버에 함께 보냅니다.
 */
describe("SavedInterviewScreen 블록 편집", () => {
  const completed = payload({ status: "completed" });

  it("저장된 블록 문장과 그 문장이 인용한 커밋을 그린다", () => {
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} />);

    const paar = screen.getByRole("region", { name: "PAAR experience" });
    expect(within(paar).getByText("모델이 쓴 문장")).toBeInTheDocument();
    expect(within(paar).getByText("abc1234")).toBeInTheDocument();
    expect(within(paar).getByText("src/log.tsx")).toBeInTheDocument();
  });

  // 진행 중인 인터뷰를 고쳐 두면 이어간 뒤 모델이 그 블록을 건드리는 순간 고친 문장이 사라집니다.
  it("진행 중인 인터뷰에는 편집을 열지 않는다", () => {
    render(<SavedInterviewScreen interview={payload()} onResume={vi.fn()} />);

    expect(screen.queryByRole("button", { name: / 편집$/ })).not.toBeInTheDocument();
  });

  it("끝난 인터뷰는 블록마다 편집을 연다", () => {
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} />);

    expect(screen.getAllByRole("button", { name: / 편집$/ })).toHaveLength(4);
  });

  it("고쳐 저장하면 문장만 서버로 보내고 저장소 인용을 잃는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(savedResponse(2));
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 고친 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText("사용자가 고친 문장")).toBeInTheDocument());
    // 고친 문장에 예전 주장이 따라오지 않도록 문장은 문자열로만 보냅니다(설계 8절).
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      blockEdit: { block: "problem", sentences: ["사용자가 고친 문장"], expectedBlockVersion: 1 },
    });
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(screen.queryByText("abc1234")).not.toBeInTheDocument();
    expect(screen.queryByText("src/log.tsx")).not.toBeInTheDocument();
  });

  it("고치기 전에 인용을 잃는다는 것을 알린다", () => {
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    expect(screen.getByText(/Repository 인용이 사라집니다/)).toBeInTheDocument();
  });

  it("이어서 고치면 저장된 뒤의 버전으로 보낸다", async () => {
    // 저장할 때마다 블록 버전이 오릅니다. 읽어 온 값을 계속 쓰면 두 번째 편집이 스스로 만든 버전과
    // 어긋나 충돌로 거절됩니다.
    const fetchImpl = vi.fn().mockResolvedValueOnce(savedResponse(2)).mockResolvedValueOnce(savedResponse(3));
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "첫 번째 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByText("첫 번째 편집")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Action 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "두 번째 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(screen.getByText("두 번째 편집")).toBeInTheDocument());

    expect(JSON.parse(fetchImpl.mock.calls[1][1].body).blockEdit).toEqual({
      block: "action",
      sentences: ["두 번째 편집"],
      expectedBlockVersion: 2,
    });
  });

  it("고친 블록에는 예전 충돌을 남기지 않는다", async () => {
    // 충돌은 모델이 낸 주장에 매여 있습니다. 사용자가 블록을 자기 문장으로 바꾸면 그 주장은 화면에
    // 없는데, 예전에는 충돌 안내만 남아 쓴 적 없는 문장에 대한 경고가 됐습니다(PR #121 리뷰 1라운드).
    const conflicted: Claim = { ...citedClaim, id: "c2", status: "conflicted" };
    const interview = payload({
      status: "completed",
      blockState: {
        ...completed.blockState,
        claims: [citedClaim, conflicted],
        conflicts: [{ claimId: "c2", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" }],
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(savedResponse(2));
    render(<SavedInterviewScreen interview={interview} onResume={vi.fn()} fetchImpl={fetchImpl} />);
    expect(screen.getByText("근거와 어긋납니다 · 확인이 필요합니다")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 고친 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText("사용자가 고친 문장")).toBeInTheDocument());
    expect(screen.queryByText("근거와 어긋납니다 · 확인이 필요합니다")).not.toBeInTheDocument();
    expect(screen.queryByText("커밋에는 그 변경이 없습니다")).not.toBeInTheDocument();
  });

  it("블록을 모두 지우면 빈 목록을 보내고 예전 충돌도 남기지 않는다", async () => {
    const conflicted: Claim = { ...citedClaim, id: "c2", status: "conflicted" };
    const interview = payload({
      status: "completed",
      blockState: {
        ...completed.blockState,
        claims: [citedClaim, conflicted],
        conflicts: [{ claimId: "c2", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" }],
      },
    });
    const fetchImpl = vi.fn().mockResolvedValue(savedResponse(2));
    render(<SavedInterviewScreen interview={interview} onResume={vi.fn()} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).blockEdit.sentences).toEqual([]);
    expect(screen.queryByText("근거와 어긋납니다 · 확인이 필요합니다")).not.toBeInTheDocument();
    expect(screen.queryByText("모델이 쓴 문장")).not.toBeInTheDocument();
  });

  it("문장 수 상한을 넘으면 저장을 막는다", () => {
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: Array.from({ length: BLOCK_MAX_STATEMENTS + 1 }, (_, i) => `문장 ${i}`).join("\n") },
    });

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${BLOCK_MAX_STATEMENTS}줄 이하로 써 주세요`))).toBeInTheDocument();
  });

  it("서버가 쓰는 바이트 상한을 넘으면 저장을 막는다", () => {
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "가".repeat(BLOCK_MAX_BYTES) } });

    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${BLOCK_MAX_BYTES.toLocaleString()}바이트를 넘었습니다`))).toBeInTheDocument();
  });

  // 저장되지 않은 문장을 저장된 것처럼 그리면 사용자가 고쳤다고 믿고 떠납니다.
  it("저장이 실패하면 고친 문장을 반영하지 않고 알린다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(503, "storage_failed"));
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "저장되지 않을 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText(/편집한 내용이 저장되지 않았습니다/)).toBeInTheDocument());
    expect(screen.getByText("모델이 쓴 문장")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("저장되지 않을 문장");
  });

  it("다른 곳에서 먼저 바뀌었으면 최신 내용을 다시 읽게 한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(409, "version_conflict"));
    const onLoadLatest = vi.fn();
    render(
      <SavedInterviewScreen
        interview={completed}
        onResume={vi.fn()}
        onLoadLatest={onLoadLatest}
        fetchImpl={fetchImpl}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "늦게 도착한 편집" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(screen.getByText(/다른 곳에서 이 인터뷰가 바뀌어/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "최신 내용 불러오기" }));
    expect(onLoadLatest).toHaveBeenCalledTimes(1);
  });

  it("취소하면 편집을 버리고 원래 문장으로 돌아간다", () => {
    const fetchImpl = vi.fn();
    render(<SavedInterviewScreen interview={completed} onResume={vi.fn()} fetchImpl={fetchImpl} />);

    fireEvent.click(screen.getByRole("button", { name: "Problem 편집" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "버릴 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(screen.getByText("모델이 쓴 문장")).toBeInTheDocument();
    expect(screen.queryByText("버릴 문장")).not.toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

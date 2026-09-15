// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import type { StoredInterviewPayload } from "./payload";
import { SavedInterviewScreen } from "./saved-interview-screen";

afterEach(cleanup);

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
    expect(screen.getAllByText(/Sep 12/)[0]).toBeInTheDocument();
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

    expect(screen.getByText("This interview was saved without the analysis for this candidate.")).toBeInTheDocument();
    expect(screen.getByText("No topics were saved with this interview.")).toBeInTheDocument();
  });

  it("저장된 근거를 읽지 못하면 그 사실을 알린다", () => {
    render(<SavedInterviewScreen interview={payload({ evidence: { 이상한: "값" } })} onResume={vi.fn()} />);

    expect(screen.getByText("The saved evidence can no longer be read.")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /Continue interview/ }));

    expect(onResume).toHaveBeenCalledTimes(1);
  });

  // 끝난 인터뷰는 이어갈 것이 아니라 다시 보는 것입니다.
  it("끝난 인터뷰는 다시 보기로 들어간다", () => {
    render(<SavedInterviewScreen interview={payload({ status: "completed" })} onResume={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Review interview/ })).toBeInTheDocument();
  });
});

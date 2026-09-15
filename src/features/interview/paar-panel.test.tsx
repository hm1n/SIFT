// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyExperienceBlockState,
  type BlockKind,
  type Claim,
  type DisplaySentence,
  type ExperienceBlockState,
} from "@/features/experience-block/types";
import type { UseExperienceInterviewState } from "@/features/experience-block/use-experience-interview";
import { PaarPanel } from "./paar-panel";

afterEach(cleanup);

function baseStream(overrides: Partial<UseExperienceInterviewState> = {}): UseExperienceInterviewState {
  return {
    messages: [],
    status: "idle",
    error: null,
    receivedSeq: 0,
    removedHistory: [],
    hasSnapshot: true,
    canSubmitAnswer: true,
    isLastQuestionTooLong: false,
    isEnded: false,
    start: vi.fn(),
    retry: vi.fn(),
    endInterview: vi.fn(),
    submitAnswer: vi.fn(() => true),
    blockState: emptyExperienceBlockState(),
    turnsUsed: 0,
    maxTurns: 10,
    isReadyToFinish: false,
    endReason: null,
    currentTarget: { targetBlock: "problem", targetElement: "a" },
    isBlockUpdating: false,
    updatingBlock: null,
    unreflectedTurnId: null,
    unreflectedBlocks: [],
    unreflectedReason: null,
    retryUnreflectedBlockUpdate: vi.fn(),
    saveStatus: null,
    unsavedTurnCount: 0,
    retrySave: vi.fn(),
    ...overrides,
  };
}

function stateWith(overrides: Partial<ExperienceBlockState>): ExperienceBlockState {
  return { ...emptyExperienceBlockState(), ...overrides };
}

function displayOf(block: BlockKind, sentences: readonly DisplaySentence[]) {
  return { ...emptyExperienceBlockState().display, [block]: sentences };
}

const citedClaim: Claim = {
  id: "c1",
  block: "problem",
  text: "로그가 청크마다 전체를 다시 그렸다",
  sources: [{ source: "repository", commitSha: "abc1234def5678", filePath: "src/log.tsx" }],
  status: "active",
  turnId: "t1",
};

/** 호출부를 하나로 두려고 남긴 하네스입니다. 이 패널은 더 이상 편집 상태를 받지 않습니다. */
function PanelHarness({ stream }: { stream: UseExperienceInterviewState }) {
  return <PaarPanel stream={stream} />;
}

describe("PaarPanel 블록 상태", () => {
  it("첫 질문 전에는 네 카드가 모두 시작 전이다", () => {
    render(<PanelHarness stream={baseStream()} />);

    expect(screen.getAllByText("시작 전")).toHaveLength(4);
    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
  });

  it("갱신 중인 블록의 카드만 수집 중이다", () => {
    render(
      <PanelHarness
        stream={baseStream({ isBlockUpdating: true, updatingBlock: "action" })}
      />
    );

    expect(screen.getByText("수집 중")).toBeInTheDocument();
    expect(screen.getAllByText("시작 전")).toHaveLength(3);
  });

  it("재처리로 다른 블록을 갱신하는 동안 현재 타깃 카드를 수집 중으로 그리지 않는다", () => {
    // 미반영 재처리는 예전 턴의 대상을 갱신하므로 `currentTarget`과 어긋납니다. 예전에는 화면이
    // `isBlockUpdating`과 `currentTarget`을 함께 보고 관계없는 카드를 수집 중으로 그렸습니다
    // (PR #121 리뷰 1라운드).
    render(
      <PanelHarness
        stream={baseStream({
          isBlockUpdating: true,
          updatingBlock: "problem",
          currentTarget: { targetBlock: "action", targetElement: "b" },
          unreflectedTurnId: "t1",
          unreflectedBlocks: ["problem"],
        })}
      />
    );

    const collecting = screen.getAllByText("수집 중");
    expect(collecting).toHaveLength(1);
    // PROBLEM 카드 하나만 수집 중이고 ACTION 카드는 아직 시작 전입니다.
    expect(collecting[0].closest("div")?.textContent).toContain("Problem");
  });

  it("갱신이 도는 동안에도 이미 있던 문장을 지우지 않는다", () => {
    // 설계 9절 "갱신 실패 시 이전 표시 내용을 유지하고". 수집 중이라고 비우면 사용자가 쌓인 것을
    // 보는 목적 자체가 매 턴 사라집니다.
    render(
      <PanelHarness
        stream={baseStream({
          isBlockUpdating: true,
          updatingBlock: "problem",
          blockState: stateWith({ display: displayOf("problem", [{ text: "이미 쌓인 문장", claimIds: [] }]) }),
        })}
      />
    );

    expect(screen.getByText("이미 쌓인 문장")).toBeInTheDocument();
  });

  it("인터뷰가 끝났는데 내용이 없으면 채워지지 않음으로 그린다", () => {
    render(<PanelHarness stream={baseStream({ isEnded: true, endReason: "user" })} />);

    expect(screen.getAllByText("미완료")).toHaveLength(4);
    expect(screen.getAllByText(/이 블록은 채우지 못한 채 인터뷰가 끝났습니다/)).toHaveLength(4);
  });

  it("평가가 비어 있어도 문장이 있으면 채워짐으로 그린다", () => {
    // 리듀서가 targetBlock·영향받은 블록의 평가 누락을 거절하지 않아 `evaluation`이 `null`로 남을 수
    // 있습니다(backlog 1번). `evaluation === null`을 시작 전의 근거로 쓰면 여기서 오표시됩니다.
    render(
      <PanelHarness
        stream={baseStream({
          blockState: stateWith({ display: displayOf("result", [{ text: "결과 문장", claimIds: [] }]) }),
        })}
      />
    );

    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("결과 문장")).toBeInTheDocument();
  });
});

describe("PaarPanel 출처와 충돌 표시", () => {
  it("저장소 근거가 없는 문장에는 아무 표시도 붙이지 않는다", () => {
    render(
      <PanelHarness
        stream={baseStream({
          blockState: stateWith({
            claims: [{ ...citedClaim, id: "c9", block: "result", sources: [{ source: "user" }] }],
            display: displayOf("result", [{ text: "직접 말한 수치", claimIds: ["c9"] }]),
          }),
        })}
      />
    );

    // 근거 목록이 있느냐 없느냐만으로 확인 여부를 구분합니다. 문장 자체는 그대로 보여 줍니다.
    expect(screen.getByText("직접 말한 수치")).toBeInTheDocument();
    expect(screen.queryByText(/not verified in the repository/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Your statement/)).not.toBeInTheDocument();
  });

  it("저장소 인용을 커밋과 파일로 보여 주고 검증 완료로 적지 않는다", () => {
    render(
      <PanelHarness
        stream={baseStream({
          blockState: stateWith({
            claims: [citedClaim],
            display: displayOf("problem", [{ text: "근거 있는 문장", claimIds: ["c1"] }]),
          }),
        })}
      />
    );

    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("src/log.tsx")).toBeInTheDocument();
    expect(screen.queryByText(/verified/i)).not.toBeInTheDocument();
  });

  it("충돌을 블록 문장 밖에 그리고 블록을 비우지 않는다", () => {
    const conflicted: Claim = { ...citedClaim, id: "c2", status: "conflicted" };
    render(
      <PanelHarness
        stream={baseStream({
          blockState: stateWith({
            claims: [citedClaim, conflicted],
            conflicts: [{ claimId: "c2", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" }],
            display: displayOf("problem", [{ text: "남아 있는 문장", claimIds: ["c1"] }]),
          }),
        })}
      />
    );

    const conflict = screen.getByText("근거와 어긋납니다 · 확인이 필요합니다");
    const sentence = screen.getByText("남아 있는 문장");
    expect(conflict).toBeInTheDocument();
    expect(screen.getByText("커밋에는 그 변경이 없습니다")).toBeInTheDocument();
    // 문장 안이 아니라 밖입니다(설계 8절).
    expect(sentence.parentElement?.contains(conflict)).toBe(false);
  });

  // 고친 블록의 충돌과 인용을 어떻게 다루는지는 편집이 있는 화면의 몫입니다.
  // `saved-interviews/saved-interview-screen.test.tsx`에 있습니다.
});

describe("PaarPanel 미반영 상태", () => {
  it("미반영 답변을 알리고 그 자리에서 다시 처리하게 한다", () => {
    const retry = vi.fn();
    render(
      <PanelHarness
        stream={baseStream({
          unreflectedTurnId: "t3",
          unreflectedBlocks: ["action"],
          retryUnreflectedBlockUpdate: retry,
        })}
      />
    );

    expect(screen.getByText(/마지막 답변이/)).toBeInTheDocument();
    expect(screen.getByText(/이 블록을 겨냥한 답변이/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("갱신이 도는 동안 다시 처리 버튼을 잠근다", () => {
    // 재처리는 미반영 턴 전체를 한 번에 다시 보냅니다. 연타하면 같은 턴이 큐에 여러 번 들어가
    // 이미 반영을 끝낸 뒤에도 같은 요청이 또 나갑니다(backlog 3번).
    const retry = vi.fn();
    render(
      <PanelHarness
        stream={baseStream({ unreflectedTurnId: "t3", isBlockUpdating: true, retryUnreflectedBlockUpdate: retry })}
      />
    );

    const button = screen.getByRole("button", { name: "다시 시도 중…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("PaarPanel 편집 없음", () => {
  const filled = stateWith({
    claims: [citedClaim],
    display: displayOf("problem", [{ text: "모델이 쓴 문장", claimIds: ["c1"] }]),
  });

  /*
   * 편집은 저장된 인터뷰의 요약 화면으로 옮겼습니다(이슈 #115). 예전에는 종료하는 순간 이 패널이
   * 카드 넷을 편집 가능한 모습으로 다시 그렸는데, 종료가 곧바로 요약 화면으로 넘어가는 조작이라
   * 그 모습이 한 프레임 번쩍이고 사라졌습니다.
   */
  it.each([
    ["진행 중", { blockState: filled }],
    ["종료 뒤", { blockState: filled, isEnded: true, endReason: "user" as const }],
  ])("%s에도 편집을 열지 않는다", (_label, overrides) => {
    render(<PanelHarness stream={baseStream(overrides)} />);

    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("모델이 쓴 문장")).toBeInTheDocument();
  });
});

describe("PaarPanel 종료 조작", () => {
  it("블록이 하나도 차지 않아도 인터뷰를 끝낼 수 있다", () => {
    // 디자인 원본은 네 블록이 다 차야 누를 수 있게 하지만, 이슈 #78이 사용자가 언제든 끝낼 수
    // 있도록 정했습니다. 잠금을 옮기면 그 계약이 깨집니다.
    const endInterview = vi.fn();
    render(<PanelHarness stream={baseStream({ endInterview })} />);

    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    expect(endInterview).toHaveBeenCalledTimes(1);
  });

  it("더 물을 질문이 없으면 완료 안내를 보이되 스스로 끝내지 않는다", () => {
    const endInterview = vi.fn();
    render(<PanelHarness stream={baseStream({ isReadyToFinish: true, endInterview })} />);

    expect(screen.getByText(/PAAR 블록을 모두 채웠습니다/)).toBeInTheDocument();
    expect(endInterview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "인터뷰 완료" })).toBeInTheDocument();
  });

  it("저장되지 않는 인터뷰의 종료 확인 문구는 블록을 고칠 수 없다고 알린다", () => {
    // 편집은 저장된 인터뷰의 요약 화면에만 있습니다(이슈 #115). 돌아갈 요약이 없는 인터뷰에
    // "나중에 고칠 수 있다"고 적으면 있지도 않은 조작을 약속하게 됩니다.
    render(<PanelHarness stream={baseStream()} />);

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    expect(screen.getByRole("group")).toHaveTextContent("나중에 고칠 수 없습니다");
  });

  it("저장되는 인터뷰의 종료 확인 문구는 목록에서 다시 열어 고칠 수 있다고 알린다", () => {
    render(<PaarPanel stream={baseStream()} isSaved />);

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    expect(screen.getByRole("group")).toHaveTextContent("거기서 다시 열어 PAAR 블록을 고칠 수 있습니다");
  });
});

describe("PaarPanel 낭독 경계", () => {
  it("블록 카드에 live region을 두지 않는다", () => {
    // 네 카드가 답변마다 함께 바뀝니다. 낭독 대상으로 삼으면 한 번 답할 때마다 네 블록이 통째로
    // 읽혀 대화 영역의 상태 문단과 새 메시지 안내를 덮습니다(이슈 #91 Constraint).
    const { container } = render(
      <PanelHarness
        stream={baseStream({
          unreflectedTurnId: "t3",
          unreflectedBlocks: ["problem"],
          blockState: stateWith({ display: displayOf("problem", [{ text: "문장", claimIds: [] }]) }),
        })}
      />
    );

    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(container.querySelectorAll("[role='alert']")).toHaveLength(0);
    expect(container.querySelectorAll("[role='status']")).toHaveLength(0);
  });
});

/**
 * 반영 실패의 이유 표시입니다. 2026-09-15에 `.env` 키 이름이 어긋나 블록 갱신이 매번 인증 실패로
 * 끝났는데, 화면이 "반영되지 않았습니다"만 적어 설정 문제라는 것이 드러나지 않았습니다. 저장이 이
 * 요청에 얹혀 가므로 그동안 대화도 함께 사라졌습니다.
 */
describe("PaarPanel 반영 실패 이유", () => {
  it("설정 문제는 서버가 고쳐야 한다고 적는다", () => {
    render(
      <PanelHarness
        stream={baseStream({ unreflectedTurnId: "t1", unreflectedReason: "llm_auth" })}
      />
    );

    expect(screen.getByText(/서버 설정 문제입니다/)).toBeInTheDocument();
  });

  it("모델 출력이 흔들린 경우와 설정 문제를 다른 문장으로 적는다", () => {
    render(
      <PanelHarness
        stream={baseStream({ unreflectedTurnId: "t1", unreflectedReason: "block_update_rejected" })}
      />
    );

    expect(screen.getByText(/AI가 보낸 내용을 확인할 수 없습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/서버 설정 문제입니다/)).not.toBeInTheDocument();
  });

  // 틀린 원인을 단정하는 것보다 원인을 말하지 않는 편이 낫습니다.
  it("모르는 이유에는 일반 문구를 적는다", () => {
    render(<PanelHarness stream={baseStream({ unreflectedTurnId: "t1", unreflectedReason: null })} />);

    expect(screen.getByText("마지막 답변을 반영하지 못했습니다.")).toBeInTheDocument();
  });

  // 반영 실패가 곧 저장 실패라는 사실을 안내가 말해야 합니다. 둘을 따로 읽으면 사용자는 대화가
  // 남아 있다고 믿습니다.
  it("저장도 되지 않았다고 함께 알린다", () => {
    render(<PanelHarness stream={baseStream({ unreflectedTurnId: "t1" })} />);

    expect(screen.getByText(/그래서 저장도 되지 않았습니다/)).toBeInTheDocument();
  });
});

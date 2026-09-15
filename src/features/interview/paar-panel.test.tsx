// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseBlockEdit, type BlockEdits } from "@/features/experience-block/block-edits";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
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

/** 편집 상태를 `InterviewScreen`과 같은 방식으로 들고 있는 하네스입니다. */
function PanelHarness({ stream }: { stream: UseExperienceInterviewState }) {
  const [edits, setEdits] = useState<BlockEdits>({});
  return (
    <PaarPanel
      stream={stream}
      edits={edits}
      onEditBlock={(block, sentences) => setEdits((current) => ({ ...current, [block]: sentences }))}
    />
  );
}

describe("PaarPanel 블록 상태", () => {
  it("첫 질문 전에는 네 카드가 모두 시작 전이다", () => {
    render(<PanelHarness stream={baseStream()} />);

    expect(screen.getAllByText("Not started")).toHaveLength(4);
    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
  });

  it("갱신 중인 블록의 카드만 수집 중이다", () => {
    render(
      <PanelHarness
        stream={baseStream({ isBlockUpdating: true, updatingBlock: "action" })}
      />
    );

    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(screen.getAllByText("Not started")).toHaveLength(3);
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

    const collecting = screen.getAllByText("Collecting");
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

    expect(screen.getAllByText("Not filled")).toHaveLength(4);
    expect(screen.getAllByText(/ended without anything to put here/)).toHaveLength(4);
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

    expect(screen.getByText("Filled")).toBeInTheDocument();
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

    const conflict = screen.getByText("Conflicts with the evidence · needs checking");
    const sentence = screen.getByText("남아 있는 문장");
    expect(conflict).toBeInTheDocument();
    expect(screen.getByText("커밋에는 그 변경이 없습니다")).toBeInTheDocument();
    // 문장 안이 아니라 밖입니다(설계 8절).
    expect(sentence.parentElement?.contains(conflict)).toBe(false);
  });

  it("고친 블록에는 예전 충돌을 남기지 않는다", () => {
    // 충돌은 모델이 낸 주장에 매여 있습니다. 사용자가 블록을 자기 문장으로 바꾸면 그 주장은 화면에
    // 없는데, 예전에는 충돌 안내만 남아 쓴 적 없는 문장에 대한 경고가 됐습니다(PR #121 리뷰 1라운드).
    const conflicted: Claim = { ...citedClaim, id: "c2", status: "conflicted" };
    render(
      <PanelHarness
        stream={baseStream({
          isEnded: true,
          endReason: "user",
          blockState: stateWith({
            claims: [citedClaim, conflicted],
            conflicts: [{ claimId: "c2", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" }],
            display: displayOf("problem", [{ text: "모델이 쓴 문장", claimIds: ["c1"] }]),
          }),
        })}
      />
    );
    expect(screen.getByText("Conflicts with the evidence · needs checking")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 고친 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("사용자가 고친 문장")).toBeInTheDocument();
    expect(screen.queryByText("Conflicts with the evidence · needs checking")).not.toBeInTheDocument();
    expect(screen.queryByText("커밋에는 그 변경이 없습니다")).not.toBeInTheDocument();
  });

  it("블록을 모두 지워도 예전 충돌을 남기지 않는다", () => {
    const conflicted: Claim = { ...citedClaim, id: "c2", status: "conflicted" };
    render(
      <PanelHarness
        stream={baseStream({
          isEnded: true,
          endReason: "user",
          blockState: stateWith({
            claims: [citedClaim, conflicted],
            conflicts: [{ claimId: "c2", observation: "커밋에는 그 변경이 없습니다", turnId: "t2" }],
            display: displayOf("problem", [{ text: "모델이 쓴 문장", claimIds: ["c1"] }]),
          }),
        })}
      />
    );

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.queryByText("Conflicts with the evidence · needs checking")).not.toBeInTheDocument();
  });
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

    expect(screen.getByText(/Your latest answer/)).toBeInTheDocument();
    expect(screen.getByText(/An answer aimed at this block/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
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

    const button = screen.getByRole("button", { name: "Retrying…" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(retry).not.toHaveBeenCalled();
  });
});

describe("PaarPanel 종료 후 편집", () => {
  const filled = stateWith({
    claims: [citedClaim],
    display: displayOf("problem", [{ text: "모델이 쓴 문장", claimIds: ["c1"] }]),
  });

  it("인터뷰가 진행되는 동안에는 편집을 열지 않는다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled })} />);

    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("종료한 뒤에만 편집을 연다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);

    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(4);
  });

  it("고치면 저장소 인용을 잃는다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);
    expect(screen.getByText("abc1234")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 고친 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("사용자가 고친 문장")).toBeInTheDocument();
    expect(screen.queryByText(/not verified in the repository/)).not.toBeInTheDocument();
    expect(screen.queryByText("abc1234")).not.toBeInTheDocument();
    expect(screen.queryByText("src/log.tsx")).not.toBeInTheDocument();
  });

  it("고치기 전에 인용을 잃는다는 것을 알린다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    expect(screen.getByText(/drops the repository citations/)).toBeInTheDocument();
  });

  it("문장 수 상한을 넘으면 저장을 막는다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: Array.from({ length: BLOCK_MAX_STATEMENTS + 1 }, (_, i) => `문장 ${i}`).join("\n") },
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${BLOCK_MAX_STATEMENTS} lines or fewer`))).toBeInTheDocument();
  });

  it("서버가 쓰는 바이트 상한을 넘으면 저장을 막는다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "가".repeat(BLOCK_MAX_BYTES) } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText(new RegExp(`${BLOCK_MAX_BYTES.toLocaleString()} byte limit`))).toBeInTheDocument();
  });

  it("종료 뒤 재처리가 성공해도 사용자 편집을 덮지 않는다", () => {
    // 설계 9절 "재처리가 종료 후 사용자 편집을 덮어쓰지 않습니다". 종료가 미반영 턴의 재처리를
    // 걸어 두므로 편집한 뒤에 블록 상태가 바뀌는 순서가 실제로 생깁니다.
    const stream = baseStream({ blockState: filled, isEnded: true, endReason: "user" });
    const { rerender } = render(<PanelHarness stream={stream} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "사용자가 고친 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    rerender(
      <PanelHarness
        stream={{
          ...stream,
          unreflectedTurnId: null,
          blockState: stateWith({
            version: 9,
            display: displayOf("problem", [{ text: "재처리가 낸 새 문장", claimIds: [] }]),
          }),
        }}
      />
    );

    expect(screen.getByText("사용자가 고친 문장")).toBeInTheDocument();
    expect(screen.queryByText("재처리가 낸 새 문장")).not.toBeInTheDocument();
  });

  it("취소하면 편집을 버리고 원래 문장으로 돌아간다", () => {
    render(<PanelHarness stream={baseStream({ blockState: filled, isEnded: true, endReason: "user" })} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "버릴 문장" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("모델이 쓴 문장")).toBeInTheDocument();
    expect(screen.queryByText("버릴 문장")).not.toBeInTheDocument();
  });
});

describe("PaarPanel 종료 조작", () => {
  it("블록이 하나도 차지 않아도 인터뷰를 끝낼 수 있다", () => {
    // 디자인 원본은 네 블록이 다 차야 누를 수 있게 하지만, 이슈 #78이 사용자가 언제든 끝낼 수
    // 있도록 정했습니다. 잠금을 옮기면 그 계약이 깨집니다.
    const endInterview = vi.fn();
    render(<PanelHarness stream={baseStream({ endInterview })} />);

    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "End interview" }));
    fireEvent.click(screen.getByRole("button", { name: "End the interview" }));
    expect(endInterview).toHaveBeenCalledTimes(1);
  });

  it("더 물을 질문이 없으면 완료 안내를 보이되 스스로 끝내지 않는다", () => {
    const endInterview = vi.fn();
    render(<PanelHarness stream={baseStream({ isReadyToFinish: true, endInterview })} />);

    expect(screen.getByText(/nothing left to ask/)).toBeInTheDocument();
    expect(endInterview).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "End interview" })).toBeInTheDocument();
  });

  it("종료 확인 문구가 블록 편집이 뒤에 열린다는 것을 알린다", () => {
    render(<PanelHarness stream={baseStream()} />);

    fireEvent.click(screen.getByRole("button", { name: "End interview" }));
    expect(screen.getByRole("group")).toHaveTextContent("edit the PAAR blocks afterwards");
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

describe("PaarPanel 편집 입력", () => {
  it("남은 바이트를 서버 기준으로 보여 준다", () => {
    render(<PanelHarness stream={baseStream({ isEnded: true, endReason: "user" })} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "문장" } });

    const remaining = BLOCK_MAX_BYTES - JSON.stringify(parseBlockEdit("문장")).length - 4;
    // 한글 한 글자가 UTF-8에서 3바이트라 직렬화 길이와 바이트 수가 다릅니다. 정확한 값 대신 화면이
    // 글자 수가 아닌 바이트를 쓰는지만 봅니다.
    expect(screen.getByText(/bytes left/)).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(`${remaining + 100} bytes left`))).not.toBeInTheDocument();
  });
});

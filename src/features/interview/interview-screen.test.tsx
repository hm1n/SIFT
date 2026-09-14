// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InterviewScreen } from "./interview-screen";
import { evidenceSnapshotFixture, FIXTURE_REPRESENTATIVE_SHA } from "./question-fixture";
import { createTestStream, type TestStreamScenario } from "./test-stream";

afterEach(cleanup);

/**
 * 스트림 응답만 갈아 끼웁니다. 화면은 실제 생성 경로와 같은 요청을 만들고, 응답 본문만 결정적인
 * 테스트 스트림에서 옵니다. `snapshot`을 넘기는 것과 무관하게 동작합니다.
 */
const testStreamFetch = (scenario: TestStreamScenario) =>
  vi.fn().mockImplementation(async () => ({
    ok: true,
    status: 200,
    body: createTestStream({ scenario, delayMs: 0 }),
  }) as unknown as Response);

const pendingFetch = () => vi.fn().mockReturnValue(new Promise<Response>(() => {}));

describe("InterviewScreen", () => {
  it("확정한 경험의 대표 커밋 제목을 화면 제목으로 쓴다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(
      screen.getByRole("heading", { name: "fix: done 이벤트의 마지막 seq 검증 추가" })
    ).toBeInTheDocument();
  });

  it("대표 커밋 제목이 없으면 SHA로 대신한다", () => {
    const snapshot = evidenceSnapshotFixture();
    render(
      <InterviewScreen
        snapshot={{
          ...snapshot,
          representativeCommit: { ...snapshot.representativeCommit, indexed: false, title: null },
        }}
        onBack={vi.fn()}
        fetchImpl={pendingFetch()}
      />
    );

    expect(screen.getByRole("heading", { name: "Representative commit aaaaaaa" })).toBeInTheDocument();
  });

  /*
    PR #65 리뷰 P1의 회귀 테스트입니다. `snapshot`을 넘기지 않으면 화면이 질문 생성 경로가 아니라
    테스트 스트림을 `GET`으로 받고, 그 고정 질문이 사용자가 고른 경험의 질문인 것처럼 근거 패널과
    나란히 표시됩니다. 어떤 저장소를 골라도 같은 질문이 나옵니다. 배선이 끊기면 이 두 테스트가
    깨집니다.
  */
  it("확정한 경험의 근거 스냅샷을 요청 본문에 실어 보낸다", () => {
    const fetchImpl = pendingFetch();
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={fetchImpl} />
    );

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/interview/stream");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ snapshot: evidenceSnapshotFixture() });
  });

  it("경험이 다르면 다른 스냅샷을 보낸다", () => {
    const otherSha = "c".repeat(40);
    const first = pendingFetch();
    const second = pendingFetch();

    const { unmount } = render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={first} />
    );
    unmount();
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture({ candidateSha: otherSha })}
        onBack={vi.fn()}
        fetchImpl={second}
      />
    );

    const sentSha = (call: RequestInit) => JSON.parse(String(call.body)).snapshot.candidateSha;
    expect(sentSha(first.mock.calls[0][1])).toBe(FIXTURE_REPRESENTATIVE_SHA);
    expect(sentSha(second.mock.calls[0][1])).toBe(otherSha);
  });

  it("첫 질문이 도착하기 전에는 준비 안내를 보여 준다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(screen.getByText("질문을 준비하고 있습니다.")).toBeInTheDocument();
  });

  it("도착한 질문을 표시한다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );

    expect(
      await screen.findByRole("heading", { name: /청크 경계를 세 조건으로 함께 닫은 이유/ })
    ).toBeInTheDocument();
    expect(await screen.findByText("질문이 모두 도착했습니다.")).toBeInTheDocument();
  });

  it("질문 생성 오류는 스트림 화면의 안내와 다시 시도를 그대로 쓴다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("error")}
      />
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/질문 생성 호출 한도에 걸렸습니다/);
    const retry = screen.getByRole("button", { name: "다시 시도" });
    expect(retry).toHaveAccessibleDescription(/잠시 뒤에 다시 시도해 주세요/);
  });

  it("코드 패널을 대화 왼쪽에, PAAR 패널을 오른쪽에 둔다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    const code = screen.getByRole("region", { name: "Code / Evidence" });
    const stream = screen.getByRole("region", { name: "AI 질문 스트리밍" });
    const paar = screen.getByRole("region", { name: "PAAR" });
    expect(code.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream.compareDocumentPosition(paar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // #98은 PAAR 자리와 빈 상태만 둡니다. 블록 내용은 #89~#91의 범위입니다.
  it("PAAR 패널은 0 OF 04 빈 상태만 둔다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
    expect(screen.getByText(/No PAAR block has been filled yet/)).toBeInTheDocument();
  });

  it("헤더 토글로 양옆 패널을 접고 편다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 질문 스트리밍" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PAAR 0/4" }));
    expect(screen.queryByRole("region", { name: "PAAR" })).not.toBeInTheDocument();
  });

  // 디자인 원본의 손잡이는 마우스 드래그만 받습니다. 키보드로도 폭을 바꿀 수 있어야 합니다.
  it("폭 조절 손잡이를 키보드로 움직일 수 있고 한계를 넘지 않는다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    const handle = screen.getByRole("separator", { name: "Resize the code panel" });
    expect(handle).toHaveAttribute("aria-valuenow", "300");

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle).toHaveAttribute("aria-valuenow", "316");

    for (let step = 0; step < 40; step += 1) fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(handle).toHaveAttribute("aria-valuenow", "200");
  });

  it("자라나는 질문을 낭독 대상으로 만들지 않는다", async () => {
    const { container } = render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );

    const message = await screen.findByRole("heading", { name: /청크 경계를 세 조건으로 함께 닫은 이유/ });
    // 질문이 놓이는 자리와 그 조상 어디에도 켜진 live region이 없어야 합니다. 있으면 스크린리더가
    // 프레임마다 자라나는 질문 전체를 다시 읽습니다.
    for (let node: HTMLElement | null = message; node !== null; node = node.parentElement) {
      const live = node.getAttribute("aria-live");
      expect(live === null || live === "off").toBe(true);
      if (node === container) break;
    }
  });

  it("후보 목록으로 돌아갈 때 대화가 사라진다고 알리고 확인을 받는다", () => {
    const onBack = vi.fn();
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={onBack} fetchImpl={pendingFetch()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "← Candidates" }));

    // 이 버튼이 대화의 유일본을 지우는 자리입니다. 확인을 지나쳐 바로 돌아가면 제출한 답변과 작성
    // 중인 답변이 함께 사라집니다.
    expect(onBack).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: /clears this conversation for good/ });
    expect(confirm).toHaveTextContent("clears this conversation for good");
    expect(confirm).toHaveTextContent("any answer you're still writing");

    fireEvent.click(screen.getByRole("button", { name: "Continue the interview" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: /clears this conversation for good/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← Candidates" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to candidates" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("첫 질문이 끝나면 답변 입력이 열리고 답변이 대화에 쌓인다", async () => {
    const fetchImpl = testStreamFetch("normal");
    render(<InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={fetchImpl} />);

    const input = await screen.findByLabelText("답변");
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "첫 답변" } });
    fireEvent.click(screen.getByRole("button", { name: "답변 보내기" }));

    expect(screen.getByRole("article", { name: "내 답변" })).toHaveTextContent("첫 답변");
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const body = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(body.history.at(-1)).toEqual({ role: "answer", text: "첫 답변" });
  });
});

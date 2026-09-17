// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { fitPanelWidths, InterviewScreen } from "./interview-screen";
import { DEFAULT_EXPERIENCE_BLOCK_UPDATE_URL } from "@/features/experience-block/use-experience-interview";
import { evidenceSnapshotFixture, FIXTURE_REPRESENTATIVE_SHA } from "./question-fixture";
import { createTestStream, type TestStreamScenario } from "./test-stream";

afterEach(cleanup);

const trackEvent = vi.fn();
vi.mock("@/features/analytics/events", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/features/analytics/events")>();
  return { ...original, trackEvent: (...args: unknown[]) => trackEvent(...args) };
});

afterEach(() => trackEvent.mockReset());

/** 이 화면이 답변마다 부르는 블록 갱신에 항상 성공 응답을 준비해 둡니다(이슈 #90). */
function defaultBlockUpdateResponse(): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ state: emptyExperienceBlockState(), affectedBlocks: [], targetResponse: "provided" }),
  } as unknown as Response;
}

/**
 * 스트림 응답만 갈아 끼웁니다. 화면은 실제 생성 경로와 같은 요청을 만들고, 응답 본문만 결정적인
 * 테스트 스트림에서 옵니다. `snapshot`을 넘기는 것과 무관하게 동작합니다. 블록 갱신 URL로 오는
 * 호출은 이 스트림 응답 대신 기본 성공 응답을 받습니다.
 */
const testStreamFetch = (scenario: TestStreamScenario) =>
  vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input) === DEFAULT_EXPERIENCE_BLOCK_UPDATE_URL) return defaultBlockUpdateResponse();
    return {
      ok: true,
      status: 200,
      body: createTestStream({ scenario, delayMs: 0 }),
    } as unknown as Response;
  });

const pendingFetch = () => vi.fn().mockReturnValue(new Promise<Response>(() => {}));

/**
 * jsdom에는 `ResizeObserver`가 없습니다. 워크스페이스 폭을 재는 훅이 이 전역을 쓰므로, 폭을 고정해
 * 돌려주는 최소 구현을 끼웁니다. `offsetWidth`는 jsdom에서 언제나 0이라 쓸 수 없습니다.
 */
function stubWorkspaceWidth(width: number) {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe() {
        this.callback(
          [{ contentRect: { width } } as ResizeObserverEntry],
          this as unknown as ResizeObserver
        );
      }
      unobserve() {}
      disconnect() {}
    }
  );
}

afterEach(() => vi.unstubAllGlobals());

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

    expect(screen.getByRole("heading", { name: "대표 커밋 aaaaaaa" })).toBeInTheDocument();
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
    // 첫 질문은 항상 problem.a를 겨냥합니다(이슈 #90 설계 6절).
    expect(JSON.parse(String(init.body))).toEqual({
      snapshot: evidenceSnapshotFixture(),
      targetBlock: "problem",
      targetElement: "a",
    });
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

    expect(screen.getByText("첫 질문을 준비하고 있습니다.")).toBeInTheDocument();
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
    expect(retry).toHaveAccessibleDescription(/잠시 후 다시 시도해 주세요/);
  });

  it("코드 패널을 대화 왼쪽에, PAAR 패널을 오른쪽에 둔다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    const code = screen.getByRole("region", { name: "Code / Evidence" });
    const stream = screen.getByRole("region", { name: "AI 질문" });
    const paar = screen.getByRole("region", { name: "PAAR" });
    expect(code.compareDocumentPosition(stream) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream.compareDocumentPosition(paar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // #98이 자리와 빈 상태만 두던 것을 #91이 블록 카드 넷으로 채웠습니다.
  it("PAAR 패널은 첫 질문 전에 카드 넷을 시작 전 상태로 그린다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
    for (const label of ["Problem", "Analyze", "Action", "Result"]) {
      expect(screen.getByRole("heading", { level: 4, name: label })).toBeInTheDocument();
    }
    expect(screen.getAllByText(/대화를 진행하면 AI가 이 블록을 채웁니다/)).toHaveLength(4);
  });

  // 개수는 헤더 토글과 패널 머리글 두 곳이 같은 값을 그려야 합니다. 리터럴로 두면 갈립니다.
  it("채워진 블록 수를 헤더 토글과 패널 머리글이 같이 그린다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(screen.getByRole("button", { name: "PAAR 0/4" })).toBeInTheDocument();
    expect(screen.getByText("/ 00 OF 04")).toBeInTheDocument();
  });

  // 종료 조작은 디자인 원본에서 PAAR 패널의 맨 아래 자리입니다. 스트림 훅이 화면 밖으로 나간 뒤에도
  // 오른쪽 열의 버튼이 가운데 열의 답변 입력을 닫는지 확인합니다.
  it("종료는 PAAR 패널 아래에서 하고 확인하면 답변 입력이 닫힌다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );

    const paar = screen.getByRole("region", { name: "PAAR" });
    expect(paar).toContainElement(screen.getByRole("button", { name: "인터뷰 완료" }));

    const input = await screen.findByLabelText("답변");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));
    fireEvent.click(screen.getByRole("button", { name: "인터뷰 완료" }));

    expect(screen.queryByLabelText("답변")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "인터뷰 완료" })).not.toBeInTheDocument();
  });

  it("헤더 토글로 양옆 패널을 접고 편다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.queryByRole("region", { name: "Code / Evidence" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "AI 질문" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "PAAR 0/4" }));
    expect(screen.queryByRole("region", { name: "PAAR" })).not.toBeInTheDocument();
    // 종료 조작이 이 패널 안에 있으므로 접으면 함께 사라집니다. 다시 펴야 끝낼 수 있습니다.
    expect(screen.queryByRole("button", { name: "인터뷰 완료" })).not.toBeInTheDocument();
  });

  // 디자인 원본의 손잡이는 마우스 드래그만 받습니다. 키보드로도 폭을 바꿀 수 있어야 합니다.
  it("폭 조절 손잡이를 키보드로 움직일 수 있고 한계를 넘지 않는다", () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    const handle = screen.getByRole("separator", { name: "코드 패널 폭 조절" });
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

  /**
   * 제출했는데 아직 저장되지 않은 답변도 이 버튼으로 사라집니다(PR #127 리뷰). 문구가 "쓰던 답변"만
   * 말하면 사용자는 보낸 답변은 모두 저장됐다고 읽습니다.
   */
  it("저장되지 않은 제출 답변이 있으면 확인 문구가 그 사실을 함께 알린다", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === DEFAULT_EXPERIENCE_BLOCK_UPDATE_URL) {
        return Response.json({ error: { kind: "storage_failed", message: "끊김" } }, { status: 503 });
      }
      return { ok: true, status: 200, body: createTestStream({ scenario: "normal", delayMs: 0 }) } as unknown as Response;
    });
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        interviewId="11111111-1111-4111-8111-111111111111"
        fetchImpl={fetchImpl}
      />
    );
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: "화면이 비어 있었습니다." } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await screen.findByText("마지막 답변이 저장되지 않았습니다.");

    fireEvent.click(screen.getByRole("button", { name: "← 뒤로" }));

    const confirm = screen.getByRole("group", { name: /저장된 대화와 PAAR 블록은 왼쪽 Interviews에 남습니다/ });
    expect(confirm).toHaveTextContent("이미 보낸 답변 1개가 아직 저장되지 않아 함께 사라집니다");
  });

  it("후보 목록으로 돌아갈 때 대화가 사라진다고 알리고 확인을 받는다", () => {
    const onBack = vi.fn();
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={onBack} fetchImpl={pendingFetch()} />
    );

    fireEvent.click(screen.getByRole("button", { name: "← 뒤로" }));

    // 이 버튼이 대화의 유일본을 지우는 자리입니다. 확인을 지나쳐 바로 돌아가면 제출한 답변과 작성
    // 중인 답변이 함께 사라집니다.
    expect(onBack).not.toHaveBeenCalled();
    const confirm = screen.getByRole("group", { name: /대화, 쓰던 답변, PAAR 블록이 모두 사라집니다/ });
    expect(confirm).toHaveTextContent("대화, 쓰던 답변, PAAR 블록이 모두 사라집니다");
    expect(confirm).toHaveTextContent("페이지를 새로 고쳐도 복구할 수 없습니다");

    fireEvent.click(screen.getByRole("button", { name: "인터뷰 계속하기" }));
    expect(onBack).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("group", { name: /대화, 쓰던 답변, PAAR 블록이 모두 사라집니다/ })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "← 뒤로" }));
    fireEvent.click(screen.getByRole("button", { name: "후보 목록으로" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  /*
    세 열의 최소 폭 합(200 + 280 + 220 + 손잡이 8)보다 좁으면 탭으로 바꿉니다. 판정 기준은 화면 폭이
    아니라 워크스페이스 폭입니다. 왼쪽 사이드바 폭만큼 어긋나기 때문입니다.
  */
  it("좁은 폭에서는 세 열 대신 탭으로 전환한다", () => {
    stubWorkspaceWidth(700);
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    const tabs = screen.getByRole("group", { name: "워크스페이스 보기" });
    expect(tabs).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "인터뷰" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("separator", { name: "코드 패널 폭 조절" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Code" }));
    expect(screen.getByRole("button", { name: "Code" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "인터뷰" })).toHaveAttribute("aria-pressed", "false");
  });

  it("넓은 폭에서는 탭 없이 세 열을 그린다", () => {
    stubWorkspaceWidth(1_200);
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    expect(screen.queryByRole("group", { name: "워크스페이스 보기" })).not.toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "코드 패널 폭 조절" })).toBeInTheDocument();
  });

  /*
    탭을 바꿔도 대화 열을 떼지 않습니다. 떼면 스트림이 끊기고 대화 이력이 사라집니다. 이슈 #98
    Constraint가 막는 지점입니다.
  */
  it("다른 탭으로 옮겨도 대화 열과 스트림을 그대로 둔다", async () => {
    stubWorkspaceWidth(700);
    const fetchImpl = testStreamFetch("normal");
    render(<InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={fetchImpl} />);

    const question = await screen.findByRole("heading", {
      name: /청크 경계를 세 조건으로 함께 닫은 이유/,
    });

    fireEvent.click(screen.getByRole("button", { name: "Code" }));

    expect(question).toBeInTheDocument();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("첫 질문이 끝나면 답변 입력이 열리고 답변이 대화에 쌓인다", async () => {
    const fetchImpl = testStreamFetch("normal");
    render(<InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={fetchImpl} />);

    const input = await screen.findByLabelText("답변");
    await waitFor(() => expect(input).toBeEnabled());

    fireEvent.change(input, { target: { value: "첫 답변" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    expect(screen.getByRole("article", { name: "You" })).toHaveTextContent("첫 답변");
    // 답변 제출 하나가 블록 갱신 호출 하나(이슈 #90)와 다음 질문 요청 하나를 만듭니다: 첫 질문,
    // 블록 갱신, 둘째 질문 요청 순서로 3회입니다.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
    const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(body.history.at(-1)).toEqual({ role: "answer", text: "첫 답변" });
  });
});

/*
 * jsdom에는 `ResizeObserver`가 없어 워크스페이스 폭이 0으로 남고, 화면 테스트로는 좁아진 컨테이너를
 * 재현할 수 없습니다. 폭 계산만 따로 확인합니다.
 *
 * 여기서 지키는 계약은 하나입니다. 세 열을 나란히 그리는 동안 대화 열이 `MIN_CHAT_WIDTH_PX`
 * 아래로 밀리지 않는 것입니다. 탭 모드 판정이 최소 폭 합(708px)인데 렌더가 기본 폭(300+280+8)을
 * 쓰던 탓에, 그 사이 구간에서 대화 열이 132px까지 좁아졌습니다(PR #120 리뷰).
 */
describe("fitPanelWidths", () => {
  const both = { code: true, paar: true };
  const chatWidth = (container: number, fitted: { code: number; paar: number }) =>
    container - fitted.code - fitted.paar - 4 * 2;

  it("세 열이 켜진 가장 좁은 구간에서도 대화 열의 최소 폭을 지킨다", () => {
    // 708px이 탭 모드 경계이므로 세 열을 나란히 그리는 가장 좁은 폭부터 훑습니다.
    for (let container = 708; container <= 900; container += 1) {
      const fitted = fitPanelWidths(container, { code: 300, paar: 280 }, both);

      expect(fitted.code).toBeGreaterThanOrEqual(200);
      expect(fitted.paar).toBeGreaterThanOrEqual(220);
      expect(chatWidth(container, fitted)).toBeGreaterThanOrEqual(280);
    }
  });

  it("여유가 있으면 손잡이가 낸 폭을 그대로 쓴다", () => {
    expect(fitPanelWidths(1400, { code: 420, paar: 300 }, both)).toEqual({ code: 420, paar: 300 });
  });

  it("아직 컨테이너를 재지 못했으면 그대로 둔다", () => {
    expect(fitPanelWidths(0, { code: 300, paar: 280 }, both)).toEqual({ code: 300, paar: 280 });
  });

  it("접은 패널은 폭 예산에서 빠진다", () => {
    // PAAR를 접으면 그 폭도 손잡이도 없으므로 코드 패널이 줄어들 이유가 없습니다.
    const fitted = fitPanelWidths(700, { code: 300, paar: 280 }, { code: true, paar: false });

    expect(fitted.code).toBe(300);
    expect(700 - fitted.code - 4).toBeGreaterThanOrEqual(280);
  });
});

/**
 * 새 분석에서 온 인터뷰와 저장된 인터뷰를 잇는 인터뷰가 모두 이 화면을 지납니다. 두 경로를 한
 * 자리에서 셀 수 있는 곳이 여기뿐이라 시작 이벤트가 이 화면에 붙습니다.
 */
describe("InterviewScreen 계측", () => {
  const RESTORED = {
    history: [
      { role: "question", text: "문제 상황을 알려주세요" },
      { role: "answer", text: "화면이 비어 있었습니다." },
    ],
    blockState: emptyExperienceBlockState(),
    progress: emptyInterviewProgress(),
  } as const;

  it("대화가 열리면 interview_started를 한 번 남긴다", async () => {
    render(
      <InterviewScreen snapshot={evidenceSnapshotFixture()} onBack={vi.fn()} fetchImpl={pendingFetch()} />
    );

    await waitFor(() => expect(trackEvent).toHaveBeenCalledWith({ name: "interview_started", turn: 0 }));
    expect(trackEvent.mock.calls.filter(([event]) => event.name === "interview_started")).toHaveLength(1);
  });

  /** 이어가기는 저장된 턴 수부터 셉니다. 0으로 보내면 중도 이탈이 몰린 턴이 앞으로 당겨집니다. */
  it("이어가기는 저장된 턴 수를 싣는다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        restore={{ ...RESTORED, status: "in_progress" }}
        fetchImpl={pendingFetch()}
      />
    );

    await waitFor(() => expect(trackEvent).toHaveBeenCalledWith({ name: "interview_started", turn: 1 }));
  });

  /**
   * 끝난 인터뷰를 다시 열면 이 화면이 읽기 전용으로 뜹니다. 세면 인터뷰 시작 수가 요약을 다시 열어
   * 본 횟수만큼 부풀어 중도 이탈률이 실제보다 낮게 보입니다.
   */
  it("끝난 인터뷰를 다시 열면 세지 않는다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        restore={{ ...RESTORED, status: "completed" }}
        fetchImpl={pendingFetch()}
      />
    );

    // 화면이 다 그려진 뒤에 봅니다. 마운트 직후에 보면 아직 보내지 않은 것과 구분되지 않습니다.
    expect(await screen.findByRole("region", { name: "PAAR" })).toBeInTheDocument();
    expect(trackEvent.mock.calls.map(([event]) => event.name)).not.toContain("interview_started");
  });
});

/**
 * 인터뷰 안쪽 4종입니다(이슈 #126). 배선 지점과 파라미터, 그리고 금지 값이 실리지 않는다는 것을
 * 함께 고정합니다.
 */
describe("InterviewScreen 턴 계측", () => {
  /** 이 테스트가 보내는 답변과, 테스트 스트림이 만드는 질문에 들어 있는 낱말입니다. */
  const ANSWER = "화면이 비어 있었습니다. 재시도 큐를 두고 순서를 지켰습니다.";

  function eventsNamed(name: string) {
    return trackEvent.mock.calls
      .map(([event]) => event as { name: string })
      .filter((event) => event.name === name);
  }

  it("질문의 첫 조각이 도착하면 그 질문이 겨냥한 블록과 함께 남긴다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );

    await screen.findByText("질문이 모두 도착했습니다.");
    // 첫 질문은 항상 problem.a를 겨냥합니다(이슈 #90 설계 6절).
    expect(trackEvent).toHaveBeenCalledWith({
      name: "question_shown",
      turn: 0,
      block: "problem",
      element: "a",
      ttft_ms: expect.any(Number),
    });
    // 조각마다 세면 질문 하나가 여러 건이 됩니다.
    expect(eventsNamed("question_shown")).toHaveLength(1);
  });

  it("답변을 제출하면 길이 버킷과 생각한 시간을 남기고 텍스트는 보내지 않는다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => expect(eventsNamed("answer_submitted")).toHaveLength(1));
    expect(trackEvent).toHaveBeenCalledWith({
      name: "answer_submitted",
      turn: 1,
      answer_length_bucket: "0-100",
      think_time_ms: expect.any(Number),
    });
  });

  /**
   * PR #139 리뷰 1라운드의 회귀 테스트입니다. 요청이 속한 턴을 옵션에서 읽으면 한 턴 뒤처집니다.
   * 호출부가 턴 수를 올린 직후 이 훅이 요청을 보내는데, 그 사이에 렌더가 끝나지 않아 옵션을 옮겨
   * 담는 effect가 아직 돌지 않습니다. 고치기 전에는 두 번째 질문도 턴 0으로 기록되었습니다.
   */
  it("두 번째 질문은 다음 턴 번호로 남긴다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    const shownTurns = () =>
      trackEvent.mock.calls
        .map(([event]) => event as { name: string; turn: number })
        .filter((event) => event.name === "question_shown")
        .map((event) => event.turn);

    await waitFor(() => expect(shownTurns()).toHaveLength(2));
    expect(shownTurns()).toEqual([0, 1]);
  });

  it("답변이 블록에 반영되면 그 블록과 반응을 남긴다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => expect(eventsNamed("block_progressed")).toHaveLength(1));
    // 기본 응답은 빈 블록 상태에 `targetResponse: "provided"`입니다. 평가가 없으면 싣지 않습니다.
    expect(trackEvent).toHaveBeenCalledWith({
      name: "block_progressed",
      block: "problem",
      element: "a",
      response: "provided",
    });
  });

  it("질문 스트림이 실패하면 오류 분류를 남긴다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("error")}
      />
    );

    await screen.findByRole("alert");
    await waitFor(() => expect(eventsNamed("interview_stream_failed")).toHaveLength(1));
  });

  /**
   * 사용자 답변 텍스트와 AI가 만든 질문 문장은 어떤 이벤트에도 실리지 않습니다(이슈 #126
   * Constraint). 길이 버킷과 블록 식별자만 보냅니다.
   */
  it("답변 텍스트와 질문 문장을 어떤 파라미터로도 보내지 않는다", async () => {
    render(
      <InterviewScreen
        snapshot={evidenceSnapshotFixture()}
        onBack={vi.fn()}
        fetchImpl={testStreamFetch("normal")}
      />
    );
    const answer = await screen.findByRole("textbox", { name: /답변/ });
    fireEvent.change(answer, { target: { value: ANSWER } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    await waitFor(() => expect(eventsNamed("answer_submitted")).toHaveLength(1));

    const sent = JSON.stringify(trackEvent.mock.calls);
    expect(sent).not.toContain("재시도 큐");
    expect(sent).not.toContain("청크 경계");
    // 근거 스냅샷의 커밋 SHA와 파일 경로도 금지 값입니다.
    expect(sent).not.toContain(FIXTURE_REPRESENTATIVE_SHA);
    expect(sent).not.toContain(".ts");
  });
});

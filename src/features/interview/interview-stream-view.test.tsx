// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES, INTERVIEW_HISTORY_MAX_ITEMS } from "./history";
import { InterviewStreamView } from "./interview-stream-view";
import { evidenceSnapshotFixture } from "./question-fixture";
import { encodeSseEvent } from "./sse";

afterEach(cleanup);

/** 테스트가 청크 도착 시점을 직접 정하려고 컨트롤러를 밖으로 꺼냅니다. */
function controllableResponse() {
  let controller: ReadableStreamDefaultController<Uint8Array>;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
    },
  });
  return {
    response: { ok: true, status: 200, body: stream } as unknown as Response,
    push(text: string) {
      controller.enqueue(encoder.encode(text));
    },
    close() {
      controller.close();
    },
  };
}

/** 프레임 배칭은 별도로 검증하므로 화면 테스트에서는 즉시 실행합니다. */
const renderOptions = {
  scheduleFrame: (callback: () => void) => {
    callback();
    return 0;
  },
  cancelFrame: () => {},
  sleep: async () => {},
};

function setScroll(container: HTMLElement, values: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(container, "scrollHeight", { value: values.scrollHeight, configurable: true });
  Object.defineProperty(container, "clientHeight", { value: values.clientHeight, configurable: true });
  container.scrollTop = values.scrollTop;
}

describe("InterviewStreamView", () => {
  it("첫 내용이 도착하기 전에는 준비 안내를 보여 준다", async () => {
    const fetchImpl = vi.fn().mockReturnValue(new Promise<Response>(() => {}));

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);

    expect(await screen.findByText("질문을 준비하고 있습니다.")).toBeInTheDocument();
  });

  it("도착한 순서대로 내용을 이어 붙여 표시한다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "청크 경계를 " }));
    source.push(encodeSseEvent({ type: "chunk", seq: 2, text: "세 조건으로 닫은 이유" }));
    source.push(encodeSseEvent({ type: "done", seq: 2 }));

    expect(await screen.findByText("청크 경계를 세 조건으로 닫은 이유")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("질문이 모두 도착했습니다.")).toBeInTheDocument());
  });

  it("위로 스크롤하면 자동 스크롤을 멈추고 새 메시지 도착을 안내한다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "첫 문장" }));
    await screen.findByText("첫 문장");

    const log = screen.getByRole("log");
    setScroll(log, { scrollHeight: 1_000, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(log);

    source.push(encodeSseEvent({ type: "chunk", seq: 2, text: " 둘째 문장" }));

    const button = await screen.findByRole("button", { name: "새 메시지 보기" });
    const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
    expect(description).toHaveTextContent("자동 스크롤을 멈춘 동안 새 내용이 도착했습니다.");
  });

  it("하단으로 돌아오면 안내를 지우고 자동 스크롤을 재개한다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "첫 문장" }));
    await screen.findByText("첫 문장");

    const log = screen.getByRole("log");
    setScroll(log, { scrollHeight: 1_000, clientHeight: 200, scrollTop: 0 });
    fireEvent.scroll(log);
    source.push(encodeSseEvent({ type: "chunk", seq: 2, text: " 둘째 문장" }));
    const button = await screen.findByRole("button", { name: "새 메시지 보기" });

    setScroll(log, { scrollHeight: 1_000, clientHeight: 200, scrollTop: 800 });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "새 메시지 보기" })).not.toBeInTheDocument()
    );
    expect(log.scrollTop).toBe(1_000);
  });

  it("전송 중 끊기면 이미 도착한 내용을 지우지 않고 다시 시도할 방법을 준다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} retryDelaysMs={[]} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "이미 도착한 내용" }));
    await screen.findByText("이미 도착한 내용");
    source.close();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문을 받는 도중 연결이 끊겼습니다.");
    expect(screen.getByText("이미 도착한 내용")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "다시 시도" });
    const description = document.getElementById(retry.getAttribute("aria-describedby") ?? "");
    expect(description).toHaveTextContent("다시 시도하면 받은 지점부터 이어받습니다.");
  });

  it("다시 시도 버튼은 받은 지점부터 이어받는 요청을 보낸다", async () => {
    const first = controllableResponse();
    const second = controllableResponse();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} retryDelaysMs={[]} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    first.push(encodeSseEvent({ type: "chunk", seq: 1, text: "앞부분" }));
    await screen.findByText("앞부분");
    first.close();
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    expect(fetchImpl.mock.calls[1][1].headers["Last-Event-ID"]).toBe("1");
  });

  it("연결을 시작하지 못하면 시작 실패로 안내한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, body: null } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문 스트리밍 연결을 시작하지 못했습니다.");
    expect(alert).toHaveTextContent("아직 받은 내용은 없습니다.");
  });

  it("서버가 보낸 분류에 맞는 안내를 보여 준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      body: null,
      json: () =>
        Promise.resolve({
          error: { kind: "llm_rate_limit", message: "질문 생성 호출 한도에 걸렸습니다." },
        }),
    } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문 생성 호출 한도에 걸렸습니다.");
    expect(alert).toHaveTextContent("잠시 뒤에 다시 시도해 주세요.");
    // 한도 초과에 네트워크 확인 안내가 나가면 안 됩니다.
    expect(alert).not.toHaveTextContent("네트워크 상태를 확인");
  });

  // 2026-09-01 실측: Gemini는 잘못된 파라미터도 400으로 돌려주므로 이 분류에 크기와 무관한 실패가
  // 들어옵니다. 근거 크기가 문제인 경우는 provider에 닿기 전 세 가드가 먼저 거절하므로, 이 안내가
  // 크기를 지목하면 원인과 반대되는 문장을 보여 주게 됩니다.
  it("provider가 요청을 거부한 실패에 크기 초과를 지목하지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: null,
      json: () =>
        Promise.resolve({
          error: { kind: "llm_request", message: "LLM이 요청을 거부했습니다." },
        }),
    } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문 생성 서비스가 요청을 받아들이지 않았습니다.");
    expect(alert).toHaveTextContent("다시 시도해도 같은 결과가 나옵니다.");
    expect(alert).not.toHaveTextContent("크기를 넘었");
  });

  /**
   * Gemini의 500 `INTERNAL`과 503 `UNAVAILABLE`(모델 과부하)이 `llm_failure`로 옵니다. 이 분류에
   * 문구가 없어서 "질문을 만드는 중에 오류가 발생했습니다"라는 기본 문구가 나갔습니다. 기다리면
   * 풀리는 실패이므로 잠시 뒤 재시도를 권해야 합니다.
   */
  it("일시적인 provider 장애에 잠시 뒤 재시도를 권한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: null,
      json: () =>
        Promise.resolve({
          error: {
            kind: "llm_failure",
            message: "질문 생성 서비스가 일시적으로 응답하지 못했습니다.",
          },
        }),
    } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문 생성 서비스가 응답하지 못했습니다.");
    expect(alert).toHaveTextContent("잠시 뒤에 다시 시도해 주세요.");
    expect(alert).not.toHaveTextContent("다시 시도해도 같은 결과가 나옵니다.");
  });

  it("자라나는 메시지가 아니라 상태와 새 메시지 안내를 낭독 대상으로 둔다", async () => {
    const { push, response } = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(response);

    render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    push(encodeSseEvent({ type: "chunk", seq: 1, text: "질문" }));
    await screen.findByText("질문");

    // 스트리밍 중에는 메시지 하나의 텍스트가 계속 자랍니다. 이 자리가 live region이면 스크린리더가
    // 커지는 질문 전체를 프레임마다 다시 읽습니다.
    expect(screen.getByRole("log")).toHaveAttribute("aria-live", "off");

    const liveRegions = document.querySelectorAll('[aria-live="polite"]');
    expect(liveRegions.length).toBe(2);
    // 안내 문단은 내용이 비어 있어도 남아 있어야 합니다. live region은 붙어 있는 동안의 변경만
    // 알리므로, 내용을 담은 채 새로 나타나면 낭독되지 않는 스크린리더가 있습니다.
    expect(screen.queryByRole("button", { name: "새 메시지 보기" })).not.toBeInTheDocument();
  });
});

describe("InterviewStreamView 실제 생성 경로", () => {
  const snapshot = evidenceSnapshotFixture();

  it("근거 스냅샷을 POST 본문으로 보낸다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ snapshot });
  });

  it("이어받을 수 없다고 안내하고 다시 시도는 처음부터 새로 만든다", async () => {
    const first = controllableResponse();
    const second = controllableResponse();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(first.response)
      .mockResolvedValueOnce(second.response);

    render(
      <InterviewStreamView
        fetchImpl={fetchImpl}
        snapshot={snapshot}
        retryDelaysMs={[]}
        {...renderOptions}
      />
    );
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    first.push(encodeSseEvent({ type: "chunk", seq: 1, text: "앞부분" }));
    await screen.findByText("앞부분");
    first.close();

    const retry = await screen.findByRole("button", { name: "다시 시도" });
    const description = document.getElementById(retry.getAttribute("aria-describedby") ?? "");
    expect(description).toHaveTextContent("처음부터 새로 만듭니다");
    expect(description).not.toHaveTextContent("받은 지점부터 이어받습니다");

    fireEvent.click(retry);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    // 이어받기 헤더를 보내면 서버가 거절합니다. 이미 표시된 앞부분도 지웁니다. 남겨 두면 새로 만든
    // 질문이 그 뒤에 붙어 한 메시지 안에서 서로 다른 질문이 이어집니다.
    expect(fetchImpl.mock.calls[1][1].headers["Last-Event-ID"]).toBeUndefined();
    await waitFor(() => expect(screen.queryByText("앞부분")).not.toBeInTheDocument());
  });

  it("청크 없이 끝난 스트림은 완료가 아니라 오류로 알린다", async () => {
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.push(encodeSseEvent({ type: "done", seq: 0 }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("질문을 만들지 못했습니다.");
    expect(alert).toHaveTextContent("질문 내용이 한 조각도 오지 않았습니다.");
    expect(screen.queryByText("질문이 모두 도착했습니다.")).not.toBeInTheDocument();
  });

  it("청크를 받은 뒤 생성 오류가 나면 다시 시도가 내용을 지운다고 알린다", async () => {
    // 이어받을 수 없는 경로에서 "이미 받은 내용은 그대로 두었습니다"를 읽고 다시 시도를 누르면
    // 읽던 질문이 사라집니다. 안내와 실제 동작이 어긋납니다.
    const source = controllableResponse();
    const fetchImpl = vi.fn().mockResolvedValue(source.response);

    render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    source.push(encodeSseEvent({ type: "chunk", seq: 1, text: "앞부분" }));
    await screen.findByText("앞부분");
    source.push(
      encodeSseEvent({
        type: "error",
        kind: "llm_rate_limit",
        message: "질문 생성 호출 한도에 걸렸습니다.",
      })
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("지금까지 받은 내용은 사라집니다");
    expect(alert).not.toHaveTextContent("이미 받은 내용은 그대로 두었습니다");
  });

  it("서버 설정 실패를 전송 실패로 뭉개지 않는다", async () => {
    // `server_error`가 아는 분류에 없으면 수신부가 전송 실패로 떨어뜨려 서버 설정 문제에
    // 네트워크 확인 안내가 나갑니다.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      body: null,
      json: () =>
        Promise.resolve({
          error: { kind: "server_error", message: "서버 설정 문제로 질문 생성을 시작하지 못했습니다." },
        }),
    } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("서버 설정에 문제가 있어 요청을 처리하지 못했습니다.");
    expect(alert).toHaveTextContent("다시 시도해도 같은 결과가 나옵니다.");
    expect(alert).not.toHaveTextContent("네트워크 상태를 확인");
  });

  it("같은 근거로는 풀리지 않는 실패에는 재시도를 권하지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      body: null,
      json: () =>
        Promise.resolve({ error: { kind: "llm_auth", message: "LLM 인증에 실패했습니다." } }),
    } as unknown as Response);

    render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("다시 시도해도 같은 결과가 나옵니다");
  });

  it("이력 상한 초과는 다시 시도가 아니라 종료와 새 인터뷰를 권한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 413,
      body: null,
      json: () =>
        Promise.resolve({
          error: { kind: "history_too_large", message: "대화 이력이 상한을 넘었습니다." },
        }),
    } as unknown as Response);

    render(
      <InterviewStreamView
        fetchImpl={fetchImpl}
        snapshot={evidenceSnapshotFixture()}
        retryDelaysMs={[]}
        {...renderOptions}
      />
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("대화 이력이 상한을 넘었습니다.");
    // 기다리면 풀리는 실패와 갈라 씁니다. 대화를 줄이는 조작이 없으므로 종료를 가리킵니다.
    expect(alert).toHaveTextContent("다시 시도해도 같은 결과가 나옵니다");
    expect(alert).toHaveTextContent("인터뷰를 종료하고");
    expect(alert).not.toHaveTextContent("잠시 뒤에 다시 시도해 주세요");
  });

  describe("답변 입력과 대화 누적", () => {
    const snapshot = evidenceSnapshotFixture();

    function completeQuestion(source: ReturnType<typeof controllableResponse>, text: string) {
      source.push(encodeSseEvent({ type: "chunk", seq: 1, text }));
      source.push(encodeSseEvent({ type: "done", seq: 1 }));
    }

    /** 첫 질문을 끝내고 답변 입력이 열린 화면을 만듭니다. */
    async function renderAfterFirstQuestion(
      responses: ReturnType<typeof controllableResponse>[],
      props: Partial<React.ComponentProps<typeof InterviewStreamView>> = {}
    ) {
      const fetchImpl = vi.fn();
      responses.forEach((response) => fetchImpl.mockResolvedValueOnce(response.response));
      render(
        <InterviewStreamView
          fetchImpl={fetchImpl}
          snapshot={snapshot}
          retryDelaysMs={[]}
          {...renderOptions}
          {...props}
        />
      );
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
      completeQuestion(responses[0], "첫 질문");
      const input = await screen.findByLabelText("답변");
      await waitFor(() => expect(input).toBeEnabled());
      return { fetchImpl, input, submit: screen.getByRole("button", { name: "답변 보내기" }) };
    }

    it("근거 스냅샷이 없으면 답변 입력을 두지 않는다", async () => {
      const source = controllableResponse();
      const fetchImpl = vi.fn().mockResolvedValue(source.response);
      render(<InterviewStreamView fetchImpl={fetchImpl} {...renderOptions} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
      completeQuestion(source, "고정 질문");
      await screen.findByText("고정 질문");

      expect(screen.queryByLabelText("답변")).not.toBeInTheDocument();
    });

    it("첫 질문이 도착하는 동안에는 입력이 잠기고 빈 답변은 보낼 수 없다", async () => {
      const first = controllableResponse();
      const fetchImpl = vi.fn().mockResolvedValueOnce(first.response);
      render(<InterviewStreamView fetchImpl={fetchImpl} snapshot={snapshot} {...renderOptions} />);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

      const input = screen.getByLabelText("답변");
      const submit = screen.getByRole("button", { name: "답변 보내기" });
      expect(input).toBeDisabled();
      expect(submit).toBeDisabled();

      completeQuestion(first, "첫 질문");
      await waitFor(() => expect(input).toBeEnabled());
      // 열렸지만 비어 있으면 아직 보낼 수 없습니다.
      expect(submit).toBeDisabled();
      fireEvent.change(input, { target: { value: "   " } });
      expect(submit).toBeDisabled();
      fireEvent.change(input, { target: { value: "답변" } });
      expect(submit).toBeEnabled();
    });

    it("답변을 보내면 대화에 답변이 남고 다음 질문이 그 아래에 쌓인다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second]);

      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);

      // 제출 즉시 대화에 들어가고 입력은 비워지며 생성 중에는 잠깁니다.
      const answer = screen.getByRole("article", { name: "내 답변" });
      expect(answer).toHaveTextContent("첫 답변");
      expect(input).toHaveValue("");
      expect(input).toBeDisabled();
      expect(submit).toBeDisabled();
      // Loading은 질문 영역 한 곳에서만 나옵니다.
      expect(screen.getByText("다음 질문을 준비하고 있습니다.")).toBeInTheDocument();
      expect(screen.queryByText("질문을 준비하고 있습니다.")).not.toBeInTheDocument();

      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expect(JSON.parse(fetchImpl.mock.calls[1][1].body)).toEqual({
        snapshot,
        history: [
          { role: "question", text: "첫 질문" },
          { role: "answer", text: "첫 답변" },
        ],
      });

      completeQuestion(second, "둘째 질문");
      await screen.findByText("둘째 질문");
      const articles = screen.getAllByRole("article");
      expect(articles.map((article) => article.getAttribute("aria-label"))).toEqual([
        "AI 질문",
        "내 답변",
        "AI 질문",
      ]);
      expect(screen.queryByText("다음 질문을 준비하고 있습니다.")).not.toBeInTheDocument();
      await waitFor(() => expect(input).toBeEnabled());
    });

    it("서버 상한과 같은 바이트 기준으로 긴 답변을 막고 이유를 알린다", async () => {
      const first = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first]);

      // 글자 수는 상한 안이지만 줄바꿈이 직렬화되면 두 배로 셉니다. 글자 수로 막으면 통과시켰을
      // 답변입니다.
      const tooLong = "a\n".repeat(INTERVIEW_HISTORY_ITEM_MAX_BYTES / 2);
      fireEvent.change(input, { target: { value: tooLong } });

      expect(submit).toBeDisabled();
      expect(input).toHaveAttribute("aria-invalid", "true");
      const hint = document.getElementById(input.getAttribute("aria-describedby") ?? "");
      expect(hint).toHaveTextContent("한 번에 보낼 수 있는 크기를 넘었습니다");
      expect(hint).toHaveTextContent("4,500바이트");
      fireEvent.submit(submit.closest("form")!);
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      fireEvent.change(input, { target: { value: "짧은 답변" } });
      expect(submit).toBeEnabled();
      expect(input).not.toHaveAttribute("aria-invalid");
    });

    it("다음 질문 생성이 실패해도 답변은 남고 다시 시도는 그 질문만 다시 만든다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const third = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second, third]);

      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      second.push(encodeSseEvent({ type: "chunk", seq: 1, text: "둘째 질문 앞부분" }));
      await screen.findByText("둘째 질문 앞부분");
      second.close();

      const retry = await screen.findByRole("button", { name: "다시 시도" });
      // 오류가 떠 있는 동안 답변은 남아 있고 입력은 잠깁니다. Error도 한 곳에서만 나옵니다.
      expect(screen.getByRole("article", { name: "내 답변" })).toHaveTextContent("첫 답변");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(input).toBeDisabled();

      fireEvent.click(retry);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
      expect(screen.queryByText("둘째 질문 앞부분")).not.toBeInTheDocument();
      expect(screen.getByText("첫 질문")).toBeInTheDocument();
      expect(screen.getByRole("article", { name: "내 답변" })).toHaveTextContent("첫 답변");
      expect(JSON.parse(fetchImpl.mock.calls[2][1].body).history).toHaveLength(2);

      completeQuestion(third, "둘째 질문 다시");
      await screen.findByText("둘째 질문 다시");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      await waitFor(() => expect(input).toBeEnabled());
    });

    it("상한을 넘는 질문에는 답변을 받지 않고 다시 시도로 그 질문만 새로 만든다고 알린다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const third = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second, third]);
      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      completeQuestion(second, "가".repeat(INTERVIEW_HISTORY_ITEM_MAX_BYTES / 3 + 10));

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("질문이 너무 길어 대화를 이어갈 수 없습니다.");
      expect(alert).toHaveTextContent("이 질문만 새로 만듭니다");
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(input).toBeDisabled();
      expect(screen.getByRole("article", { name: "내 답변" })).toHaveTextContent("첫 답변");

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(3));
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.getAllByRole("article")).toHaveLength(2);
      expect(JSON.parse(fetchImpl.mock.calls[2][1].body).history).toHaveLength(2);

      completeQuestion(third, "둘째 질문 다시");
      await screen.findByText("둘째 질문 다시");
      await waitFor(() => expect(input).toBeEnabled());
    });

    it("답변을 보내면 위로 올려 둔 상태여도 하단으로 내려간다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const { input, submit } = await renderAfterFirstQuestion([first, second]);
      const log = screen.getByRole("log");
      setScroll(log, { scrollHeight: 1_000, clientHeight: 200, scrollTop: 0 });
      fireEvent.scroll(log);

      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);

      expect(log.scrollTop).toBe(1_000);
      expect(screen.queryByRole("button", { name: "새 메시지 보기" })).not.toBeInTheDocument();
    });

    it("위로 올려 읽는 중에 새 질문이 도착하면 자리를 빼앗지 않고 안내만 한다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second]);
      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));

      // 앞의 답변을 다시 읽으려고 위로 올립니다.
      const log = screen.getByRole("log");
      setScroll(log, { scrollHeight: 1_000, clientHeight: 200, scrollTop: 0 });
      fireEvent.scroll(log);

      second.push(encodeSseEvent({ type: "chunk", seq: 1, text: "둘째 질문" }));
      await screen.findByText("둘째 질문");

      expect(log.scrollTop).toBe(0);
      // 청크 반영과 안내 표시는 서로 다른 렌더에서 일어납니다. 동기로 잡으면 뒤 렌더를 기다리지
      // 못해 테스트가 간헐적으로 실패합니다.
      await screen.findByRole("button", { name: "새 메시지 보기" });
      expect(screen.getByText(/새 내용이 도착했습니다/)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "새 메시지 보기" }));
      expect(log.scrollTop).toBe(1_000);
      expect(screen.queryByRole("button", { name: "새 메시지 보기" })).not.toBeInTheDocument();
    });

    it("이력에서 앞부분이 빠지면 빠진 자리에 무엇이 빠졌는지 알린다", async () => {
      const sources: ReturnType<typeof controllableResponse>[] = [];
      const fetchImpl = vi.fn().mockImplementation(async () => {
        const source = controllableResponse();
        sources.push(source);
        return source.response;
      });
      render(
        <InterviewStreamView
          fetchImpl={fetchImpl}
          snapshot={snapshot}
          retryDelaysMs={[]}
          {...renderOptions}
        />
      );

      // 상한까지 채운 뒤 한 턴을 더 진행합니다. 그 턴의 요청에서 두 번째 쌍이 빠집니다.
      const turns = INTERVIEW_HISTORY_MAX_ITEMS / 2 + 1;
      const input = screen.getByLabelText("답변");
      for (let turn = 1; turn <= turns; turn += 1) {
        await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(turn));
        completeQuestion(sources[turn - 1], `질문 ${turn}`);
        await waitFor(() => expect(input).toBeEnabled());
        fireEvent.change(input, { target: { value: `답변 ${turn}` } });
        fireEvent.click(screen.getByRole("button", { name: "답변 보내기" }));
      }
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(turns + 1));
      expect(JSON.parse(fetchImpl.mock.calls[turns][1].body).history).toHaveLength(
        INTERVIEW_HISTORY_MAX_ITEMS
      );
      // 마지막 요청까지 완결시킵니다. 열린 스트림을 남기면 다음 테스트가 도는 동안 이 훅의 읽기가
      // 끝나면서 상태를 건드려 뒤 테스트가 간헐적으로 실패합니다.
      completeQuestion(sources[turns], `질문 ${turns + 1}`);
      await screen.findByText(`질문 ${turns + 1}`);

      const notice = screen.getByText(/다음 질문의 이력에서 빠졌습니다/);
      expect(notice).toHaveTextContent("질문과 답변 1쌍이");
      expect(notice).toHaveTextContent("AI는 더 이상 이 부분을 보지 못합니다");
      // 화면의 대화는 자르지 않습니다. 빠진 항목도 그대로 남아 있습니다.
      expect(screen.getByText("질문 2")).toBeInTheDocument();
      const articles = screen.getAllByRole("article");
      expect(articles).toHaveLength(turns * 2 + 1);
      // 안내는 빠진 구간이 시작되는 자리, 곧 첫 질문·답변 쌍 바로 뒤에 있습니다.
      expect(notice.previousElementSibling).toBe(articles[1]);
      // 절단은 오류가 아닙니다. 다시 시도를 권하지 않습니다.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
    });

    it("종료는 확인을 받고 확인하면 답변 입력을 닫는다", async () => {
      const first = controllableResponse();
      const { fetchImpl, input } = await renderAfterFirstQuestion([first]);
      fireEvent.change(input, { target: { value: "쓰다 만 답변" } });

      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료하기" }));

      // 확인 단계에서는 아직 아무것도 닫히지 않습니다. 사라지는 것을 모두 알립니다.
      const confirm = screen.getByRole("group");
      expect(confirm).toHaveTextContent("작성 중인 답변은 사라집니다");
      expect(confirm).toHaveTextContent("읽기 전용으로 남습니다");
      expect(confirm).toHaveTextContent("다시 이어갈 수 없습니다");
      expect(input).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: "계속하기" }));
      expect(screen.queryByRole("group")).not.toBeInTheDocument();
      expect(input).toHaveValue("쓰다 만 답변");

      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료하기" }));
      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료" }));

      // 대화는 남고 답변을 보낼 자리만 사라집니다. 다시 시작하는 조작도 두지 않습니다.
      expect(screen.getByText("첫 질문")).toBeInTheDocument();
      expect(screen.queryByLabelText("답변")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "답변 보내기" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "인터뷰 종료하기" })).not.toBeInTheDocument();
      expect(screen.getByText("인터뷰를 종료했습니다. 대화는 읽기 전용입니다.")).toBeInTheDocument();
      expect(screen.getByText(/후보 목록으로 돌아가면 이 대화는 사라지고/)).toBeInTheDocument();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("오류가 떠 있는 상태에서 종료하면 다시 시도가 사라진다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second]);
      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      second.push(encodeSseEvent({ type: "chunk", seq: 1, text: "둘째 질문 앞부분" }));
      await screen.findByText("둘째 질문 앞부분");
      second.close();
      await screen.findByRole("button", { name: "다시 시도" });

      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료하기" }));
      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료" }));

      // 다시 시도는 요청을 보내는 조작입니다. 종료한 뒤에 눌릴 자리를 남기지 않습니다.
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
      expect(screen.getByText("둘째 질문 앞부분")).toBeInTheDocument();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("질문이 도착하는 중에 종료하면 준비 안내와 진행 표시를 걷는다", async () => {
      const first = controllableResponse();
      const second = controllableResponse();
      const { fetchImpl, input, submit } = await renderAfterFirstQuestion([first, second]);
      fireEvent.change(input, { target: { value: "첫 답변" } });
      fireEvent.click(submit);
      // 연결 중이라 준비 안내가 떠 있습니다. 이 상태에서 종료합니다.
      expect(screen.getByText("다음 질문을 준비하고 있습니다.")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료하기" }));
      fireEvent.click(screen.getByRole("button", { name: "인터뷰 종료" }));

      expect(screen.queryByText("다음 질문을 준비하고 있습니다.")).not.toBeInTheDocument();
      expect(screen.getByRole("log")).toHaveAttribute("aria-busy", "false");
      expect(screen.getByRole("article", { name: "내 답변" })).toHaveTextContent("첫 답변");
      // 종료가 요청을 끊었으므로 새 요청이 더 나가지 않습니다.
      await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
      expect(screen.queryByLabelText("답변")).not.toBeInTheDocument();
    });
  });
});

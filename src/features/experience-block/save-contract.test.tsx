// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleExperienceBlockUpdate } from "@/app/api/interview/experience-block/route";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { encodeSseEvent } from "@/features/interview/sse";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import { useExperienceInterview } from "./use-experience-interview";

/**
 * 서버 SDK를 가립니다. 이 파일은 훅과 route를 한자리에서 돌리는 jsdom 테스트이고, route가
 * `@/lib/sentry/server`를 거쳐 `@sentry/nextjs`를 싣습니다. jsdom에서 서버 빌드를 로드하면
 * `@sentry/server-utils`의 번들러 플러그인이 `TypeError: The URL must be of scheme file`로 깨집니다.
 * 이 테스트가 보는 것은 저장 계약이라 실제 전송은 필요 없습니다.
 */
vi.mock("@sentry/nextjs", () => ({
  init: () => undefined,
  captureException: () => undefined,
  captureRequestError: () => undefined,
}));

/**
 * 훅이 만든 요청을 실제 route가 그대로 받아 저장까지 가는지 봅니다(이슈 #115).
 *
 * 양쪽 테스트가 각자 통과하는데 실제로는 저장되지 않는 일이 있었습니다. 훅 테스트는 응답을 흉내 낸
 * fetch를 쓰고 route 테스트는 손으로 쓴 본문을 쓰므로, 둘 사이의 계약이 어긋나도 어느 쪽도 실패하지
 * 않습니다. 이 테스트만 그 이음매를 지납니다. 흉내 내는 것은 모델 호출과 질문 스트림뿐입니다.
 */
afterEach(cleanup);

const QUESTION_URL = "/api/interview/stream";
const BLOCK_UPDATE_URL = "/api/interview/experience-block";
const OWNER_ID = 44727850;
const snapshot = evidenceSnapshotFixture();

/**
 * 모델은 부르지 않습니다. 주장을 만들지 않는 출력이라 블록 문장은 그대로지만 버전은 오릅니다.
 * 겨냥한 블록의 평가는 반드시 실어야 합니다(`applyBlockUpdate`가 없으면 거절합니다).
 */
function emptyOutput(targetBlock: string) {
  return {
    ops: [],
    display: [],
    evaluation: [{ block: targetBlock, sufficient: false, askable: true, reason: "askable" }],
    targetResponse: "provided",
  };
}

function questionStream(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(encodeSseEvent({ type: "chunk", seq: 1, text })));
      controller.enqueue(encoder.encode(encodeSseEvent({ type: "done", seq: 1 })));
      controller.close();
    },
  });
  return { ok: true, status: 200, body: stream } as unknown as Response;
}

/**
 * 블록 갱신 요청만 실제 route로 넘깁니다. 질문은 스트림 하나로 흉내 냅니다.
 *
 * `output`을 넘기면 모델 출력을 그것으로 바꿉니다. 검증을 통과하지 못하는 출력을 넣어 실패 경로도
 * 같은 이음매로 확인합니다.
 */
function routedFetch(store: SiftStore, output?: (targetBlock: string) => unknown): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url === QUESTION_URL) return questionStream("무엇을 해결하려고 했나요?");
    if (url !== BLOCK_UPDATE_URL) throw new Error(`unexpected url: ${url}`);
    const request = new NextRequest(`https://example.com${BLOCK_UPDATE_URL}`, {
      method: "POST",
      headers: {
        cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId: OWNER_ID })}`,
      },
      body: init?.body as string,
    });
    const targetBlock = (JSON.parse(String(init?.body)) as { targetBlock: string }).targetBlock;
    const generated = output ? output(targetBlock) : emptyOutput(targetBlock);
    return handleExperienceBlockUpdate(request, { generate: async () => generated as never, store });
  }) as typeof fetch;
}

async function seedInterview(store: SiftStore): Promise<string> {
  const analysisId = await store.saveAnalysis({
    githubUserId: OWNER_ID,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: [],
    candidates: {},
    stageASummary: {},
  });
  const interviewId = await store.createInterview({
    githubUserId: OWNER_ID,
    analysisId,
    candidateKey: snapshot.candidateSha,
    title: "스트리밍 렌더링 최적화",
    evidence: snapshot,
  });
  if (interviewId === null) throw new Error("seed failed");
  return interviewId;
}

beforeEach(() => {
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  delete process.env[GITHUB_SESSION_KEY_ENV];
});

describe("훅과 route 사이의 저장 계약", () => {
  it("답변 하나가 저장된 대화에 질문과 답변으로 들어간다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seedInterview(store);
    const { result } = renderHook(() =>
      useExperienceInterview({ snapshot, interviewId, fetchImpl: routedFetch(store) })
    );

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("로그가 청크마다 전체를 다시 그렸습니다.");
    });

    await waitFor(() => expect(result.current.saveStatus).toBe("saved"));
    const saved = await store.getInterview(interviewId, OWNER_ID);
    // 질문 본문은 흉내 낸 스트림이 만든 값이라 보지 않습니다. 저장된 것이 질문과 답변 한 쌍이고
    // 답변이 사용자가 쓴 그대로인지만 봅니다.
    expect(saved?.history).toHaveLength(2);
    expect(saved?.history[0].role).toBe("question");
    expect(saved?.history[1]).toEqual({
      role: "answer",
      text: "로그가 청크마다 전체를 다시 그렸습니다.",
    });
    expect(result.current.unsavedTurnCount).toBe(0);
  });

  /**
   * 반영이 실패하면 저장도 함께 실패합니다. 화면이 이유를 적을 수 있도록 route가 낸 분류가 그대로
   * 훅까지 올라와야 합니다(2026-09-15 `.env` 키 이름 사고).
   */
  it("블록 갱신이 거절되면 대화가 저장되지 않고 이유가 그대로 올라온다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seedInterview(store);
    const { result } = renderHook(() =>
      useExperienceInterview({
        snapshot,
        interviewId,
        // 겨냥한 블록의 평가가 빠진 출력입니다. route가 `block_update_rejected`로 거절합니다.
        fetchImpl: routedFetch(store, () => ({ ops: [], display: [], evaluation: [], targetResponse: "provided" })),
      })
    );

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("로그가 청크마다 전체를 다시 그렸습니다.");
    });

    await waitFor(() => expect(result.current.unreflectedReason).toBe("block_update_rejected"));
    expect(result.current.unsavedTurnCount).toBe(1);
    expect((await store.getInterview(interviewId, OWNER_ID))?.history).toEqual([]);
  });

  /**
   * 끝내기는 밀린 저장이 끝난 뒤에 완료를 표시해야 합니다(PR #127 리뷰).
   *
   * 완료 표시가 먼저 닿으면 흐름이 요약 화면으로 옮기면서 인터뷰 화면을 내리고, 언마운트가 진행 중이던
   * 저장을 끊습니다. 마지막 답변이 저장되지 않은 채 끝난 인터뷰가 되고 요약도 빠진 내용을 그립니다.
   */
  it("끝내면 밀린 턴을 저장한 뒤에 완료를 표시한다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seedInterview(store);
    // 첫 블록 갱신만 거절당합니다. 그 턴은 반영도 저장도 되지 않은 채 밀립니다.
    let rejectOnce = true;
    const fetchImpl = routedFetch(store, (targetBlock) => {
      if (rejectOnce) {
        rejectOnce = false;
        return { ops: [], display: [], evaluation: [], targetResponse: "provided" };
      }
      return emptyOutput(targetBlock);
    });
    let historyWhenCompleted: readonly { role: string; text: string }[] | null = null;
    const completeInterview = async () => {
      historyWhenCompleted = (await store.getInterview(interviewId, OWNER_ID))?.history ?? [];
    };
    const { result } = renderHook(() =>
      useExperienceInterview({ snapshot, interviewId, fetchImpl, completeInterview })
    );

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("재시도 큐를 붙였습니다.");
    });
    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(1));

    await act(async () => {
      result.current.endInterview();
    });

    await waitFor(() => expect(historyWhenCompleted).not.toBeNull());
    // 완료를 표시하는 시점에 그 턴이 이미 저장돼 있어야 합니다.
    expect(historyWhenCompleted).toHaveLength(2);
    expect((await store.getInterview(interviewId, OWNER_ID))?.status).toBe("in_progress");
  });

  /**
   * 모델이 계속 실패해도 대화는 남아야 합니다(이슈 #116, backlog 7번).
   *
   * `appendTurn`은 블록 버전이 올라야만 쓰므로, 블록 갱신이 매번 실패하는 인터뷰는 저장할 길 자체가
   * 없었습니다. 2026-09-15에 `.env` 키 이름이 어긋나 인터뷰 두 개의 대화가 한 줄도 저장되지 않은 사고가
   * 그 구조 때문이었습니다. 끝내는 시점에는 반영을 다시 걸 일이 없으므로 이력만 이어 붙입니다.
   */
  it("블록 갱신이 계속 실패해도 끝낼 때 대화는 저장된다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seedInterview(store);
    // 언제나 거절당하는 출력입니다. 그 턴은 반영도 저장도 되지 않은 채 밀립니다.
    const fetchImpl = routedFetch(store, () => ({
      ops: [],
      display: [],
      evaluation: [],
      targetResponse: "provided",
    }));
    const { result } = renderHook(() =>
      useExperienceInterview({ snapshot, interviewId, fetchImpl, completeInterview: async () => undefined })
    );

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("로그가 청크마다 전체를 다시 그렸습니다.");
    });
    await waitFor(() => expect(result.current.unreflectedReason).toBe("block_update_rejected"));
    // 인터뷰 중에는 저장하지 않습니다. 반영을 다시 걸 때 그 요청이 저장까지 함께 하기 때문입니다.
    expect((await store.getInterview(interviewId, OWNER_ID))?.history).toEqual([]);

    await act(async () => {
      result.current.endInterview();
    });

    await waitFor(async () =>
      expect((await store.getInterview(interviewId, OWNER_ID))?.history).toHaveLength(2)
    );
    const saved = await store.getInterview(interviewId, OWNER_ID);
    expect(saved?.history.map((message) => message.text)).toContain("로그가 청크마다 전체를 다시 그렸습니다.");
    // 블록에는 반영되지 않았으므로 블록 버전은 그대로입니다.
    expect(saved?.blockVersion).toBe(0);
    expect(result.current.unsavedTurnCount).toBe(0);
  });

  /**
   * 미반영 사유는 턴마다 따로 듭니다(PR #127 리뷰). 하나로 두면 화면이 가리키는 턴(가장 오래된
   * 것)과 이유(마지막에 실패한 것)가 어긋나고, 다른 턴 하나가 성공하면 남아 있는 턴의 이유까지
   * 사라집니다.
   */
  it("여러 턴이 밀리면 화면이 가리키는 턴의 이유를 보인다", async () => {
    const store = createInMemoryStore();
    const interviewId = await seedInterview(store);
    // 첫 답변은 모델 출력이 거절당하고, 두 번째 답변은 전송 자체가 끊깁니다.
    let call = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === QUESTION_URL) return questionStream("무엇을 해결하려고 했나요?");
      call += 1;
      if (call >= 2) throw new TypeError("Failed to fetch");
      return routedFetch(store, (targetBlock) => ({
        ops: [],
        display: [],
        evaluation: [],
        targetResponse: "provided",
        targetBlock,
      }))(input, init);
    }) as typeof fetch;
    const { result } = renderHook(() => useExperienceInterview({ snapshot, interviewId, fetchImpl }));

    await act(async () => {
      result.current.start();
    });
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("첫 답변입니다.");
    });
    await waitFor(() => expect(result.current.unreflectedReason).toBe("block_update_rejected"));
    await waitFor(() => expect(result.current.canSubmitAnswer).toBe(true));
    await act(async () => {
      result.current.submitAnswer("두 번째 답변입니다.");
    });

    // 두 번째 턴이 다른 이유로 실패해도, 화면이 가리키는 것은 먼저 실패한 첫 턴과 그 이유입니다.
    await waitFor(() => expect(result.current.unsavedTurnCount).toBe(2));
    expect(result.current.unreflectedReason).toBe("block_update_rejected");
  });
});

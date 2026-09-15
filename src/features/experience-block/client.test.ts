import { describe, expect, it, vi } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import { BlockUpdateFetchError, fetchBlockUpdate } from "./client";
import { emptyInterviewProgress } from "./progress";
import { emptyExperienceBlockState } from "./types";

const snapshot = evidenceSnapshotFixture();
const baseInput = {
  url: "/api/interview/experience-block",
  snapshot,
  history: [{ turnId: "t1", question: "질문", answer: "답변" }],
  state: emptyExperienceBlockState(),
  targetBlock: "problem" as const,
  targetElement: "a" as const,
  answerTurnId: "t1",
};

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe("fetchBlockUpdate", () => {
  it("성공 응답의 state·affectedBlocks·targetResponse·save를 그대로 돌려준다", async () => {
    const body = {
      state: emptyExperienceBlockState(),
      affectedBlocks: ["problem"],
      targetResponse: "provided",
      save: "saved",
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));

    const result = await fetchBlockUpdate({ ...baseInput, fetchImpl });

    expect(result).toEqual(body);
  });

  // 저장을 얹기 전에 배포된 서버는 이 값을 내지 않습니다. 없는 것을 저장된 것으로 보면 안 됩니다.
  it("응답에 save가 없으면 저장하지 않은 것으로 본다", async () => {
    const body = { state: emptyExperienceBlockState(), affectedBlocks: [], targetResponse: "provided" };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, body));

    expect((await fetchBlockUpdate({ ...baseInput, fetchImpl })).save).toBe("skipped");
  });

  it("저장 대상을 넘기면 요청 본문에 그대로 싣는다", async () => {
    const save = {
      interviewId: "11111111-1111-4111-8111-111111111111",
      expectedBlockVersion: 2,
      pendingTurnIds: ["t0"],
      progress: emptyInterviewProgress(),
      askedCountAtQuestion: 1,
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { state: emptyExperienceBlockState(), affectedBlocks: [], targetResponse: "provided", save: "saved" })
    );

    await fetchBlockUpdate({ ...baseInput, save, fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).save).toEqual(save);
  });

  /**
   * `save: undefined`는 JSON에서 사라지지만 `save: null`은 남습니다. 저장하지 않겠다는 뜻과 값을
   * 잘못 만든 것을 서버가 가를 수 없게 됩니다.
   */
  it("저장 대상이 없으면 본문에 save 키 자체를 넣지 않는다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { state: emptyExperienceBlockState(), affectedBlocks: [], targetResponse: "provided", save: "skipped" })
    );

    await fetchBlockUpdate({ ...baseInput, fetchImpl });

    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).not.toHaveProperty("save");
  });

  it("본문의 error.kind·message를 그대로 실어 BlockUpdateFetchError를 던진다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(422, { error: { kind: "block_update_rejected", message: "검증 실패" } }));

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({
      kind: "block_update_rejected",
      message: "검증 실패",
    });
  });

  // CodeRabbit PR #117: `{ error: null }`도 이전 구현은 유효한 오류 본문으로 판정해
  // `json.error.kind` 접근에서 TypeError가 났습니다. BlockUpdateFetchError로 정상 분류되어야 합니다.
  it("error 필드가 null이어도 TypeError 없이 server_error로 분류한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: null }));

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toBeInstanceOf(BlockUpdateFetchError);
    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({
      kind: "server_error",
      message: "블록 갱신에 실패했습니다.",
    });
  });

  it("오류 본문에 error 필드 자체가 없으면 server_error로 분류한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({ kind: "server_error" });
  });

  it("응답 JSON 파싱이 실패하면 network로 분류한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("본문이 JSON이 아닙니다.");
      },
    } as unknown as Response);

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({ kind: "network" });
  });

  it("fetch 자체가 실패하면 network로 분류한다", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("연결 실패"));

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({ kind: "network" });
  });

  it("AbortError는 그대로 다시 던진다", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(fetchBlockUpdate({ ...baseInput, fetchImpl })).rejects.toMatchObject({ name: "AbortError" });
  });
});

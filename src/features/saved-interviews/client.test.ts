import { describe, expect, it, vi } from "vitest";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import {
  createSavedInterview,
  deleteSavedInterview,
  fetchSavedInterview,
  fetchSavedInterviews,
  INTERVIEWS_PATH,
  SavedInterviewFetchError,
} from "./client";
import type { CreateInterviewRequestBody } from "./request";

const INTERVIEW_ID = "11111111-1111-4111-8111-111111111111";

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

/** 본문이 없는 응답입니다. 읽으려 하면 파싱에서 실패하므로 그 경로를 실제로 밟습니다. */
function noContentResponse(): Response {
  return {
    ok: true,
    status: 204,
    json: async () => {
      throw new SyntaxError("Unexpected end of JSON input");
    },
  } as unknown as Response;
}

const createBody: CreateInterviewRequestBody = {
  analysis: {
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: ["성능 개선"],
    candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
    stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
  },
  candidateKey: "c1",
  title: "스트리밍 렌더링 최적화",
  evidence: evidenceSnapshotFixture(),
};

describe("저장된 인터뷰 클라이언트", () => {
  it("확정할 때 만든 줄의 식별자 둘을 돌려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { interviewId: INTERVIEW_ID, analysisId: "a1" }));

    const result = await createSavedInterview(createBody, fetchImpl);

    expect(result).toEqual({ interviewId: INTERVIEW_ID, analysisId: "a1" });
    expect(fetchImpl.mock.calls[0][0]).toBe(INTERVIEWS_PATH);
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ candidateKey: "c1" });
  });

  it("목록을 배열로 돌려준다", async () => {
    const interviews = [{ id: INTERVIEW_ID, title: "제목", completedBlockCount: 2 }];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { interviews }));

    expect(await fetchSavedInterviews(fetchImpl)).toEqual(interviews);
  });

  it("복원은 인터뷰 하나를 돌려준다", async () => {
    const interview = { id: INTERVIEW_ID, history: [], blockVersion: 3 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { interview }));

    expect(await fetchSavedInterview(INTERVIEW_ID, fetchImpl)).toEqual(interview);
    expect(String(fetchImpl.mock.calls[0][0])).toBe(`${INTERVIEWS_PATH}/${INTERVIEW_ID}`);
  });

  // 204에는 본문이 없습니다. 읽으려 하면 성공한 삭제가 실패로 보고됩니다.
  it("삭제는 본문 없는 응답을 성공으로 본다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(noContentResponse());

    await expect(deleteSavedInterview(INTERVIEW_ID, fetchImpl)).resolves.toBeUndefined();
    expect(fetchImpl.mock.calls[0][1].method).toBe("DELETE");
  });

  it.each([
    ["없는 인터뷰", 404, "not_found"],
    ["로그인이 풀린 경우", 401, "unauthorized"],
    ["저장소가 끊긴 경우", 503, "storage_failed"],
  ])("%s의 오류 종류를 그대로 올린다", async (_label, status, kind) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: { kind, message: "실패" } }));

    await expect(fetchSavedInterview(INTERVIEW_ID, fetchImpl)).rejects.toMatchObject({ kind, message: "실패" });
  });

  it("오류 봉투가 없으면 server_error로 본다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { 이상한: "값" }));

    await expect(fetchSavedInterviews(fetchImpl)).rejects.toMatchObject({ kind: "server_error" });
  });

  it("전송 자체가 실패하면 network로 본다", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(fetchSavedInterviews(fetchImpl)).rejects.toMatchObject({ kind: "network" });
  });

  // 화면이 이탈하면 요청도 함께 끊깁니다. 끊긴 것을 실패로 바꾸면 떠난 화면에 오류 안내가 남습니다.
  it("끊긴 요청은 AbortError 그대로 올린다", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError"));

    await expect(fetchSavedInterviews(fetchImpl)).rejects.not.toBeInstanceOf(SavedInterviewFetchError);
  });

  it("배열이 아닌 목록 응답은 형식 오류로 본다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { interviews: "목록" }));

    await expect(fetchSavedInterviews(fetchImpl)).rejects.toMatchObject({ kind: "server_error" });
  });
});

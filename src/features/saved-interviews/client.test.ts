import { describe, expect, it, vi } from "vitest";
import { SAVED_INTERVIEW_REQUEST_COPY } from "@/copy/saved";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";
import {
  ANALYSES_PATH,
  createSavedInterview,
  deleteSavedInterview,
  fetchAnalysisByRepository,
  fetchSavedInterview,
  fetchSavedInterviews,
  fetchStoredAnalysis,
  INTERVIEWS_PATH,
  SavedInterviewFetchError,
  saveRepositoryAnalysis,
  saveSavedInterviewBlock,
} from "./client";
import type { CreateInterviewRequestBody } from "./request";
import type { StoredAnalysis } from "@/features/repository-analysis/analysis-snapshot";

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

const ANALYSIS_ID = "22222222-2222-4222-8222-222222222222";

const storedAnalysis = {
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: ["성능 개선"],
  candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
  stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
} as unknown as StoredAnalysis;

const createBody: CreateInterviewRequestBody = {
  analysisId: ANALYSIS_ID,
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

  /**
   * `fetch`가 던지는 message는 브라우저가 만든 영어 원문입니다. 이 값이 화면까지 가는 경로가
   * 있어(`repository-analysis-view.tsx`의 조회 실패 안내) 분류만 옮기고 문구는 바꿔 답니다.
   */
  it("전송 자체가 실패하면 network로 보고 원문 대신 화면 문구를 단다", async () => {
    const cause = new TypeError("Failed to fetch");
    const fetchImpl = vi.fn().mockRejectedValue(cause);

    await expect(fetchSavedInterviews(fetchImpl)).rejects.toMatchObject({
      kind: "network",
      message: SAVED_INTERVIEW_REQUEST_COPY.network,
      cause,
    });
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

  it("블록 편집을 PATCH로 보내고 저장된 뒤의 블록 버전을 돌려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { blockVersion: 4 }));

    const version = await saveSavedInterviewBlock(
      INTERVIEW_ID,
      { block: "problem", sentences: ["고친 문장"], expectedBlockVersion: 3 },
      fetchImpl
    );

    expect(version).toBe(4);
    expect(fetchImpl.mock.calls[0][0]).toBe(`${INTERVIEWS_PATH}/${INTERVIEW_ID}`);
    expect(fetchImpl.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      blockEdit: { block: "problem", sentences: ["고친 문장"], expectedBlockVersion: 3 },
    });
  });

  // 버전을 돌려받지 못하면 다음 편집이 어떤 버전으로 저장해야 하는지 알 수 없습니다.
  it("블록 버전이 없는 응답은 형식 오류로 본다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));

    await expect(
      saveSavedInterviewBlock(
        INTERVIEW_ID,
        { block: "problem", sentences: [], expectedBlockVersion: 3 },
        fetchImpl
      )
    ).rejects.toMatchObject({ kind: "server_error" });
  });

  it("다른 곳이 먼저 고쳤으면 version_conflict로 올린다", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(409, { error: { kind: "version_conflict", message: "충돌" } }));

    await expect(
      saveSavedInterviewBlock(
        INTERVIEW_ID,
        { block: "problem", sentences: ["고친 문장"], expectedBlockVersion: 3 },
        fetchImpl
      )
    ).rejects.toMatchObject({ kind: "version_conflict" });
  });

  describe("저장된 분석", () => {
    it("분석을 저장하고 식별자를 돌려준다", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { analysisId: ANALYSIS_ID }));

      expect(await saveRepositoryAnalysis(storedAnalysis, fetchImpl)).toBe(ANALYSIS_ID);
      expect(fetchImpl.mock.calls[0][0]).toBe(ANALYSES_PATH);
      expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
      expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ analysis: storedAnalysis });
    });

    it("식별자가 없는 응답은 형식 오류로 본다", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));

      await expect(saveRepositoryAnalysis(storedAnalysis, fetchImpl)).rejects.toMatchObject({
        kind: "server_error",
      });
    });

    it("저장소로 찾을 때 이름을 질의 문자열에 싣는다", async () => {
      const analysis = { ...storedAnalysis, id: ANALYSIS_ID, createdAt: "2026-09-15T00:00:00.000Z" };
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { analysis }));

      expect(await fetchAnalysisByRepository("hm1n", "SIFT", fetchImpl)).toEqual(analysis);
      expect(String(fetchImpl.mock.calls[0][0])).toBe(`${ANALYSES_PATH}?owner=hm1n&repo=SIFT`);
    });

    // 저장소 이름에 `/`나 `?`가 들어올 수 있습니다. 그대로 이으면 다른 경로를 부릅니다.
    it("저장소 이름을 질의 문자열로 감싼다", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { analysis: storedAnalysis }));

      await fetchAnalysisByRepository("hm 1n", "SIFT?x=1", fetchImpl);

      expect(String(fetchImpl.mock.calls[0][0])).toBe(`${ANALYSES_PATH}?owner=hm+1n&repo=SIFT%3Fx%3D1`);
    });

    it("식별자로 하나를 읽는다", async () => {
      const analysis = { ...storedAnalysis, id: ANALYSIS_ID, createdAt: "2026-09-15T00:00:00.000Z" };
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { analysis }));

      expect(await fetchStoredAnalysis(ANALYSIS_ID, fetchImpl)).toEqual(analysis);
      expect(String(fetchImpl.mock.calls[0][0])).toBe(`${ANALYSES_PATH}/${ANALYSIS_ID}`);
    });

    it("저장된 분석이 없으면 not_found로 올린다", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(jsonResponse(404, { error: { kind: "not_found", message: "없습니다" } }));

      await expect(fetchAnalysisByRepository("hm1n", "SIFT", fetchImpl)).rejects.toMatchObject({
        kind: "not_found",
      });
    });
  });
});

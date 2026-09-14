import { describe, expect, it, vi } from "vitest";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { createInMemoryStore } from "./in-memory-store";
import type { SiftStore } from "./store";

const OWNER_ID = 44727850;
const OTHER_ID = 13579246;

function blockStateAt(version: number) {
  return { ...emptyExperienceBlockState(), version };
}

async function seed(store: SiftStore, githubUserId = OWNER_ID) {
  const analysisId = await store.saveAnalysis({
    githubUserId,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: [],
    candidates: [],
    stageASummary: {},
  });
  const interviewId = await store.createInterview({
    analysisId,
    candidateKey: "candidate-1",
    title: "스트리밍 렌더링 최적화",
    evidence: { commits: [] },
  });
  return { analysisId, interviewId };
}

describe("메모리 저장 계층", () => {
  it("인터뷰를 만들면 빈 이력과 0번 블록 버전으로 시작한다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview).toMatchObject({ history: [], blockVersion: 0, status: "in_progress", repoName: "SIFT" });
  });

  // 서버가 매 턴 받는 이력은 최근 것만 실려 올 수 있습니다. 덮어쓰면 저장된 대화의 중간이 사라집니다.
  it("턴을 덮어쓰지 않고 뒤에 이어 붙인다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    await store.appendTurn({
      interviewId,
      turn: [{ role: "question", text: "첫 질문" }, { role: "answer", text: "첫 답변" }],
      blockState: blockStateAt(1),
      expectedBlockVersion: 0,
    });
    await store.appendTurn({
      interviewId,
      turn: [{ role: "question", text: "둘째 질문" }, { role: "answer", text: "둘째 답변" }],
      blockState: blockStateAt(2),
      expectedBlockVersion: 1,
    });

    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history.map((message) => message.text)).toEqual(["첫 질문", "첫 답변", "둘째 질문", "둘째 답변"]);
    expect(interview?.blockVersion).toBe(2);
  });

  it("블록 버전이 어긋나면 아무것도 쓰지 않고 version_conflict를 돌려준다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    await store.appendTurn({ interviewId, turn: [{ role: "question", text: "첫 질문" }], blockState: blockStateAt(1), expectedBlockVersion: 0 });

    const result = await store.appendTurn({
      interviewId,
      turn: [{ role: "question", text: "다른 탭의 질문" }],
      blockState: blockStateAt(2),
      expectedBlockVersion: 0,
    });

    expect(result).toBe("version_conflict");
    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history.map((message) => message.text)).toEqual(["첫 질문"]);
    expect(interview?.blockVersion).toBe(1);
  });

  it("없는 인터뷰에 턴을 붙이면 not_found를 돌려준다", async () => {
    const store = createInMemoryStore();
    const result = await store.appendTurn({
      interviewId: "00000000-0000-0000-0000-000000000000",
      turn: [],
      blockState: blockStateAt(1),
      expectedBlockVersion: 0,
    });
    expect(result).toBe("not_found");
  });

  // 읽은 뒤에 사용자 번호를 비교하는 방식이면 비교를 빠뜨린 경로가 남습니다. 조회 조건에 넣습니다.
  it("다른 사용자의 인터뷰는 없는 것으로 본다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    expect(await store.getInterview(interviewId, OTHER_ID)).toBeNull();
    expect(await store.deleteInterview(interviewId, OTHER_ID)).toBe(false);
    expect(await store.listInterviews(OTHER_ID)).toEqual([]);
    expect(await store.getInterview(interviewId, OWNER_ID)).not.toBeNull();
  });

  it("주인이 지우면 목록과 조회에서 함께 사라진다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    expect(await store.deleteInterview(interviewId, OWNER_ID)).toBe(true);
    expect(await store.getInterview(interviewId, OWNER_ID)).toBeNull();
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
    expect(await store.deleteInterview(interviewId, OWNER_ID)).toBe(false);
  });

  it("목록은 마지막으로 연 시각이 최근인 순서로 돌려준다", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStore();
      vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
      const { interviewId: older } = await seed(store);
      vi.setSystemTime(new Date("2026-09-02T00:00:00Z"));
      const { interviewId: newer } = await seed(store);

      expect((await store.listInterviews(OWNER_ID)).map((item) => item.id)).toEqual([newer, older]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("기준 시각보다 오래 열지 않은 인터뷰만 지운다", async () => {
    const store = createInMemoryStore();
    await seed(store);

    expect(await store.purgeInterviewsOpenedBefore(new Date(Date.now() - 1000))).toBe(0);
    expect(await store.purgeInterviewsOpenedBefore(new Date(Date.now() + 1000))).toBe(1);
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
  });
});

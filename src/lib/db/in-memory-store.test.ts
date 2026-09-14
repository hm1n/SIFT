import { describe, expect, it, vi } from "vitest";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
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
    githubUserId,
    analysisId,
    candidateKey: "candidate-1",
    title: "스트리밍 렌더링 최적화",
    evidence: { commits: [] },
  });
  if (interviewId === null) throw new Error("seed failed");
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
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "question", text: "첫 질문" }, { role: "answer", text: "첫 답변" }],
      blockState: blockStateAt(1),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });
    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "question", text: "둘째 질문" }, { role: "answer", text: "둘째 답변" }],
      blockState: blockStateAt(2),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 1,
    });

    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history.map((message) => message.text)).toEqual(["첫 질문", "첫 답변", "둘째 질문", "둘째 답변"]);
    expect(interview?.blockVersion).toBe(2);
  });

  it("블록 버전이 어긋나면 아무것도 쓰지 않고 version_conflict를 돌려준다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    await store.appendTurn({ githubUserId: OWNER_ID, interviewId, turn: [{ role: "question", text: "첫 질문" }], blockState: blockStateAt(1), progress: emptyInterviewProgress(), expectedBlockVersion: 0 });

    const result = await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "question", text: "다른 탭의 질문" }],
      blockState: blockStateAt(2),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    expect(result).toBe("version_conflict");
    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history.map((message) => message.text)).toEqual(["첫 질문"]);
    expect(interview?.blockVersion).toBe(1);
  });

  /**
   * 기대 버전만 보면 저장된 버전과 기대 버전과 새 버전이 모두 같은 요청이 몇 번이고 성공하고
   * 버전이 오르지 않습니다. 그러면 다른 탭이 먼저 저장해도 막지 못해 턴이 사라집니다.
   */
  it("새 블록 버전이 기대 버전보다 크지 않으면 저장하지 않는다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const sameVersion = await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "answer", text: "버전을 올리지 않는 답변" }],
      blockState: blockStateAt(0),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });
    expect(sameVersion).toBe("version_conflict");

    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history).toEqual([]);
    expect(interview?.blockVersion).toBe(0);
  });

  /**
   * 저장이 한 번 실패하면 화면의 블록 버전만 오르고 저장된 버전은 그대로 있어, 다음 턴의 새 버전이
   * 기대 버전보다 2 이상 커집니다. 이것을 거절하면 한 번 실패한 인터뷰는 그 뒤로 영원히 저장되지
   * 않습니다. 정의서의 "다음 턴에서 저장이 성공하면 밀린 내용까지 함께 저장된다"가 이 자리입니다.
   */
  it("저장이 밀렸다가 다시 성공하면 밀린 턴까지 함께 저장한다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const caughtUp = await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [
        { role: "question", text: "밀린 질문" },
        { role: "answer", text: "밀린 답변" },
        { role: "question", text: "이번 질문" },
        { role: "answer", text: "이번 답변" },
      ],
      blockState: blockStateAt(2),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    expect(caughtUp).toBe("saved");
    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history).toHaveLength(4);
    expect(interview?.blockVersion).toBe(2);
  });

  // 걸러내지 않으면 테스트는 통과하는데 Postgres의 jsonb에서만 실패합니다.
  it.each([
    ["bigint", BigInt(1)],
    ["함수", () => "x"],
    ["undefined", undefined],
  ])("jsonb가 받지 못하는 %s 값은 저장할 때 걸러낸다", async (_label, evidence) => {
    const store = createInMemoryStore();
    const { analysisId } = await seed(store);

    await expect(
      store.createInterview({ githubUserId: OWNER_ID, analysisId, candidateKey: "c", title: "제목", evidence })
    ).rejects.toThrow();
  });

  it("순환 참조가 있는 값은 저장할 때 걸러낸다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await seed(store);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      store.createInterview({ githubUserId: OWNER_ID, analysisId, candidateKey: "c", title: "제목", evidence: circular })
    ).rejects.toThrow();
  });

  // 데이터베이스는 호출한 쪽의 객체를 붙들지 않습니다. 메모리 구현도 사본을 남겨야 같은 판정이 됩니다.
  it("저장한 뒤 호출한 쪽이 원본을 고쳐도 저장된 값은 그대로다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await seed(store);
    const evidence: Record<string, unknown> = { commits: ["sha-1"] };
    const interviewId = await store.createInterview({ githubUserId: OWNER_ID, analysisId, candidateKey: "c", title: "제목", evidence });

    evidence.commits = ["바뀐 값"];

    const interview = await store.getInterview(interviewId as string, OWNER_ID);
    expect(interview?.evidence).toEqual({ commits: ["sha-1"] });
  });

  it("없는 인터뷰에 턴을 붙이면 not_found를 돌려준다", async () => {
    const store = createInMemoryStore();
    const result = await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId: "00000000-0000-0000-0000-000000000000",
      turn: [],
      blockState: blockStateAt(1),
      progress: emptyInterviewProgress(),
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

  // 쓰기도 읽기와 같은 기준을 씁니다. 소유자 판정을 호출하는 쪽에 맡기면 빠뜨린 경로가 남습니다.
  it("남의 분석에는 인터뷰를 붙일 수 없다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await seed(store);

    const created = await store.createInterview({
      githubUserId: OTHER_ID,
      analysisId,
      candidateKey: "candidate-2",
      title: "남의 분석에 붙이려는 인터뷰",
      evidence: {},
    });

    expect(created).toBeNull();
    expect(await store.listInterviews(OTHER_ID)).toEqual([]);
    expect(await store.listInterviews(OWNER_ID)).toHaveLength(1);
  });

  it("없는 분석에 인터뷰를 붙이면 null을 돌려준다", async () => {
    const store = createInMemoryStore();
    const created = await store.createInterview({
      githubUserId: OWNER_ID,
      analysisId: "00000000-0000-0000-0000-000000000000",
      candidateKey: "candidate-1",
      title: "제목",
      evidence: {},
    });
    expect(created).toBeNull();
  });

  it("남의 인터뷰에는 턴을 이어 붙일 수 없다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    const result = await store.appendTurn({
      githubUserId: OTHER_ID,
      interviewId,
      turn: [{ role: "answer", text: "남의 인터뷰에 넣으려는 답변" }],
      blockState: blockStateAt(1),
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    expect(result).toBe("not_found");
    const interview = await store.getInterview(interviewId, OWNER_ID);
    expect(interview?.history).toEqual([]);
    expect(interview?.blockVersion).toBe(0);
  });

  it("주인이 지우면 목록과 조회에서 함께 사라진다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);

    expect(await store.deleteInterview(interviewId, OWNER_ID)).toBe(true);
    expect(await store.getInterview(interviewId, OWNER_ID)).toBeNull();
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
    expect(await store.deleteInterview(interviewId, OWNER_ID)).toBe(false);
  });

  // 갱신하지 않으면 90일 정리가 매일 여는 인터뷰도 만든 지 90일이면 지웁니다.
  it("인터뷰를 열면 openedAt을 갱신해 돌려준다", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStore();
      vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
      const { interviewId } = await seed(store);

      vi.setSystemTime(new Date("2026-11-20T00:00:00Z"));
      const opened = await store.getInterview(interviewId, OWNER_ID);
      expect(opened?.openedAt).toEqual(new Date("2026-11-20T00:00:00Z"));
      expect(opened?.createdAt).toEqual(new Date("2026-09-01T00:00:00Z"));

      // 만든 지 90일이 지났어도 방금 열었으므로 정리 대상이 아닙니다.
      expect(await store.purgeInterviewsOpenedBefore(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000))).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("턴을 이어 붙이면 updatedAt만 갱신하고 openedAt은 두지 않는다", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStore();
      vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
      const { interviewId } = await seed(store);

      vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
      await store.appendTurn({ githubUserId: OWNER_ID, interviewId, turn: [{ role: "answer", text: "답변" }], blockState: blockStateAt(1), progress: emptyInterviewProgress(), expectedBlockVersion: 0 });

      const [item] = await store.listInterviews(OWNER_ID);
      expect(item.updatedAt).toEqual(new Date("2026-09-05T00:00:00Z"));
      expect(item.openedAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("버전이 어긋나 저장하지 않으면 updatedAt도 그대로 둔다", async () => {
    vi.useFakeTimers();
    try {
      const store = createInMemoryStore();
      vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
      const { interviewId } = await seed(store);

      vi.setSystemTime(new Date("2026-09-05T00:00:00Z"));
      expect(await store.appendTurn({ githubUserId: OWNER_ID, interviewId, turn: [], blockState: blockStateAt(9), progress: emptyInterviewProgress(), expectedBlockVersion: 7 })).toBe("version_conflict");

      const [item] = await store.listInterviews(OWNER_ID);
      expect(item.updatedAt).toEqual(new Date("2026-09-01T00:00:00Z"));
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * 목록 행의 `PAAR n/4`입니다. 아직 평가가 없는 블록은 `null`이라 세지 않습니다. Neon 구현은 같은
   * 값을 질의에서 세므로 두 구현이 같은 수를 내야 합니다.
   */
  it("목록은 충분하다고 평가된 블록 수를 함께 돌려준다", async () => {
    const store = createInMemoryStore();
    const { interviewId } = await seed(store);
    const blockState = {
      ...emptyExperienceBlockState(),
      version: 1,
      evaluation: {
        ...emptyExperienceBlockState().evaluation,
        problem: { sufficient: true, askable: false, reason: "sufficient" as const },
        action: { sufficient: false, askable: true, reason: "askable" as const },
      },
    };

    expect((await store.listInterviews(OWNER_ID))[0].completedBlockCount).toBe(0);

    await store.appendTurn({
      githubUserId: OWNER_ID,
      interviewId,
      turn: [{ role: "answer", text: "답변" }],
      blockState,
      progress: emptyInterviewProgress(),
      expectedBlockVersion: 0,
    });

    expect((await store.listInterviews(OWNER_ID))[0].completedBlockCount).toBe(1);
  });

  it("목록은 마지막으로 이어간 시각이 최근인 순서로 돌려준다", async () => {
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

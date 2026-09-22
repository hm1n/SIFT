import { describe, expect, it, vi } from "vitest";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { BLOCK_KINDS, emptyExperienceBlockState } from "@/features/experience-block/types";
import { DatabaseError } from "./client";
import { neonStore, type SqlExecutor } from "./neon-store";
import type { SiftStore } from "./store";

const OWNER_ID = 44727850;
const ANALYSIS_ID = "11111111-1111-4111-8111-111111111111";
const INTERVIEW_ID = "22222222-2222-4222-8222-222222222222";

/**
 * 이 파일은 데이터베이스를 붙이지 않습니다. 질의를 실제로 보내지 않고도 확인할 수 있는 것,
 * 즉 어떤 조건을 질의에 실어 보내는지와 결과 줄 수를 무엇으로 번역하는지를 봅니다.
 *
 * 질의문이 Postgres에서 실제로 도는지는 이 방식으로 확인할 수 없습니다. 그것은
 * `llm-wiki/wiki/`에 적은 실측으로 따로 확인합니다.
 */
function fakeExecute(results: Record<string, unknown>[][] = [[]]) {
  const calls: Array<{ text: string; params: readonly unknown[] }> = [];
  let index = 0;
  const execute: SqlExecutor = vi.fn(async (text, params = []) => {
    calls.push({ text, params });
    return results[Math.min(index++, results.length - 1)];
  });
  return { execute, calls };
}

function blockStateAt(version: number) {
  return { ...emptyExperienceBlockState(), version };
}

const NEW_ANALYSIS = {
  githubUserId: OWNER_ID,
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: [],
  candidates: [],
  stageASummary: {},
};

const NEW_INTERVIEW = {
  githubUserId: OWNER_ID,
  analysisId: ANALYSIS_ID,
  candidateKey: "candidate-1",
  title: "스트리밍 렌더링 최적화",
  evidence: { commits: [] },
};

describe("Neon 저장 계층", () => {
  describe("소유자 판정을 질의 조건에 넣는다", () => {
    /**
     * 이슈 #114 리뷰 2라운드가 읽기 쪽에만 소유자 확인이 있고 쓰기 쪽에 없다는 지적이었습니다.
     * 한 연산씩 확인하면 다음에 연산이 늘어날 때 같은 누락이 다시 생깁니다. 정리 작업을 뺀 모든
     * 연산이 사용자 번호를 조건에 싣는지 한꺼번에 봅니다.
     */
    const operations: Array<[string, (store: SiftStore) => Promise<unknown>]> = [
      ["saveAnalysis", (store) => store.saveAnalysis(NEW_ANALYSIS)],
      ["getAnalysis", (store) => store.getAnalysis(ANALYSIS_ID, OWNER_ID)],
      ["getLatestAnalysisByRepo", (store) => store.getLatestAnalysisByRepo(OWNER_ID, "hm1n", "SIFT")],
      ["createInterview", (store) => store.createInterview(NEW_INTERVIEW)],
      [
        "appendTurn",
        (store) =>
          store.appendTurn({
            githubUserId: OWNER_ID,
            interviewId: INTERVIEW_ID,
            turn: [],
            blockState: blockStateAt(1),
            progress: emptyInterviewProgress(),
            expectedBlockVersion: 0,
          }),
      ],
      [
        "appendHistory",
        (store) =>
          store.appendHistory({
            githubUserId: OWNER_ID,
            interviewId: INTERVIEW_ID,
            turn: [],
            expectedBlockVersion: 0,
          }),
      ],
      ["listInterviews", (store) => store.listInterviews(OWNER_ID)],
      ["completeInterview", (store) => store.completeInterview(INTERVIEW_ID, OWNER_ID)],
      ["getInterview", (store) => store.getInterview(INTERVIEW_ID, OWNER_ID)],
      ["deleteInterview", (store) => store.deleteInterview(INTERVIEW_ID, OWNER_ID)],
      ["consumeAnalysisQuota", (store) => store.consumeAnalysisQuota(OWNER_ID, "2026-09-22", 3)],
      ["getAnalysisQuotaUsage", (store) => store.getAnalysisQuotaUsage(OWNER_ID, "2026-09-22")],
      ["deleteUserData", (store) => store.deleteUserData(OWNER_ID)],
    ];

    it.each(operations)("%s은 사용자 번호를 질의에 싣는다", async (_name, run) => {
      const { execute, calls } = fakeExecute();
      await run(neonStore(execute));

      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(call.text).toContain("github_user_id");
        expect(call.params).toContain(OWNER_ID);
      }
    });

    it.each([
      ["purgeInterviewsOpenedBefore", (store: SiftStore, before: Date) => store.purgeInterviewsOpenedBefore(before)],
      ["purgeAnalysesWithoutInterviews", (store: SiftStore, before: Date) => store.purgeAnalysesWithoutInterviews(before)],
    ])("정리 작업인 %s만 사용자 번호를 받지 않는다", async (_name, run) => {
      const { execute, calls } = fakeExecute();
      const before = new Date("2026-06-16T00:00:00Z");
      await run(neonStore(execute), before);

      expect(calls[0].text).not.toContain("github_user_id");
      expect(calls[0].params).toEqual([before]);
    });

    /**
     * 고아 분석을 고르는 일과 지우는 일을 한 문장에 둡니다. 드라이버가 HTTP 한 번에 한 문장을 보내고
     * 그 한 문장이 한 트랜잭션이라, 둘로 나누면 그 사이에 새 인터뷰가 붙은 분석까지 지우게 됩니다.
     * 그 분석에 cascade로 딸린 인터뷰가 함께 사라집니다.
     */
    it("고아 분석 정리는 한 문장으로 지운다", async () => {
      const { execute, calls } = fakeExecute();
      await neonStore(execute).purgeAnalysesWithoutInterviews(new Date("2026-06-16T00:00:00Z"));

      expect(calls).toHaveLength(1);
      expect(calls[0].text).toContain("not exists");
      expect(calls[0].text).toContain("created_at <");
    });
  });

  describe("uuid가 아닌 식별자", () => {
    /**
     * 식별자는 요청 경로에서 그대로 오므로 아무 문자열이나 올 수 있습니다. 그대로 넘기면 Postgres가
     * `22P02`를 던지고, 없는 인터뷰를 요청한 것이 서버 오류로 보입니다.
     */
    it("인터뷰를 만들 때는 null을 돌려주고 질의하지 않는다", async () => {
      const { execute, calls } = fakeExecute();
      const result = await neonStore(execute).createInterview({ ...NEW_INTERVIEW, analysisId: "분석" });

      expect(result).toBeNull();
      expect(calls).toHaveLength(0);
    });

    it("턴을 이어 붙일 때는 not_found를 돌려주고 질의하지 않는다", async () => {
      const { execute, calls } = fakeExecute();
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: "없는-값",
        turn: [],
        blockState: blockStateAt(1),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 0,
      });

      expect(result).toBe("not_found");
      expect(calls).toHaveLength(0);
    });

    it("조회와 삭제는 없는 것으로 보고 질의하지 않는다", async () => {
      const { execute, calls } = fakeExecute();
      const store = neonStore(execute);

      expect(await store.getInterview("x", OWNER_ID)).toBeNull();
      expect(await store.deleteInterview("x", OWNER_ID)).toBe(false);
      expect(calls).toHaveLength(0);
    });

    // 분석 식별자도 요청 경로에서 그대로 옵니다(이슈 #116).
    it("분석 조회도 없는 것으로 보고 질의하지 않는다", async () => {
      const { execute, calls } = fakeExecute();

      expect(await neonStore(execute).getAnalysis("분석", OWNER_ID)).toBeNull();
      expect(calls).toHaveLength(0);
    });
  });

  describe("이력만 이어 붙이기", () => {
    /** 블록을 건드리지 않는 저장입니다. 쓰는 칸이 둘(이력과 갱신 시각)뿐인지 봅니다. */
    it("이력과 갱신 시각만 쓰고 블록 버전을 조건에 넣는다", async () => {
      const { execute, calls } = fakeExecute([[{ id: INTERVIEW_ID }]]);

      const result = await neonStore(execute).appendHistory({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [{ role: "answer", text: "답변" }],
        expectedBlockVersion: 3,
      });

      expect(result).toBe("saved");
      expect(calls).toHaveLength(1);
      expect(calls[0].text).toContain("history = s.history || $3::jsonb");
      expect(calls[0].text).not.toContain("block_state =");
      expect(calls[0].text).not.toContain("progress =");
      expect(calls[0].text).toContain("s.block_version = $4");
    });

    it("한 줄도 바뀌지 않으면 존재를 한 번 더 물어 갈라 답한다", async () => {
      const conflict = fakeExecute([[], [{ "?column?": 1 }]]);
      expect(
        await neonStore(conflict.execute).appendHistory({
          githubUserId: OWNER_ID,
          interviewId: INTERVIEW_ID,
          turn: [],
          expectedBlockVersion: 3,
        })
      ).toBe("version_conflict");

      const missing = fakeExecute([[], []]);
      expect(
        await neonStore(missing.execute).appendHistory({
          githubUserId: OWNER_ID,
          interviewId: INTERVIEW_ID,
          turn: [],
          expectedBlockVersion: 3,
        })
      ).toBe("not_found");
    });

    it("uuid가 아니면 질의하지 않는다", async () => {
      const { execute, calls } = fakeExecute();

      expect(
        await neonStore(execute).appendHistory({
          githubUserId: OWNER_ID,
          interviewId: "없는-값",
          turn: [],
          expectedBlockVersion: 0,
        })
      ).toBe("not_found");
      expect(calls).toHaveLength(0);
    });
  });

  describe("저장된 분석 읽기", () => {
    const ROW = {
      id: ANALYSIS_ID,
      repo_owner: "hm1n",
      repo_name: "SIFT",
      contribution_items: ["스트리밍"],
      candidates: { candidates: { candidates: [] } },
      stage_a_summary: { selectedUnitCount: 3 },
      created_at: new Date("2026-09-15T00:00:00Z"),
    };

    it("칸 이름을 화면이 쓰는 이름으로 옮기고 사용자 번호는 돌려주지 않는다", async () => {
      const { execute } = fakeExecute([[ROW]]);

      const analysis = await neonStore(execute).getAnalysis(ANALYSIS_ID, OWNER_ID);

      expect(analysis).toEqual({
        id: ANALYSIS_ID,
        repoOwner: "hm1n",
        repoName: "SIFT",
        contributionItems: ["스트리밍"],
        candidates: { candidates: { candidates: [] } },
        stageASummary: { selectedUnitCount: 3 },
        createdAt: ROW.created_at,
      });
      expect(analysis).not.toHaveProperty("githubUserId");
    });

    it("없으면 null이다", async () => {
      const { execute } = fakeExecute([[]]);

      expect(await neonStore(execute).getAnalysis(ANALYSIS_ID, OWNER_ID)).toBeNull();
    });

    /**
     * 같은 저장소를 여러 번 분석하면 줄이 여럿입니다. 앞선 분석은 그때의 커밋만 담고 있어 다시 그릴
     * 화면으로는 낡은 값이므로, 고르는 일을 코드가 아니라 질의에 맡깁니다.
     */
    it("저장소로 찾을 때는 최근 것 한 줄만 질의한다", async () => {
      const { execute, calls } = fakeExecute([[ROW]]);

      await neonStore(execute).getLatestAnalysisByRepo(OWNER_ID, "hm1n", "SIFT");

      expect(calls[0].text).toContain("order by created_at desc");
      expect(calls[0].text).toContain("limit 1");
      expect(calls[0].params).toEqual([OWNER_ID, "hm1n", "SIFT"]);
    });

    it("저장소로 찾을 때 없으면 null이다", async () => {
      const { execute } = fakeExecute([[]]);

      expect(await neonStore(execute).getLatestAnalysisByRepo(OWNER_ID, "hm1n", "SIFT")).toBeNull();
    });
  });

  describe("턴 이어 붙이기", () => {
    it("한 줄이 바뀌면 saved이고 한 번만 질의한다", async () => {
      const { execute, calls } = fakeExecute([[{ id: INTERVIEW_ID }]]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [{ role: "question", text: "질문" }],
        blockState: blockStateAt(1),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 0,
      });

      expect(result).toBe("saved");
      expect(calls).toHaveLength(1);
      // 이어 붙이기를 데이터베이스 안에서 합니다. 읽어 와서 합치면 두 요청이 겹칠 때 한쪽이 사라집니다.
      expect(calls[0].text).toContain("s.history ||");
      expect(calls[0].params).toContain(0);
    });

    /**
     * 기대 버전을 조건에 싣지 않으면 다른 탭이 먼저 저장해도 덮어씁니다. 이 조건이 질의에서
     * 빠지는 회귀를 막습니다.
     */
    it("기대 버전을 갱신 조건에 싣는다", async () => {
      const { execute, calls } = fakeExecute([[{ id: INTERVIEW_ID }]]);
      await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [],
        blockState: blockStateAt(4),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 3,
      });

      expect(calls[0].text).toContain("s.block_version = $6");
      expect(calls[0].params[5]).toBe(3);
    });

    /**
     * 새 버전 조건도 질의에 싣습니다. 코드에서 먼저 보고 돌려주면 없는 인터뷰와 남의 인터뷰에도
     * `version_conflict`가 나가, 존재와 소유를 먼저 보는 메모리 구현과 판정이 갈립니다(PR #127 리뷰).
     */
    it("버전이 오르지 않는 요청은 있는 인터뷰에서만 version_conflict다", async () => {
      const { execute, calls } = fakeExecute([[], [{ "?column?": 1 }]]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [],
        blockState: blockStateAt(3),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 3,
      });

      expect(result).toBe("version_conflict");
      expect(calls[0].text).toContain("$5::int > $6::int");
    });

    // 없는 인터뷰나 남의 인터뷰에 버전이 오르지 않는 요청이 와도 `not_found`입니다. 메모리 구현과
    // 같은 순서로 판정합니다.
    it("버전이 오르지 않아도 없는 인터뷰면 not_found다", async () => {
      const { execute } = fakeExecute([[], []]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [],
        blockState: blockStateAt(3),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 3,
      });

      expect(result).toBe("not_found");
    });

    /**
     * 저장이 한 번 실패하면 다음 턴의 새 버전이 기대 버전보다 2 이상 커집니다. 이것을 거절하면 한 번
     * 실패한 인터뷰는 그 뒤로 영원히 저장되지 않습니다.
     */
    it("밀린 턴을 함께 저장하는 요청은 버전이 2 이상 뛰어도 저장한다", async () => {
      const { execute } = fakeExecute([[{ id: INTERVIEW_ID }]]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [{ role: "answer", text: "밀린 답변" }],
        blockState: blockStateAt(3),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 1,
      });

      expect(result).toBe("saved");
    });

    it("바뀐 줄이 없고 인터뷰는 있으면 version_conflict다", async () => {
      const { execute, calls } = fakeExecute([[], [{ "?column?": 1 }]]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [],
        blockState: blockStateAt(1),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 0,
      });

      expect(result).toBe("version_conflict");
      expect(calls).toHaveLength(2);
    });

    it("바뀐 줄도 없고 인터뷰도 없으면 not_found다", async () => {
      const { execute } = fakeExecute([[], []]);
      const result = await neonStore(execute).appendTurn({
        githubUserId: OWNER_ID,
        interviewId: INTERVIEW_ID,
        turn: [],
        blockState: blockStateAt(1),
        progress: emptyInterviewProgress(),
        expectedBlockVersion: 0,
      });

      expect(result).toBe("not_found");
    });
  });

  describe("인터뷰 만들기", () => {
    it("돌려받은 줄이 없으면 null이다", async () => {
      const { execute } = fakeExecute([[]]);
      expect(await neonStore(execute).createInterview(NEW_INTERVIEW)).toBeNull();
    });

    it("빈 이력과 0번 블록 버전으로 시작한다", async () => {
      const { execute, calls } = fakeExecute([[{ id: INTERVIEW_ID }]]);
      const id = await neonStore(execute).createInterview(NEW_INTERVIEW);

      expect(id).toBe(INTERVIEW_ID);
      expect(calls[0].text).toContain("'[]'::jsonb");
      expect(calls[0].text).toContain("0, 'in_progress'");
    });
  });

  describe("조회", () => {
    const row = {
      id: INTERVIEW_ID,
      analysis_id: ANALYSIS_ID,
      candidate_key: "candidate-1",
      title: "스트리밍 렌더링 최적화",
      evidence: { commits: [] },
      history: [{ role: "question", text: "질문" }],
      block_state: blockStateAt(2),
      block_version: 2,
      status: "in_progress",
      progress: emptyInterviewProgress(),
      completed_block_count: 2,
      candidate: { sha: "sha-b", technicalTopics: ["React"] },
      created_at: new Date("2026-09-01T00:00:00Z"),
      updated_at: new Date("2026-09-10T00:00:00Z"),
      opened_at: new Date("2026-09-14T00:00:00Z"),
      repo_owner: "hm1n",
      repo_name: "SIFT",
    };

    it("칸 이름을 계약의 이름으로 옮긴다", async () => {
      const { execute } = fakeExecute([[row]]);
      const interview = await neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID);

      expect(interview).toEqual({
        id: INTERVIEW_ID,
        analysisId: ANALYSIS_ID,
        candidateKey: "candidate-1",
        repoOwner: "hm1n",
        repoName: "SIFT",
        title: "스트리밍 렌더링 최적화",
        status: "in_progress",
        evidence: { commits: [] },
        history: [{ role: "question", text: "질문" }],
        blockState: blockStateAt(2),
        blockVersion: 2,
        progress: emptyInterviewProgress(),
        completedBlockCount: 2,
        candidate: { sha: "sha-b", technicalTopics: ["React"] },
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        openedAt: row.opened_at,
      });
    });

    // 읽기이지만 이 호출이 곧 인터뷰를 여는 것이고, `opened_at`이 90일 정리의 기준입니다.
    it("여는 시각을 갱신하는 것과 읽는 것을 한 문장에 둔다", async () => {
      const { execute, calls } = fakeExecute([[row]]);
      await neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID);

      expect(calls).toHaveLength(1);
      expect(calls[0].text).toContain("set opened_at = now()");
      expect(calls[0].text).toContain("returning");
    });

    it("목록은 마지막으로 이어간 시각이 최근인 순서로 묻는다", async () => {
      const { execute, calls } = fakeExecute([[row]]);
      const items = await neonStore(execute).listInterviews(OWNER_ID);

      expect(calls[0].text).toContain("order by s.updated_at desc");
      expect(items[0]).toMatchObject({ id: INTERVIEW_ID, repoOwner: "hm1n", repoName: "SIFT" });
    });

    /**
     * 목록 행의 `PAAR n/4`입니다. 코드에서 세려면 목록이 블록 상태를 통째로 실어 와야 하므로 질의가
     * 셉니다. 질의에서 세는 것을 잊고 칸만 읽으면 화면의 진행도가 조용히 빈 값이 됩니다.
     */
    it.each([
      ["목록", (store: SiftStore) => store.listInterviews(OWNER_ID)],
      ["복원", (store: SiftStore) => store.getInterview(INTERVIEW_ID, OWNER_ID)],
    ])("%s 질의가 충분한 블록 수를 함께 센다", async (_label, call) => {
      const { execute, calls } = fakeExecute([[row]]);
      await call(neonStore(execute));

      expect(calls[0].text).toContain("as completed_block_count");
      expect(calls[0].text).toContain("'sufficient' = 'true'");
      // 블록 이름은 `BLOCK_KINDS`에서 만듭니다. 넷 중 하나라도 빠지면 진행도가 4분의 1씩 어긋납니다.
      for (const kind of BLOCK_KINDS) expect(calls[0].text).toContain(`'${kind}'`);
    });

    /**
     * 끝내는 조작이 "마지막으로 이어간 때"를 바꾸면 목록의 정렬이 대화를 이어간 것처럼 뒤바뀝니다.
     */
    it("끝난 것으로 표시할 때 이어간 시각을 건드리지 않는다", async () => {
      const { execute, calls } = fakeExecute([[{ id: INTERVIEW_ID }]]);
      const done = await neonStore(execute).completeInterview(INTERVIEW_ID, OWNER_ID);

      expect(done).toBe(true);
      expect(calls[0].text).toContain("set status = 'completed'");
      expect(calls[0].text).not.toContain("updated_at");
    });

    it("바꾼 줄이 없으면 false다", async () => {
      const { execute } = fakeExecute([[]]);
      expect(await neonStore(execute).completeInterview(INTERVIEW_ID, OWNER_ID)).toBe(false);
    });

    it("uuid가 아닌 식별자는 질의하지 않고 false다", async () => {
      const { execute, calls } = fakeExecute([[]]);
      expect(await neonStore(execute).completeInterview("없는-값", OWNER_ID)).toBe(false);
      expect(calls).toHaveLength(0);
    });

    it("셈이 비어 있는 인터뷰는 진행도가 0이다", async () => {
      const { execute } = fakeExecute([[{ ...row, completed_block_count: 0 }]]);
      const items = await neonStore(execute).listInterviews(OWNER_ID);

      expect(items[0].completedBlockCount).toBe(0);
    });

    /**
     * `progress` 칸은 나중에 더했고 기본값이 빈 객체입니다. 그대로 돌려주면 읽는 쪽이
     * `progress.problem`에서 깨집니다.
     */
    it("칸이 생기기 전에 만들어진 줄의 빈 진행 상태는 초깃값으로 돌려준다", async () => {
      const { execute } = fakeExecute([[{ ...row, progress: {} }]]);
      const interview = await neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID);

      expect(interview?.progress).toEqual(emptyInterviewProgress());
    });

    /**
     * 분석 전체를 실어 오면 화면이 쓰지 않는 다른 후보와 커밋이 모두 따라옵니다. 질의가 후보 하나만
     * 골라야 합니다.
     */
    it("복원 질의가 저장된 분석에서 그 후보 하나만 골라 온다", async () => {
      const { execute, calls } = fakeExecute([[row]]);
      await neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID);

      expect(calls[0].text).toContain("as candidate");
      expect(calls[0].text).toContain("candidate ->> 'sha' = s.candidate_key");
      expect(calls[0].text).toContain("limit 1");
    });

    it("후보를 찾지 못한 줄은 null로 돌려준다", async () => {
      const { execute } = fakeExecute([[{ ...row, candidate: undefined }]]);
      const interview = await neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID);

      expect(interview?.candidate).toBeNull();
    });

    it("모르는 status 값은 임의로 접지 않고 오류로 올린다", async () => {
      const { execute } = fakeExecute([[{ ...row, status: "archived" }]]);
      await expect(neonStore(execute).getInterview(INTERVIEW_ID, OWNER_ID)).rejects.toThrow(DatabaseError);
    });
  });

  describe("jsonb로 저장할 수 없는 값", () => {
    // 메모리 구현과 같은 판정입니다. 걸러내지 않으면 테스트는 통과하고 Postgres에서만 실패합니다.
    it.each([
      ["bigint", BigInt(1)],
      ["함수", () => "x"],
      ["undefined", undefined],
    ])("%s은 질의를 보내기 전에 던진다", async (_label, evidence) => {
      const { execute, calls } = fakeExecute();
      await expect(neonStore(execute).createInterview({ ...NEW_INTERVIEW, evidence })).rejects.toThrow();
      expect(calls).toHaveLength(0);
    });

    it("순환 참조도 던진다", async () => {
      const { execute } = fakeExecute();
      const circular: Record<string, unknown> = {};
      circular.self = circular;
      await expect(
        neonStore(execute).createInterview({ ...NEW_INTERVIEW, evidence: circular })
      ).rejects.toThrow();
    });
  });

  /**
   * 드라이버 오류를 그대로 올리면 호출하는 쪽이 "잠시 끊긴 것"과 "설정이 없는 것"을 가를 수 없고
   * 사용자에게 같은 안내가 갑니다.
   */
  describe("드라이버 오류", () => {
    it("타입이 있는 query_failed로 바꾼다", async () => {
      const execute: SqlExecutor = async () => {
        throw new Error("Connect Timeout Error");
      };
      await expect(neonStore(execute).listInterviews(OWNER_ID)).rejects.toThrow(
        expect.objectContaining({ kind: "query_failed" })
      );
    });

    it("접속 문자열이 없어 난 config_missing은 그대로 둔다", async () => {
      const execute: SqlExecutor = async () => {
        throw new DatabaseError("config_missing", "접속 문자열이 없습니다.");
      };
      await expect(neonStore(execute).listInterviews(OWNER_ID)).rejects.toThrow(
        expect.objectContaining({ kind: "config_missing" })
      );
    });
  });

  describe("삭제", () => {
    it("지운 줄이 있으면 true, 없으면 false다", async () => {
      const found = fakeExecute([[{ id: INTERVIEW_ID }]]);
      const missing = fakeExecute([[]]);

      expect(await neonStore(found.execute).deleteInterview(INTERVIEW_ID, OWNER_ID)).toBe(true);
      expect(await neonStore(missing.execute).deleteInterview(INTERVIEW_ID, OWNER_ID)).toBe(false);
    });

    it("정리 작업은 지운 줄 수를 돌려준다", async () => {
      const { execute } = fakeExecute([[{ id: "a" }, { id: "b" }]]);
      expect(await neonStore(execute).purgeInterviewsOpenedBefore(new Date())).toBe(2);
    });

    /**
     * 회원 탈퇴는 분석만 지웁니다(이슈 #145). 인터뷰를 함께 지우는 문장을 얹으면 한 요청이 두
     * 트랜잭션으로 갈라져 앞 문장만 성공한 상태가 생깁니다. 그때 남는 것이 근거 스냅샷을 든
     * 분석입니다.
     */
    it("회원 탈퇴는 분석을 한 문장으로 지우고 인터뷰는 cascade에 맡긴다", async () => {
      const { execute, calls } = fakeExecute([[{ id: "a" }, { id: "b" }]]);

      expect(await neonStore(execute).deleteUserData(OWNER_ID)).toBe(2);
      expect(calls[0].text).toContain("delete from repository_analysis");
      expect(calls[0].text).not.toContain("interview_session");
      expect(calls[0].params).toEqual([OWNER_ID]);
    });

    /**
     * `analysis_usage`에는 외래 키가 없어 cascade가 닿지 않습니다(이슈 #142). 이 문장이 없으면
     * 탈퇴한 사용자의 GitHub 번호가 그 표에 남습니다.
     *
     * 순서도 함께 봅니다. 근거 스냅샷을 든 분석이 남는 쪽이 더 위험하므로 먼저 지웁니다.
     */
    it("회원 탈퇴가 분석 횟수 줄도 지운다", async () => {
      const { execute, calls } = fakeExecute([[{ id: "a" }], []]);

      await neonStore(execute).deleteUserData(OWNER_ID);

      expect(calls).toHaveLength(2);
      expect(calls[0].text).toContain("delete from repository_analysis");
      expect(calls[1].text).toContain("delete from analysis_usage");
      expect(calls[1].params).toEqual([OWNER_ID]);
    });

    /** 횟수 줄은 빈 계정을 가르는 판단에 들어가지 않습니다. 돌려주는 수는 분석 수 그대로입니다. */
    it("지울 분석이 없으면 0이다", async () => {
      const { execute } = fakeExecute([[]]);
      expect(await neonStore(execute).deleteUserData(OWNER_ID)).toBe(0);
    });
  });
});

describe("하루 분석 횟수 상한", () => {
  const USAGE_DATE = "2026-09-22";

  /**
   * 검사와 증가가 한 문장이어야 합니다(이슈 #142). 읽고 나서 비교하면 두 요청이 같은 값을 읽어 둘 다
   * 통과합니다. 질의를 몇 번 보내는지와 조건이 질의 안에 들어 있는지를 봅니다.
   */
  it("검사와 증가를 질의 한 번으로 끝낸다", async () => {
    const { execute, calls } = fakeExecute([[{ run_count: 1 }]]);

    await neonStore(execute).consumeAnalysisQuota(OWNER_ID, USAGE_DATE, 3);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("on conflict");
    // 상한 비교가 질의 조건에 들어 있어야 합니다. 코드에서 비교하면 동시 요청을 막지 못합니다.
    expect(calls[0].text).toContain("where analysis_usage.run_count <");
    expect(calls[0].params).toEqual([OWNER_ID, USAGE_DATE, 3]);
  });

  it("돌려받은 줄의 횟수를 그대로 돌려준다", async () => {
    const { execute } = fakeExecute([[{ run_count: 2 }]]);

    expect(await neonStore(execute).consumeAnalysisQuota(OWNER_ID, USAGE_DATE, 3)).toBe(2);
  });

  /** 상한에 닿으면 `do update`의 조건이 거짓이라 돌려주는 줄이 없습니다. 그것을 초과로 읽습니다. */
  it("돌려받은 줄이 없으면 상한 초과로 읽는다", async () => {
    const { execute } = fakeExecute([[]]);

    expect(await neonStore(execute).consumeAnalysisQuota(OWNER_ID, USAGE_DATE, 3)).toBeNull();
  });

  /**
   * 줄이 아직 없으면 `on conflict` 가지로 가지 않아 상한 조건을 보지 않습니다. 상한 0을 질의에
   * 맡기면 한 번이 통과합니다. 메모리 구현과 같은 자리에서 막는지 봅니다.
   */
  it("상한이 0 이하이면 질의하지 않고 막는다", async () => {
    const { execute, calls } = fakeExecute([[{ run_count: 1 }]]);

    expect(await neonStore(execute).consumeAnalysisQuota(OWNER_ID, USAGE_DATE, 0)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("드라이버 오류는 타입이 있는 오류로 바꾼다", async () => {
    const execute: SqlExecutor = vi.fn(async () => {
      throw new Error("connection reset");
    });

    await expect(neonStore(execute).consumeAnalysisQuota(OWNER_ID, USAGE_DATE, 3)).rejects.toBeInstanceOf(
      DatabaseError
    );
  });
});

describe("오늘 쓴 분석 횟수 읽기", () => {
  const USAGE_DATE = "2026-09-22";

  it("줄이 없으면 0이다", async () => {
    const { execute } = fakeExecute([[]]);

    expect(await neonStore(execute).getAnalysisQuotaUsage(OWNER_ID, USAGE_DATE)).toBe(0);
  });

  it("줄이 있으면 그 값을 돌려준다", async () => {
    const { execute } = fakeExecute([[{ run_count: 2 }]]);

    expect(await neonStore(execute).getAnalysisQuotaUsage(OWNER_ID, USAGE_DATE)).toBe(2);
  });

  /** 읽기만 해야 합니다. 쓰는 문장이 섞이면 화면을 그리는 것만으로 횟수가 줄어듭니다. */
  it("쓰는 문장을 보내지 않는다", async () => {
    const { execute, calls } = fakeExecute([[{ run_count: 1 }]]);

    await neonStore(execute).getAnalysisQuotaUsage(OWNER_ID, USAGE_DATE);

    expect(calls).toHaveLength(1);
    expect(calls[0].text).toContain("select");
    for (const keyword of ["insert", "update", "delete"]) {
      expect(calls[0].text.toLowerCase()).not.toContain(keyword);
    }
    expect(calls[0].params).toEqual([OWNER_ID, USAGE_DATE]);
  });
});

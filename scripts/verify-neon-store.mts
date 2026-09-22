/**
 * Neon 구현체의 질의가 실제 Postgres에서 도는지 확인합니다. `npx tsx scripts/verify-neon-store.mts`로
 * 손으로 돌립니다.
 *
 * `npm test`에 넣지 않습니다. `vitest` 스위트는 외부 상태 없이 도는 성질을 지켜야 하고, 테스트에
 * 데이터베이스를 붙이는 순간 그 결정이 무너집니다(`store.ts`의 주석). 그래서 단위 테스트는 가짜
 * 실행기로 판정 분기만 보고, 질의문이 Postgres에서 실제로 도는지는 이 스크립트가 봅니다. 둘을 나누지
 * 않으면 SQL 문법 오류나 칸 이름 오타가 배포될 때까지 드러나지 않습니다.
 *
 * 만든 줄은 끝에 지웁니다. 분석을 지우면 `on delete cascade`가 인터뷰를 함께 지웁니다.
 */
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emptyInterviewProgress, recordAsked } from "@/features/experience-block/progress";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { getSql } from "@/lib/db/client";
import { neonStore } from "@/lib/db/neon-store";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadLocalEnv(): void {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(join(projectRoot, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** 실제 사용자 번호와 겹치지 않게 이 실행에서만 쓰는 번호를 만듭니다. */
const USER_ID = 900_000_000 + Math.floor(Math.random() * 1_000_000);
const OTHER_USER_ID = USER_ID + 1;

let failures = 0;

/**
 * 키 순서를 맞춘 뒤에 비교합니다. Postgres의 jsonb는 키 순서를 보존하지 않아서, 넣은 객체와 읽은
 * 객체의 키 순서가 다릅니다. 값이 같은데도 `JSON.stringify` 비교는 어긋납니다.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stable((value as Record<string, unknown>)[key])])
  );
}

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(stable(actual)) === JSON.stringify(stable(expected));
  if (!ok) failures += 1;
  console.log(`${ok ? "통과" : "실패"}  ${label}${ok ? "" : `\n      기대 ${JSON.stringify(expected)}\n      실제 ${JSON.stringify(actual)}`}`);
}

async function main(): Promise<void> {
  loadLocalEnv();
  const store = neonStore();
  const blockAt = (version: number) => ({ ...emptyExperienceBlockState(), version });

  const analysisId = await store.saveAnalysis({
    githubUserId: USER_ID,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: ["성능 개선"],
    candidates: {
      candidates: {
        candidates: [
          { sha: "sha-other", summary: "다른 후보", technicalTopics: ["Redis"] },
          { sha: "c1", summary: "고른 후보", technicalTopics: ["React", "SSE"] },
        ],
        insufficientCandidatesReason: null,
        diffs: [],
      },
      includedCommits: [],
    },
    stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
  });
  console.log(`분석 줄을 만들었습니다: ${analysisId}`);

  const stored = await store.getAnalysis(analysisId, USER_ID);
  check("저장한 분석을 식별자로 읽는다", [stored?.repoOwner, stored?.repoName], ["hm1n", "SIFT"]);
  check("분석의 jsonb 칸을 그대로 돌려준다", stored?.contributionItems, ["성능 개선"]);
  check("분석에 사용자 번호를 싣지 않는다", "githubUserId" in (stored ?? {}), false);
  check("남의 분석은 없는 것으로 본다", await store.getAnalysis(analysisId, OTHER_USER_ID), null);
  check("없는 분석은 null이다", await store.getAnalysis(randomUUID(), USER_ID), null);
  check("uuid가 아닌 분석 식별자는 null이다", await store.getAnalysis("분석", USER_ID), null);
  check("저장소 이름으로도 찾는다", (await store.getLatestAnalysisByRepo(USER_ID, "hm1n", "SIFT"))?.id, analysisId);
  check("분석한 적 없는 저장소는 null이다", await store.getLatestAnalysisByRepo(USER_ID, "hm1n", "다른-저장소"), null);
  check("남의 분석은 저장소로도 찾지 못한다", await store.getLatestAnalysisByRepo(OTHER_USER_ID, "hm1n", "SIFT"), null);

  /*
   * 같은 저장소를 다시 분석한 경우입니다. 마지막 줄을 고르는 일을 질의(`order by created_at desc`)가
   * 하므로 실제 데이터베이스에서만 확인할 수 있습니다. 이 줄도 이 실행이 만든 것이라 끝에서 함께 지웁니다.
   */
  const reanalysisId = await store.saveAnalysis({
    githubUserId: USER_ID,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: ["다시 분석"],
    candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
    stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
  });
  check("같은 저장소를 다시 분석하면 마지막 줄을 돌려준다", (await store.getLatestAnalysisByRepo(USER_ID, "hm1n", "SIFT"))?.id, reanalysisId);

  check("남의 분석에는 인터뷰를 붙이지 못한다", await store.createInterview({
    githubUserId: OTHER_USER_ID, analysisId, candidateKey: "c1", title: "남의 것", evidence: {},
  }), null);

  check("없는 분석에 붙이면 null이다", await store.createInterview({
    githubUserId: USER_ID, analysisId: randomUUID(), candidateKey: "c1", title: "없는 것", evidence: {},
  }), null);

  check("uuid가 아닌 분석 식별자는 null이다", await store.createInterview({
    githubUserId: USER_ID, analysisId: "분석", candidateKey: "c1", title: "형식 오류", evidence: {},
  }), null);

  const interviewId = await store.createInterview({
    githubUserId: USER_ID,
    analysisId,
    candidateKey: "c1",
    title: "스트리밍 렌더링 최적화",
    evidence: { commits: ["sha-1"] },
  });
  if (interviewId === null) throw new Error("인터뷰를 만들지 못했습니다.");
  console.log(`인터뷰 줄을 만들었습니다: ${interviewId}`);

  const created = await store.getInterview(interviewId, USER_ID);
  check("빈 진행 상태로 시작한다", created?.progress, emptyInterviewProgress());
  check("빈 이력과 0번 블록 버전으로 시작한다", [created?.history, created?.blockVersion], [[], 0]);
  check("근거를 그대로 돌려준다", created?.evidence, { commits: ["sha-1"] });
  check("저장된 분석에서 그 후보 하나를 골라 온다", created?.candidate, { sha: "c1", summary: "고른 후보", technicalTopics: ["React", "SSE"] });
  check("분석의 저장소 이름을 함께 돌려준다", [created?.repoOwner, created?.repoName], ["hm1n", "SIFT"]);

  check("남의 인터뷰는 없는 것으로 본다", await store.getInterview(interviewId, OTHER_USER_ID), null);

  check("첫 턴을 저장한다", await store.appendTurn({
    githubUserId: USER_ID, interviewId,
    turn: [{ role: "question", text: "질문 1" }, { role: "answer", text: "답변 1" }],
    progress: emptyInterviewProgress(), blockState: blockAt(1), expectedBlockVersion: 0,
  }), "saved");

  check("기대 버전이 어긋나면 version_conflict다", await store.appendTurn({
    githubUserId: USER_ID, interviewId,
    turn: [{ role: "question", text: "덮어쓰면 안 되는 질문" }],
    progress: emptyInterviewProgress(), blockState: blockAt(2), expectedBlockVersion: 0,
  }), "version_conflict");

  check("버전이 오르지 않으면 version_conflict다", await store.appendTurn({
    githubUserId: USER_ID, interviewId,
    turn: [{ role: "question", text: "버전을 올리지 않는 질문" }],
    progress: emptyInterviewProgress(), blockState: blockAt(1), expectedBlockVersion: 1,
  }), "version_conflict");

  check("남의 인터뷰에는 이어 붙이지 못한다", await store.appendTurn({
    githubUserId: OTHER_USER_ID, interviewId,
    turn: [{ role: "answer", text: "남의 답변" }],
    progress: emptyInterviewProgress(), blockState: blockAt(2), expectedBlockVersion: 1,
  }), "not_found");

  // 저장이 한 번 밀렸다가 다시 성공하는 경우입니다. 새 버전이 기대 버전보다 2 큽니다.
  check("밀린 턴을 함께 저장한다", await store.appendTurn({
    githubUserId: USER_ID, interviewId,
    turn: [
      { role: "question", text: "질문 2" }, { role: "answer", text: "답변 2" },
      { role: "question", text: "질문 3" }, { role: "answer", text: "답변 3" },
    ],
    // 질문을 세 번 보낸 진행 상태입니다. 저장한 뒤 그대로 읽히는지 아래에서 확인합니다.
    progress: recordAsked(recordAsked(recordAsked(emptyInterviewProgress(), "problem", "a"), "problem", "a"), "problem", "a"),
    blockState: blockAt(3), expectedBlockVersion: 1,
  }), "saved");

  const appended = await store.getInterview(interviewId, USER_ID);
  check("진행 상태를 덮어쓴다", appended?.progress.problem.elements.a.askedCount, 3);
  check("덮어쓰지 않고 뒤에 이어 붙인다", appended?.history.map((m) => m.text), [
    "질문 1", "답변 1", "질문 2", "답변 2", "질문 3", "답변 3",
  ]);
  check("블록 버전을 새 값으로 옮긴다", appended?.blockVersion, 3);
  check("이어 붙인 뒤 updatedAt이 createdAt보다 늦다", (appended!.updatedAt > appended!.createdAt), true);

  check("이력만 이어 붙이면 블록 버전은 그대로다", await store.appendHistory({
    githubUserId: USER_ID, interviewId, turn: [{ role: "question", text: "이력만 남긴 질문" }], expectedBlockVersion: 3,
  }), "saved");
  const historyOnly = await store.getInterview(interviewId, USER_ID);
  check("이력만 붙인 뒤에도 블록 버전이 그대로다", historyOnly?.blockVersion, 3);
  check("붙인 대화가 이력 끝에 있다", historyOnly?.history.at(-1)?.text, "이력만 남긴 질문");
  check("버전이 다르면 이력을 붙이지 않는다", await store.appendHistory({
    githubUserId: USER_ID, interviewId, turn: [{ role: "question", text: "붙지 않아야 하는 질문" }], expectedBlockVersion: 99,
  }), "version_conflict");
  check("남의 인터뷰에는 이력을 붙이지 못한다", await store.appendHistory({
    githubUserId: OTHER_USER_ID, interviewId, turn: [], expectedBlockVersion: 3,
  }), "not_found");
  check("이력만 붙여도 updatedAt은 갱신한다", (historyOnly!.updatedAt >= appended!.updatedAt), true);

  // 비교 기준을 마지막 쓰기 뒤의 값으로 잡습니다. 이력만 붙이는 것도 `updatedAt`을 옮깁니다.
  const beforeOpen = historyOnly!.openedAt;
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  const reopened = await store.getInterview(interviewId, USER_ID);
  check("인터뷰를 열면 openedAt을 갱신한다", (reopened!.openedAt > beforeOpen), true);
  check("여는 것이 updatedAt을 건드리지 않는다", reopened!.updatedAt.getTime(), historyOnly!.updatedAt.getTime());

  /**
   * 목록 행의 `PAAR n/4`입니다. 이 수는 코드가 아니라 질의가 셉니다. `jsonb_each`와 `jsonb_typeof`를
   * 쓰는 식이라 가짜 실행기로는 옳은지 알 수 없고 여기서만 확인할 수 있습니다.
   */
  const evaluated = {
    ...blockAt(4),
    evaluation: {
      ...emptyExperienceBlockState().evaluation,
      problem: { sufficient: true, askable: false, reason: "sufficient" as const },
      result: { sufficient: true, askable: false, reason: "sufficient" as const },
      action: { sufficient: false, askable: true, reason: "askable" as const },
    },
  };
  check("평가를 담은 턴을 저장한다", await store.appendTurn({
    githubUserId: USER_ID, interviewId,
    turn: [{ role: "answer", text: "답변 4" }],
    progress: emptyInterviewProgress(), blockState: evaluated, expectedBlockVersion: 3,
  }), "saved");

  check("목록이 충분한 블록 수를 센다", (await store.listInterviews(USER_ID))[0].completedBlockCount, 2);
  check("복원도 같은 수를 센다", (await store.getInterview(interviewId, USER_ID))?.completedBlockCount, 2);

  const list = await store.listInterviews(USER_ID);
  check("목록에 그 인터뷰가 있다", list.map((item) => item.id), [interviewId]);
  check("남의 목록에는 없다", (await store.listInterviews(OTHER_USER_ID)).length, 0);

  check("남의 인터뷰는 끝난 것으로 표시하지 못한다", await store.completeInterview(interviewId, OTHER_USER_ID), false);
  check("주인은 끝난 것으로 표시한다", await store.completeInterview(interviewId, USER_ID), true);
  check("표시한 상태가 목록에 보인다", (await store.listInterviews(USER_ID))[0].status, "completed");

  check("남의 인터뷰는 지우지 못한다", await store.deleteInterview(interviewId, OTHER_USER_ID), false);
  check("주인은 지울 수 있다", await store.deleteInterview(interviewId, USER_ID), true);
  check("두 번 지우면 false다", await store.deleteInterview(interviewId, USER_ID), false);

  /*
   * 하루 분석 횟수 상한입니다(이슈 #142). 검사와 증가가 한 문장이므로 그 문장이 실제 Postgres에서
   * 도는지, 그리고 상한에 닿았을 때 돌려주는 줄이 정말 없는지는 여기서만 확인할 수 있습니다.
   */
  const usageDate = "2026-09-22";
  check("첫 분석은 1을 돌려준다", await store.consumeAnalysisQuota(USER_ID, usageDate, 3), 1);
  check("두 번째는 2다", await store.consumeAnalysisQuota(USER_ID, usageDate, 3), 2);
  check("세 번째는 3이다", await store.consumeAnalysisQuota(USER_ID, usageDate, 3), 3);
  check("상한을 넘기면 null이다", await store.consumeAnalysisQuota(USER_ID, usageDate, 3), null);
  check("막힌 호출은 횟수를 올리지 않는다", await store.consumeAnalysisQuota(USER_ID, usageDate, 4), 4);
  check("날짜가 다르면 따로 센다", await store.consumeAnalysisQuota(USER_ID, "2026-09-23", 3), 1);
  check("사용자가 다르면 따로 센다", await store.consumeAnalysisQuota(OTHER_USER_ID, usageDate, 3), 1);
  check("읽기만 하면 횟수가 그대로다", await store.getAnalysisQuotaUsage(USER_ID, usageDate), 4);
  check("읽은 뒤에도 값이 그대로다", await store.getAnalysisQuotaUsage(USER_ID, usageDate), 4);
  check("줄이 없는 날짜는 0이다", await store.getAnalysisQuotaUsage(USER_ID, "2026-09-24"), 0);

  // 정리 작업은 사용자 번호를 받지 않으므로 이 실행이 만든 줄만 남았는지 확인한 뒤에 돌립니다.
  const leftover = await store.listInterviews(USER_ID);
  check("지운 뒤 목록이 비어 있다", leftover.length, 0);

  /*
   * 이 실행이 만든 분석 줄만 식별자로 지웁니다(PR #127 리뷰).
   *
   * `USER_ID`는 유한한 범위에서 무작위로 고른 값이라 데이터베이스가 예약해 주지 않습니다. 사용자
   * 번호로 지우면 같은 번호를 쓰는 기존 줄까지 함께 지워지고, `repository_analysis`를 지우면 거기
   * 딸린 인터뷰가 cascade로 사라집니다. 이 스크립트는 실제 Neon을 상대로 돌고 접속 대상을 스스로
   * 확인하지 않으므로, 대상이 어긋난 실행에서는 남의 저장된 인터뷰를 지우게 됩니다.
   */
  const sql = getSql();
  // 이 실행이 만든 분석 줄이 둘입니다. 둘 다 식별자로 지웁니다.
  const madeAnalyses = [analysisId, reanalysisId];
  for (const id of madeAnalyses) {
    await sql.query("delete from repository_analysis where id = $1::uuid", [id]);
  }
  const rest = await sql.query(
    "select count(*)::int as n from repository_analysis where id = any($1::uuid[])",
    [madeAnalyses]
  );
  check("만든 분석 줄을 지웠다", rest[0].n, 0);

  // 횟수 줄은 분석과 이어져 있지 않아 cascade로 사라지지 않습니다. 이 실행이 쓴 두 사용자 번호로 지웁니다.
  await sql.query("delete from analysis_usage where github_user_id = any($1::bigint[])", [
    [USER_ID, OTHER_USER_ID],
  ]);
  const usageLeft = await sql.query(
    "select count(*)::int as n from analysis_usage where github_user_id = any($1::bigint[])",
    [[USER_ID, OTHER_USER_ID]]
  );
  check("만든 횟수 줄을 지웠다", usageLeft[0].n, 0);

  console.log(failures === 0 ? "\n모두 통과했습니다." : `\n${failures}건 실패했습니다.`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

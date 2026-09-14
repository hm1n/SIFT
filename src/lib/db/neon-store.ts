import { randomUUID } from "node:crypto";
import { DatabaseError, getSql } from "./client";
import type {
  AppendTurn,
  AppendTurnResult,
  InterviewListItem,
  InterviewStatus,
  NewAnalysis,
  NewInterview,
  SiftStore,
  StoredInterview,
} from "./store";
import type { InterviewProgress } from "@/features/experience-block/progress";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import type { ExperienceBlockState } from "@/features/experience-block/types";
import { BLOCK_KINDS, emptyExperienceBlockState } from "@/features/experience-block/types";
import type { InterviewHistoryMessage } from "@/features/interview/history";

/**
 * `SiftStore`의 Neon 구현체입니다. 계약과 설계 근거는 `store.ts`와
 * `llm-wiki/wiki/2026-09-14-Neon-접속계층과-세션-사용자번호.md`에 있습니다.
 *
 * 판정을 코드가 아니라 질의 조건에 둡니다. 소유자 판정은 `repository_analysis`를 함께 걸어 `where`에
 * 넣고, 블록 버전 판정은 `update ... where block_version = $expected` 한 문장에 넣습니다. 읽어 온 뒤에
 * 비교하는 방식이면 비교를 빠뜨린 경로가 하나만 있어도 남의 데이터를 읽거나 쓰고, 두 요청이 같은 버전을
 * 동시에 읽으면 둘 다 통과합니다.
 *
 * 드라이버가 돌려주는 타입은 2026-09-14에 실제 Neon에 물어 확인했습니다. `timestamptz`는 `Date`,
 * `jsonb`는 파싱된 값, `integer`는 `number`, `uuid`와 `text`는 `string`입니다. 그래서 되돌려 주기 전에
 * 다시 변환하지 않습니다.
 */

/** 질의 한 번입니다. 테스트가 데이터베이스 없이 판정 분기를 확인할 수 있도록 밖에서 넣을 수 있게 둡니다. */
export type SqlExecutor = (text: string, params?: readonly unknown[]) => Promise<Record<string, unknown>[]>;

function defaultExecute(text: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]> {
  // 환경변수를 질의할 때마다 읽습니다. 이유는 `getSql`의 주석과 같습니다.
  return getSql().query(text, params as unknown[]) as Promise<Record<string, unknown>[]>;
}

/**
 * `uuid` 칸에 uuid가 아닌 문자열을 넘기면 Postgres가 `22P02`를 던집니다. 인터뷰 식별자는 요청 경로에서
 * 그대로 오므로 아무 문자열이나 올 수 있고, 그것을 오류로 올리면 "없는 인터뷰"와 "서버 오류"가 갈립니다.
 * 계약은 없는 것과 남의 것을 구분하지 않으므로 형식이 어긋난 값도 없는 것으로 봅니다.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * jsonb 칸으로 보낼 값을 문자열로 만듭니다.
 *
 * `undefined`와 함수는 `JSON.stringify`가 `undefined`를 내므로 여기서 걸러 던집니다. 던지지 않고
 * 그대로 넘기면 드라이버가 `null`을 보내고 `not null` 제약에 걸려 한참 뒤에 다른 이름의 오류가 납니다.
 * `bigint`와 순환 참조는 `JSON.stringify`가 스스로 던집니다. 메모리 구현과 같은 판정입니다.
 */
function toJsonb(value: unknown, column: string): string {
  const text = JSON.stringify(value);
  if (text === undefined) {
    throw new DatabaseError("query_failed", `${column}에 jsonb로 저장할 수 없는 값이 왔습니다.`);
  }
  return text;
}

/**
 * 표의 `status`에는 제약이 없습니다. 우리 코드만 쓰는 칸이지만, 모르는 값을 임의로 한쪽으로 접으면
 * 화면이 틀린 상태를 사실인 것처럼 보여 줍니다. 모르는 값은 그대로 드러냅니다.
 */
function toStatus(value: unknown): InterviewStatus {
  if (value === "in_progress" || value === "completed") return value;
  throw new DatabaseError("query_failed", `status 칸에 모르는 값이 있습니다: ${String(value)}`);
}

/**
 * `progress` 칸은 표에 나중에 더했고 기본값이 `'{}'`입니다. 그 칸이 생기기 전에 만들어진 줄은 빈
 * 객체를 들고 있으므로, 블록이 하나도 없는 값을 그대로 돌려주면 읽는 쪽이 `progress.problem`에서
 * 깨집니다. 블록 키가 갖춰지지 않은 값은 비어 있는 것으로 보고 초깃값을 돌려줍니다.
 */
function toProgress(value: unknown): InterviewProgress {
  const empty = emptyInterviewProgress();
  if (typeof value !== "object" || value === null) return empty;
  const known = Object.keys(empty);
  return known.every((block) => block in value) ? (value as InterviewProgress) : empty;
}

/**
 * 충분하다고 평가된 블록 수를 세는 식입니다. `countSufficientBlocks`가 내는 값과 같아야 합니다.
 *
 * 이 수를 코드가 아니라 질의에서 셉니다. 코드에서 세려면 목록 질의가 블록 상태를 통째로 실어 와야
 * 하는데, 인터뷰 하나의 블록 상태에는 주장과 표시 문장이 모두 들어 있어 화면이 쓰지 않는 값이 목록
 * 응답의 대부분을 차지하게 됩니다.
 *
 * 블록 이름 넷은 `BLOCK_KINDS`에서 만듭니다. 값이 컴파일 시점에 고정된 낱말이라 질의문에 그대로
 * 끼워도 안전하고, 여기에 다시 적으면 이름이 바뀔 때 한쪽만 남습니다. `jsonb_each`는 객체가 아닌
 * 값을 받으면 오류를 내므로 모양을 먼저 봅니다(칸을 더하기 전에 만들어진 줄).
 */
const COMPLETED_BLOCK_COUNT_SQL = `(select count(*)
            from jsonb_each(case when jsonb_typeof(s.block_state -> 'evaluation') = 'object'
                                 then s.block_state -> 'evaluation' else '{}'::jsonb end) e
           where e.key in (${BLOCK_KINDS.map((kind) => `'${kind}'`).join(", ")})
             and e.value ->> 'sufficient' = 'true')::int as completed_block_count`;

function toListItem(row: Record<string, unknown>): InterviewListItem {
  return {
    id: row.id as string,
    repoOwner: row.repo_owner as string,
    repoName: row.repo_name as string,
    title: row.title as string,
    status: toStatus(row.status),
    completedBlockCount: row.completed_block_count as number,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    openedAt: row.opened_at as Date,
  };
}

export function neonStore(execute: SqlExecutor = defaultExecute): SiftStore {
  /**
   * 드라이버가 내는 오류를 타입이 있는 오류로 바꿉니다. 접속 문자열이 없어 `getSql`이 던진
   * `config_missing`은 그대로 둡니다.
   *
   * 감싸지 않으면 호출하는 쪽이 오류를 가를 수 없습니다. 연결이 잠시 끊긴 것은 다시 시도할 여지가
   * 있고 설정이 없는 것은 없는데, 드라이버 오류를 그대로 올리면 둘 다 "모르는 오류"가 되어
   * 사용자에게 같은 안내가 갑니다.
   */
  async function run(text: string, params: readonly unknown[]): Promise<Record<string, unknown>[]> {
    try {
      return await execute(text, params);
    } catch (error) {
      if (error instanceof DatabaseError) throw error;
      throw new DatabaseError("query_failed", "데이터베이스 질의에 실패했습니다.", { cause: error });
    }
  }

  return {
    async saveAnalysis(input: NewAnalysis): Promise<string> {
      const id = randomUUID();
      await run(
        `insert into repository_analysis
           (id, github_user_id, repo_owner, repo_name, contribution_items, candidates, stage_a_summary)
         values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)`,
        [
          id,
          input.githubUserId,
          input.repoOwner,
          input.repoName,
          toJsonb(input.contributionItems, "contribution_items"),
          toJsonb(input.candidates, "candidates"),
          toJsonb(input.stageASummary, "stage_a_summary"),
        ]
      );
      return id;
    },

    /**
     * 소유자 확인과 삽입을 한 문장에 둡니다. 먼저 조회해 확인한 뒤 삽입하면 그 사이에 분석이 지워질 수
     * 있고, 확인을 호출하는 쪽에 맡기면 빠뜨린 경로가 남의 분석에 인터뷰를 붙입니다. `select`가 한 줄도
     * 내지 않으면 삽입 자체가 일어나지 않습니다.
     */
    async createInterview(input: NewInterview): Promise<string | null> {
      if (!isUuid(input.analysisId)) return null;
      const id = randomUUID();
      const rows = await run(
        `insert into interview_session
           (id, analysis_id, candidate_key, title, evidence, history, block_state, block_version, status, progress)
         select $1::uuid, ra.id, $4::text, $5::text, $6::jsonb, '[]'::jsonb, $7::jsonb, 0, 'in_progress', $8::jsonb
           from repository_analysis ra
          where ra.id = $2::uuid and ra.github_user_id = $3::bigint
         returning id`,
        [
          id,
          input.analysisId,
          input.githubUserId,
          input.candidateKey,
          input.title,
          toJsonb(input.evidence, "evidence"),
          toJsonb(emptyExperienceBlockState(), "block_state"),
          toJsonb(emptyInterviewProgress(), "progress"),
        ]
      );
      return rows.length > 0 ? (rows[0].id as string) : null;
    },

    /**
     * 이력은 `||`로 데이터베이스 안에서 이어 붙입니다. 읽어 와서 합친 뒤 되돌려 쓰면 두 요청이 겹칠 때
     * 한쪽의 턴이 사라집니다.
     *
     * 버전 조건 둘을 모두 `where`에 넣지 않고 새 버전 조건만 코드에서 봅니다. 새 버전은 요청이 들고 온
     * 값이라 저장된 줄과 비교할 필요가 없고, 저장된 값과 맞춰야 하는 조건은 `block_version = $expected`
     * 하나뿐이기 때문입니다.
     */
    async appendTurn({
      githubUserId,
      interviewId,
      turn,
      blockState,
      progress,
      expectedBlockVersion,
    }: AppendTurn): Promise<AppendTurnResult> {
      if (!isUuid(interviewId)) return "not_found";
      // 버전이 오르지 않는 요청입니다. 질의를 보내면 조건에 걸려 아무것도 바뀌지 않고, 그 뒤에
      // 존재 확인 질의까지 한 번 더 나갑니다. 요청이 들고 온 값만으로 판정할 수 있으므로 여기서 끝냅니다.
      if (blockState.version <= expectedBlockVersion) return "version_conflict";

      const updated = await run(
        `update interview_session s
            set history = s.history || $3::jsonb,
                block_state = $4::jsonb,
                block_version = $5,
                progress = $7::jsonb,
                updated_at = now()
           from repository_analysis ra
          where s.id = $1
            and s.analysis_id = ra.id
            and ra.github_user_id = $2
            and s.block_version = $6
         returning s.id`,
        [
          interviewId,
          githubUserId,
          toJsonb(turn, "history"),
          toJsonb(blockState, "block_state"),
          blockState.version,
          expectedBlockVersion,
          toJsonb(progress, "progress"),
        ]
      );
      if (updated.length > 0) return "saved";

      // 한 줄도 바뀌지 않은 이유가 둘입니다. 인터뷰가 없거나 남의 것이면 `not_found`이고, 있는데 버전이
      // 어긋났으면 `version_conflict`입니다. 실패한 경로에서만 한 번 더 묻습니다.
      const existing = await run(
        `select 1
           from interview_session s
           join repository_analysis ra on ra.id = s.analysis_id
          where s.id = $1 and ra.github_user_id = $2`,
        [interviewId, githubUserId]
      );
      return existing.length > 0 ? "version_conflict" : "not_found";
    },

    async listInterviews(githubUserId: number): Promise<InterviewListItem[]> {
      const rows = await run(
        `select s.id, s.title, s.status, s.created_at, s.updated_at, s.opened_at,
                ${COMPLETED_BLOCK_COUNT_SQL},
                ra.repo_owner, ra.repo_name
           from interview_session s
           join repository_analysis ra on ra.id = s.analysis_id
          where ra.github_user_id = $1
          order by s.updated_at desc`,
        [githubUserId]
      );
      return rows.map(toListItem);
    },

    /**
     * 읽기이지만 `opened_at`을 갱신합니다. 이 호출이 곧 인터뷰를 여는 것이고 `opened_at`이 90일 정리의
     * 기준이기 때문입니다. `update ... returning`으로 갱신과 조회를 한 문장에 둡니다.
     */
    async getInterview(id: string, githubUserId: number): Promise<StoredInterview | null> {
      if (!isUuid(id)) return null;
      const rows = await run(
        `update interview_session s
            set opened_at = now()
           from repository_analysis ra
          where s.id = $1 and s.analysis_id = ra.id and ra.github_user_id = $2
         returning s.id, s.analysis_id, s.candidate_key, s.title, s.evidence, s.history,
                   s.block_state, s.block_version, s.status, s.progress,
                   ${COMPLETED_BLOCK_COUNT_SQL},
                   s.created_at, s.updated_at, s.opened_at,
                   ra.repo_owner, ra.repo_name`,
        [id, githubUserId]
      );
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        ...toListItem(row),
        analysisId: row.analysis_id as string,
        candidateKey: row.candidate_key as string,
        evidence: row.evidence,
        history: row.history as readonly InterviewHistoryMessage[],
        blockState: row.block_state as ExperienceBlockState,
        blockVersion: row.block_version as number,
        progress: toProgress(row.progress),
      };
    },

    async deleteInterview(id: string, githubUserId: number): Promise<boolean> {
      if (!isUuid(id)) return false;
      const rows = await run(
        `delete from interview_session s
           using repository_analysis ra
          where s.id = $1 and s.analysis_id = ra.id and ra.github_user_id = $2
         returning s.id`,
        [id, githubUserId]
      );
      return rows.length > 0;
    },

    /** 정리 작업만 사용자 번호를 받지 않습니다. 실제로 부르는 자리는 이슈 #116에서 만듭니다. */
    async purgeInterviewsOpenedBefore(before: Date): Promise<number> {
      const rows = await run(
        `delete from interview_session where opened_at < $1 returning id`,
        [before]
      );
      return rows.length;
    },
  };
}

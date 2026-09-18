import { randomUUID } from "node:crypto";
import type {
  AppendTurn,
  AppendTurnResult,
  InterviewListItem,
  NewAnalysis,
  NewInterview,
  SiftStore,
  StoredAnalysisRecord,
  StoredInterview,
} from "./store";
import { emptyInterviewProgress } from "@/features/experience-block/progress";
import { countSufficientBlocks, emptyExperienceBlockState } from "@/features/experience-block/types";
import type { InterviewHistoryMessage } from "@/features/interview/history";

interface AnalysisRow extends NewAnalysis {
  readonly id: string;
  readonly createdAt: Date;
}

interface InterviewRow extends NewInterview {
  readonly id: string;
  history: InterviewHistoryMessage[];
  blockState: StoredInterview["blockState"];
  blockVersion: number;
  progress: StoredInterview["progress"];
  status: StoredInterview["status"];
  createdAt: Date;
  updatedAt: Date;
  openedAt: Date;
}

/**
 * 표의 jsonb 칸으로 가는 값을 저장할 때 JSON을 한 번 거칩니다.
 *
 * 두 가지를 실제 구현과 맞춥니다. 첫째, `undefined`와 `bigint`와 함수와 순환 참조처럼 jsonb가 받지
 * 못하는 값이 여기서 걸립니다. 걸러내지 않으면 테스트는 통과하는데 Postgres에서만 실패합니다.
 * 둘째, 호출한 쪽의 객체를 그대로 붙들지 않고 사본을 남깁니다. 참조를 붙들면 호출한 쪽이 나중에
 * 그 객체를 고칠 때 저장된 값이 함께 바뀌는데, 데이터베이스는 그렇게 동작하지 않습니다.
 */
function asJsonb<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 저장된 분석에서 후보 하나를 고릅니다. 실제 구현은 같은 일을 질의에서 합니다. 모양이 어긋난 값을
 * 만나면 `null`입니다. 저장된 분석은 오래전에 쓴 값이라 지금 기대하는 모양이 아닐 수 있습니다.
 */
function storedCandidate(analysis: AnalysisRow, candidateKey: string): unknown {
  const candidates = (analysis.candidates as { candidates?: { candidates?: unknown } } | null)?.candidates?.candidates;
  if (!Array.isArray(candidates)) return null;
  return candidates.find((candidate) => (candidate as { sha?: unknown }).sha === candidateKey) ?? null;
}

/** 사용자 번호를 뺀 모양으로 돌려줍니다. 소유자 판정은 조회 조건에서 이미 끝났습니다. */
function toAnalysisRecord(analysis: AnalysisRow): StoredAnalysisRecord {
  return {
    id: analysis.id,
    repoOwner: analysis.repoOwner,
    repoName: analysis.repoName,
    contributionItems: analysis.contributionItems,
    candidates: analysis.candidates,
    stageASummary: analysis.stageASummary,
    createdAt: analysis.createdAt,
  };
}

/**
 * 테스트가 쓰는 저장 계층입니다. 프로세스 메모리에만 있고 파일도 연결도 만들지 않습니다.
 *
 * 실제 구현과 같은 판정을 하도록 두 가지를 흉내 냅니다. 사용자 번호가 맞지 않으면 없는 것으로 보고,
 * 블록 버전이 어긋나면 아무것도 쓰지 않습니다. 이 둘을 흉내 내지 않으면 테스트가 통과해도 실제
 * 동작을 보장하지 못합니다.
 */
export function createInMemoryStore(): SiftStore {
  const analyses = new Map<string, AnalysisRow>();
  const interviews = new Map<string, InterviewRow>();

  function analysisOf(interview: InterviewRow): AnalysisRow | undefined {
    return analyses.get(interview.analysisId);
  }

  function toListItem(interview: InterviewRow, analysis: AnalysisRow): InterviewListItem {
    return {
      id: interview.id,
      repoOwner: analysis.repoOwner,
      repoName: analysis.repoName,
      title: interview.title,
      status: interview.status,
      completedBlockCount: countSufficientBlocks(interview.blockState),
      createdAt: interview.createdAt,
      updatedAt: interview.updatedAt,
      openedAt: interview.openedAt,
    };
  }

  function ownedBy(interview: InterviewRow, githubUserId: number): AnalysisRow | undefined {
    const analysis = analysisOf(interview);
    return analysis && analysis.githubUserId === githubUserId ? analysis : undefined;
  }

  return {
    async saveAnalysis(input) {
      const id = randomUUID();
      analyses.set(id, {
        ...input,
        id,
        contributionItems: asJsonb(input.contributionItems),
        candidates: asJsonb(input.candidates),
        stageASummary: asJsonb(input.stageASummary),
        createdAt: new Date(),
      });
      return id;
    },

    async getAnalysis(id, githubUserId) {
      const analysis = analyses.get(id);
      if (!analysis || analysis.githubUserId !== githubUserId) return null;
      return toAnalysisRecord(analysis);
    },

    async getLatestAnalysisByRepo(githubUserId, repoOwner, repoName) {
      // 같은 저장소를 여러 번 분석했으면 마지막 것입니다. 실제 구현은 `order by created_at desc`로
      // 같은 값을 고릅니다. 저장 시각이 같은 줄이 둘이면 나중에 넣은 것을 고르는 것도 같습니다.
      const matched = [...analyses.values()].filter(
        (analysis) =>
          analysis.githubUserId === githubUserId &&
          analysis.repoOwner === repoOwner &&
          analysis.repoName === repoName
      );
      const latest = matched.at(-1);
      return latest ? toAnalysisRecord(latest) : null;
    },

    async createInterview(input) {
      // 남의 분석에 인터뷰를 붙일 수 없습니다. 없는 경우와 남의 것인 경우를 구분하지 않습니다.
      const analysis = analyses.get(input.analysisId);
      if (!analysis || analysis.githubUserId !== input.githubUserId) return null;
      const id = randomUUID();
      interviews.set(id, {
        ...input,
        id,
        evidence: asJsonb(input.evidence),
        history: [],
        blockState: emptyExperienceBlockState(),
        blockVersion: 0,
        progress: emptyInterviewProgress(),
        status: "in_progress",
        createdAt: new Date(),
        updatedAt: new Date(),
        openedAt: new Date(),
      });
      return id;
    },

    async appendTurn({ githubUserId, interviewId, turn, blockState, progress, expectedBlockVersion }: AppendTurn): Promise<AppendTurnResult> {
      const interview = interviews.get(interviewId);
      if (!interview || !ownedBy(interview, githubUserId)) return "not_found";
      if (interview.blockVersion !== expectedBlockVersion) return "version_conflict";
      // 기대 버전만 보면 세 값이 모두 같은 요청이 몇 번이고 성공하고 버전이 오르지 않습니다.
      // 그러면 다른 탭이 먼저 저장해도 막지 못합니다. 정확히 1 큰 값을 요구하지 않는 이유는
      // `store.ts`의 `appendTurn` 주석에 있습니다.
      if (blockState.version <= expectedBlockVersion) return "version_conflict";
      interview.history = [...interview.history, ...asJsonb(turn)];
      interview.blockState = asJsonb(blockState);
      interview.blockVersion = blockState.version;
      interview.progress = asJsonb(progress);
      interview.updatedAt = new Date();
      return "saved";
    },

    async appendHistory({ githubUserId, interviewId, turn, expectedBlockVersion }) {
      const interview = interviews.get(interviewId);
      if (!interview || !ownedBy(interview, githubUserId)) return "not_found";
      // 다른 곳이 먼저 저장했으면 그 턴들이 이미 들어 있을 수 있습니다. 이유는 `store.ts`에 있습니다.
      if (interview.blockVersion !== expectedBlockVersion) return "version_conflict";
      // 블록 상태와 버전과 진행 상태를 건드리지 않습니다. 붙이는 것은 대화뿐입니다.
      interview.history = [...interview.history, ...asJsonb(turn)];
      interview.updatedAt = new Date();
      return "saved";
    },

    async listInterviews(githubUserId) {
      return [...interviews.values()]
        .flatMap((interview) => {
          const analysis = ownedBy(interview, githubUserId);
          return analysis ? [toListItem(interview, analysis)] : [];
        })
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },

    async getInterview(id, githubUserId) {
      const interview = interviews.get(id);
      if (!interview) return null;
      const analysis = ownedBy(interview, githubUserId);
      if (!analysis) return null;
      // 이 호출이 곧 "인터뷰를 여는 것"입니다. 갱신하지 않으면 90일 정리가 쓰는 인터뷰를 지웁니다.
      interview.openedAt = new Date();
      return {
        ...toListItem(interview, analysis),
        analysisId: interview.analysisId,
        candidateKey: interview.candidateKey,
        evidence: interview.evidence,
        history: interview.history,
        blockState: interview.blockState,
        blockVersion: interview.blockVersion,
        progress: interview.progress,
        candidate: storedCandidate(analysis, interview.candidateKey),
      };
    },

    async completeInterview(id, githubUserId) {
      const interview = interviews.get(id);
      if (!interview || !ownedBy(interview, githubUserId)) return false;
      interview.status = "completed";
      return true;
    },

    async deleteInterview(id, githubUserId) {
      const interview = interviews.get(id);
      if (!interview || !ownedBy(interview, githubUserId)) return false;
      return interviews.delete(id);
    },

    async deleteUserData(githubUserId) {
      let deleted = 0;
      for (const [id, analysis] of analyses) {
        if (analysis.githubUserId !== githubUserId) continue;
        // 실제 구현에서는 `on delete cascade`가 하는 일입니다. 흉내 내지 않으면 지운 분석에 딸린
        // 인터뷰가 메모리에 남아 목록과 복원에 계속 보입니다.
        for (const [interviewId, interview] of interviews) {
          if (interview.analysisId === id) interviews.delete(interviewId);
        }
        analyses.delete(id);
        deleted += 1;
      }
      return deleted;
    },

    async purgeInterviewsOpenedBefore(before) {
      let purged = 0;
      for (const [id, interview] of interviews) {
        if (interview.openedAt < before) {
          interviews.delete(id);
          purged += 1;
        }
      }
      return purged;
    },

    async purgeAnalysesWithoutInterviews(before) {
      const used = new Set([...interviews.values()].map((interview) => interview.analysisId));
      let purged = 0;
      for (const [id, analysis] of analyses) {
        if (!used.has(id) && analysis.createdAt < before) {
          analyses.delete(id);
          purged += 1;
        }
      }
      return purged;
    },
  };
}

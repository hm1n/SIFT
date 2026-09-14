import { randomUUID } from "node:crypto";
import type {
  AppendTurn,
  AppendTurnResult,
  InterviewListItem,
  NewAnalysis,
  NewInterview,
  SiftStore,
  StoredInterview,
} from "./store";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import type { InterviewHistoryMessage } from "@/features/interview/history";

interface AnalysisRow extends NewAnalysis {
  readonly id: string;
}

interface InterviewRow extends NewInterview {
  readonly id: string;
  history: InterviewHistoryMessage[];
  blockState: StoredInterview["blockState"];
  blockVersion: number;
  status: StoredInterview["status"];
  createdAt: Date;
  updatedAt: Date;
  openedAt: Date;
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
      analyses.set(id, { ...input, id });
      return id;
    },

    async createInterview(input) {
      const id = randomUUID();
      interviews.set(id, {
        ...input,
        id,
        history: [],
        blockState: emptyExperienceBlockState(),
        blockVersion: 0,
        status: "in_progress",
        createdAt: new Date(),
        updatedAt: new Date(),
        openedAt: new Date(),
      });
      return id;
    },

    async appendTurn({ interviewId, turn, blockState, expectedBlockVersion }: AppendTurn): Promise<AppendTurnResult> {
      const interview = interviews.get(interviewId);
      if (!interview) return "not_found";
      if (interview.blockVersion !== expectedBlockVersion) return "version_conflict";
      interview.history = [...interview.history, ...turn];
      interview.blockState = blockState;
      interview.blockVersion = blockState.version;
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
      };
    },

    async deleteInterview(id, githubUserId) {
      const interview = interviews.get(id);
      if (!interview || !ownedBy(interview, githubUserId)) return false;
      return interviews.delete(id);
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
  };
}

import type { ExperienceBlockState } from "@/features/experience-block/types";
import type { InterviewHistoryMessage } from "@/features/interview/history";

/**
 * 저장 계층의 계약입니다. 표 두 개의 모양은 기능 정의서 `인터뷰 저장과 이어가기`에 있고, 여기 있는
 * 연산은 그 문서의 "저장 시점" 표에서 그대로 옵니다.
 *
 * 인터페이스를 두는 이유는 테스트 때문입니다. 지금 `vitest` 테스트는 외부 상태 없이 돕니다. 라우트가
 * 이 타입을 매개변수로 받고 기본값으로 실제 구현을 쓰면, 테스트는 `createInMemoryStore()`를 넘겨
 * 데이터베이스 없이 그대로 돌 수 있습니다. 라우트가 `GenerateBlockUpdate`를 받는 방식과 같습니다.
 *
 * 실제 저장과 복원은 이 이슈의 범위가 아닙니다. Neon 구현체는 첫 호출 지점이 생기는 이슈에서 넣습니다.
 */
export interface SiftStore {
  saveAnalysis(input: NewAnalysis): Promise<string>;
  createInterview(input: NewInterview): Promise<string>;
  /**
   * 그 턴에 오간 질문과 답변만 뒤에 이어 붙이고 블록 상태를 덮어씁니다.
   *
   * 이어 붙이는 이유는 서버가 매 턴 받는 이력이 최근 것만 실린 것일 수 있기 때문입니다. 받은 그대로
   * 덮어쓰면 저장된 대화의 중간이 사라집니다.
   *
   * `expectedBlockVersion`이 저장된 값과 다르면 아무것도 쓰지 않고 `version_conflict`를 돌려줍니다.
   * 다른 탭이 먼저 저장한 경우입니다.
   */
  appendTurn(input: AppendTurn): Promise<AppendTurnResult>;
  listInterviews(githubUserId: number): Promise<InterviewListItem[]>;
  /** 다른 사용자의 것이면 `null`입니다. 읽은 뒤에 비교하지 않고 조회 조건에 사용자 번호를 넣습니다. */
  getInterview(id: string, githubUserId: number): Promise<StoredInterview | null>;
  /** 지운 것이 없으면 `false`입니다. 없는 경우와 남의 것인 경우를 구분하지 않습니다. */
  deleteInterview(id: string, githubUserId: number): Promise<boolean>;
  /** 마지막으로 연 시각이 `before`보다 오래된 인터뷰를 지우고 지운 수를 돌려줍니다. */
  purgeInterviewsOpenedBefore(before: Date): Promise<number>;
}

export interface NewAnalysis {
  readonly githubUserId: number;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly contributionItems: unknown;
  readonly candidates: unknown;
  readonly stageASummary: unknown;
}

export interface NewInterview {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly title: string;
  readonly evidence: unknown;
}

export interface AppendTurn {
  readonly interviewId: string;
  readonly turn: readonly InterviewHistoryMessage[];
  readonly blockState: ExperienceBlockState;
  readonly expectedBlockVersion: number;
}

export type AppendTurnResult = "saved" | "version_conflict" | "not_found";

export type InterviewStatus = "in_progress" | "completed";

export interface InterviewListItem {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly title: string;
  readonly status: InterviewStatus;
  readonly openedAt: Date;
}

export interface StoredInterview extends InterviewListItem {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly evidence: unknown;
  readonly history: readonly InterviewHistoryMessage[];
  readonly blockState: ExperienceBlockState;
  readonly blockVersion: number;
}

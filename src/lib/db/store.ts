import type { InterviewProgress } from "@/features/experience-block/progress";
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
 * 구현은 둘입니다. 테스트가 쓰는 `createInMemoryStore()`와 실제 경로가 쓰는 `neonStore()`입니다. 둘이
 * 같은 판정을 하는지는 `scripts/verify-neon-store.mts`가 실제 Neon을 상대로 확인합니다.
 *
 * `unknown`으로 둔 칸은 표의 jsonb로 갑니다. `JSON.stringify`가 그대로 다룰 수 있는 값이어야 합니다.
 * `undefined`와 `bigint`와 함수와 순환 참조는 들어갈 수 없습니다. 타입으로 막지 않고 메모리 구현이
 * 저장할 때 JSON을 한 번 거쳐 걸러냅니다. `JsonValue` 같은 재귀 타입을 쓰면 기존 인터페이스가 그
 * 타입에 대입되지 않아 호출하는 쪽마다 캐스팅이 붙고, 캐스팅이 붙는 순간 검사가 무력해집니다.
 *
 * 읽기와 쓰기를 가리지 않고 모든 연산이 `githubUserId`를 받습니다. 정리 작업인
 * `purgeInterviewsOpenedBefore`만 예외입니다. 소유자 판정을 호출하는 쪽에 맡기지 않고 조회와 갱신
 * 조건에 함께 넣습니다. 읽고 나서 비교하는 방식이면 비교를 빠뜨린 경로가 하나만 있어도 남의 데이터를
 * 읽거나 쓰게 됩니다.
 */
export interface SiftStore {
  saveAnalysis(input: NewAnalysis): Promise<string>;
  /** 분석이 없거나 그 사용자의 것이 아니면 `null`입니다. 남의 분석에 인터뷰를 붙일 수 없습니다. */
  createInterview(input: NewInterview): Promise<string | null>;
  /**
   * 그 턴에 오간 질문과 답변만 뒤에 이어 붙이고 블록 상태를 덮어씁니다.
   *
   * 이어 붙이는 이유는 서버가 매 턴 받는 이력이 최근 것만 실린 것일 수 있기 때문입니다. 받은 그대로
   * 덮어쓰면 저장된 대화의 중간이 사라집니다.
   *
   * `expectedBlockVersion`이 저장된 값과 다르면 아무것도 쓰지 않고 `version_conflict`를 돌려줍니다.
   * 다른 탭이 먼저 저장한 경우입니다.
   *
   * `blockState.version`이 `expectedBlockVersion`보다 크지 않을 때도 `version_conflict`입니다.
   * 기대 버전만 보면 저장된 버전과 기대 버전과 새 버전이 모두 같은 요청이 몇 번이고 성공하고 버전이
   * 오르지 않습니다. 그러면 다른 탭이 먼저 저장해도 막지 못합니다.
   *
   * **정확히 1 큰 값을 요구하지 않습니다.** 2026-09-14에 이슈 #115에서 고쳤습니다. 저장이 한 번
   * 실패하면 화면의 블록 버전만 오르고 저장된 버전은 그대로 있어, 다음 턴의 새 버전이 기대 버전보다
   * 2 이상 커집니다. "정확히 1"을 요구하면 그 요청도 거절되므로 한 번 실패한 인터뷰는 그 뒤로 영원히
   * 저장되지 않고, 정의서가 정한 "다음 턴에서 저장이 성공하면 밀린 내용까지 함께 저장된다"가 성립하지
   * 않습니다. 버전이 오르지 않는 요청을 막는다는 원래 목적은 "크다" 조건만으로 그대로 지켜집니다.
   *
   * 인터뷰가 없거나 그 사용자의 것이 아니면 `not_found`입니다. 둘을 구분하지 않습니다.
   *
   * 저장에 성공하면 `updatedAt`을 갱신합니다.
   *
   * `progress`는 이 턴을 반영한 뒤의 질문 진행 상태입니다. 블록 상태와 함께 덮어씁니다. 이력처럼
   * 이어 붙이지 않는 이유는 누적된 값 자체가 최신 상태이기 때문입니다.
   */
  appendTurn(input: AppendTurn): Promise<AppendTurnResult>;
  /** 마지막으로 이어간 시각이 최근인 순서입니다. */
  listInterviews(githubUserId: number): Promise<InterviewListItem[]>;
  /**
   * 다른 사용자의 것이면 `null`입니다. 읽은 뒤에 비교하지 않고 조회 조건에 사용자 번호를 넣습니다.
   *
   * 읽기이지만 `openedAt`을 갱신하고 갱신된 값을 돌려줍니다. 이 호출이 곧 "인터뷰를 여는 것"이고,
   * `openedAt`이 90일 자동 정리의 기준이기 때문입니다. 갱신하지 않으면 매일 여는 인터뷰도 만든 지
   * 90일이면 지워집니다.
   */
  getInterview(id: string, githubUserId: number): Promise<StoredInterview | null>;
  /**
   * 인터뷰를 끝난 것으로 표시합니다. 바꾼 것이 없으면 `false`입니다(이슈 #115).
   *
   * 턴 저장에 얹지 않고 따로 둡니다. 인터뷰를 끝내는 조작은 답변 제출과 함께 오지 않고, 마지막 답변
   * 뒤에 사용자가 따로 누르거나 턴 상한에 닿아 저절로 일어납니다. 얹을 요청이 없는 시점입니다.
   *
   * 진행도로 대신 판정하지 않습니다. 블록 넷이 다 차지 않아도 사용자는 인터뷰를 끝낼 수 있고, 그
   * 인터뷰를 목록이 계속 진행 중으로 보이면 화면의 기호와 버튼 문구가 사실과 어긋납니다.
   */
  completeInterview(id: string, githubUserId: number): Promise<boolean>;
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
  readonly githubUserId: number;
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly title: string;
  readonly evidence: unknown;
}

export interface AppendTurn {
  readonly githubUserId: number;
  readonly interviewId: string;
  readonly turn: readonly InterviewHistoryMessage[];
  readonly blockState: ExperienceBlockState;
  readonly progress: InterviewProgress;
  readonly expectedBlockVersion: number;
}

export type AppendTurnResult = "saved" | "version_conflict" | "not_found";

export type InterviewStatus = "in_progress" | "completed";

/**
 * 시간 칸이 셋이고 뜻이 각각 다릅니다. 표의 `created_at`, `updated_at`, `opened_at`에 맞닿습니다.
 *
 * - `createdAt`은 인터뷰를 만든 때입니다. 바뀌지 않습니다.
 * - `updatedAt`은 마지막으로 이어간 때입니다. `appendTurn`이 갱신하고, 목록이 화면에 보이는 값입니다.
 * - `openedAt`은 마지막으로 연 때입니다. `getInterview`가 갱신하고, 90일 자동 정리의 기준입니다.
 *
 * 하나로 합치지 않는 이유는 둘의 쓰임이 다르기 때문입니다. 목록에서 고르기만 하고 답을 달지 않아도
 * 사용자는 그 인터뷰를 쓰고 있으므로 정리 대상이 아니어야 합니다.
 */
export interface InterviewListItem {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly title: string;
  readonly status: InterviewStatus;
  /**
   * 충분하다고 평가된 블록 수입니다. 목록 행의 `PAAR n/4`에서 n입니다. 분모는 `BLOCK_KINDS.length`입니다.
   *
   * 블록 상태 전체를 목록에 싣지 않고 이 수만 셉니다. 목록은 저장된 인터뷰를 전부 돌려주는데, 인터뷰
   * 하나의 블록 상태에는 주장과 표시 문장이 모두 들어 있어 목록 응답이 화면이 쓰지 않는 값으로 부풉니다.
   */
  readonly completedBlockCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly openedAt: Date;
}

export interface StoredInterview extends InterviewListItem {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly evidence: unknown;
  readonly history: readonly InterviewHistoryMessage[];
  readonly blockState: ExperienceBlockState;
  readonly blockVersion: number;
  /**
   * 질문 진행 상태입니다. 블록의 요소마다 몇 번 물었는지와 언제 처음 "기억나지 않는다"를 받았는지를
   * 담고, 그 값이 재질문 예산을 정합니다.
   *
   * 정의서의 SQL에 없던 칸을 2026-09-14에 더했습니다. 저장하지 않으면 복원한 인터뷰가 사용자가 이미
   * 답하지 못한 요소를 예산만큼 다시 묻습니다. 블록 상태의 평가는 블록이 충분한지만 말하고 그 요소를
   * 몇 번 물었는지는 말하지 않으므로 대신 쓸 수 없습니다.
   */
  readonly progress: InterviewProgress;
  /**
   * 저장된 분석에서 이 인터뷰가 가리키는 후보 하나입니다. 찾지 못하면 `null`입니다(이슈 #115).
   *
   * 이어가기 화면이 기술 토픽과 선정 이유를 그리는 데 씁니다. 근거 스냅샷에는 커밋과 파일만 있고 그
   * 값들이 없습니다. 분석 전체를 실어 보내지 않고 이 후보 하나만 고르는 이유는, 저장된 분석에 다른
   * 후보와 그들이 가리키는 커밋이 모두 들어 있어 화면이 쓰지 않는 값이 응답의 대부분이 되기 때문입니다.
   */
  readonly candidate: unknown;
}

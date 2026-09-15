import { sendGaEvent, setGaParams } from "@/lib/analytics/ga";
import type {
  AnalysisEmptyKind,
  AnalysisError,
  AnalysisStage,
  RecoveryAction,
} from "@/features/repository-analysis/repository-analysis";
import type { ExperienceInterviewEndReason } from "@/features/experience-block/use-experience-interview";

/**
 * GA4로 나가는 퍼널 이벤트의 어휘입니다. 전송은 `lib/analytics/ga.ts`가 하고 여기는 무엇을 어떤
 * 이름으로 보낼지만 정합니다.
 *
 * 값을 계측용으로 새로 짓지 않고 코드에 이미 있는 유니온에서 가져옵니다. `AnalysisStage`,
 * `AnalysisEmptyKind`, `AnalysisError["kind"]`, `RecoveryAction`이 그대로 파라미터 타입이 됩니다.
 * 계측 전용 문자열을 따로 지으면 분류가 늘거나 바뀔 때 화면 안내와 계측이 조용히 갈라지고, 타입에서
 * 유도하면 컴파일이 누락을 잡습니다(이슈 #125 Approach).
 *
 * 이슈 #125가 1차 퍼널 10종을 담고 이슈 #126이 인터뷰 안쪽을 잇습니다. `candidate_confirmed`와
 * 후보 탐색 2종은 아직 없습니다. 셋 다 후보 화면의 구조에 직접 붙는데 그 화면이 master-detail로
 * 바뀌면서 첫 후보가 자동으로 선택되어, "상세를 열었다"가 사용자의 액션이 아니게 되었습니다.
 * 화면 개편이 확정된 뒤에 정의부터 다시 잡습니다
 * (`llm-wiki/wiki/2026-09-15-GA4-계측-후속-backlog.md` 2번).
 */

/** 재시도가 후보 생성부터인지 분석 전체부터인지입니다. 화면의 재시도 라벨과 같은 근거로 갈립니다. */
export type RetryScope = "candidate_generation" | "full_analysis";

/** 커밋 수 버킷입니다. 원값을 보내면 GA4 리포트에서 other로 뭉쳐 쓸 수 없게 됩니다. */
export type CommitCountBucket = "0-50" | "51-200" | "201-1000" | "1000+";

/**
 * 인터뷰에 닿은 경로입니다. 새 분석을 돌려서 온 것과 저장된 인터뷰를 이어가는 것을 가릅니다.
 *
 * 이 값이 없으면 리포트에서 인터뷰 시작 수가 분석 성공 수보다 커 보이고, 그것을 모르고 보면 분석
 * 단계에 문제가 있다고 읽게 됩니다. 저장된 인터뷰를 잇는 경로가 `analysis_requested`부터
 * `analysis_succeeded`까지를 하나도 거치지 않기 때문입니다(이슈 #115 이후,
 * `llm-wiki/wiki/2026-09-15-GA4-계측-후속-backlog.md` 3번).
 */
export type EntryPath = "new_analysis" | "resumed_interview";

export type AnalyticsEvent =
  | { name: "login_view"; auth_error?: string }
  | { name: "login_start" }
  | { name: "login_result"; success: boolean; error_kind?: string }
  | { name: "repo_list_loaded"; repo_count: number; duration_ms: number }
  | { name: "analysis_requested"; contribution_item_count: number }
  | { name: "analysis_stage_done"; stage: AnalysisStage; duration_ms: number }
  | {
      name: "analysis_succeeded";
      candidate_count: number;
      commit_count_bucket: CommitCountBucket;
      duration_ms: number;
    }
  | { name: "analysis_empty"; empty_kind: AnalysisEmptyKind }
  | {
      name: "analysis_failed";
      error_kind: AnalysisError["kind"];
      recovery: RecoveryAction;
      stage?: AnalysisStage;
    }
  | { name: "analysis_retried"; error_kind: AnalysisError["kind"]; retry_scope: RetryScope }
  /**
   * 대화가 열린 순간입니다. `turn`은 그 시점까지 확정된 턴 수로, 새 인터뷰는 0이고 이어가기는
   * 저장된 턴 수입니다.
   *
   * 어느 경로로 왔는지는 파라미터로 싣지 않습니다. `entry_path`가 공통 파라미터라 이 이벤트에도
   * 그대로 붙습니다(`repo_visibility`를 `analysis_requested`에 싣지 않는 것과 같은 이유).
   */
  | { name: "interview_started"; turn: number }
  /**
   * 대화가 끝난 자리입니다. 셋을 가려 세면 나가려다 돌아온 비율과, 그만둔 시점의 성과가 함께
   * 보입니다.
   *
   * `filled_blocks`는 그 시점에 문장이 들어 있는 경험 블록 수입니다. 채운 뒤에 떠났다면 목적을
   * 이루고 나간 것이고 비어 있다면 인터뷰가 실패한 것이라, 이 값이 없으면 이탈 건수를 해석할 수
   * 없습니다(이슈 #126 Why). 화면의 `PAAR n/4`와 같은 함수를 봅니다.
   */
  | { name: "interview_completed"; end_reason: ExperienceInterviewEndReason; turn: number; filled_blocks: number }
  | { name: "interview_abandoned"; turn: number; filled_blocks: number }
  | { name: "interview_leave_canceled"; turn: number; filled_blocks: number };

/**
 * 이벤트 하나를 보냅니다. 화면 컴포넌트는 이 함수와 아래 세터만 부르고 `window.gtag`를 직접 부르지
 * 않습니다. 판정과 파라미터 구성을 테스트로 고정하기 위해서입니다(이슈 #125 Approach).
 *
 * 여기서도 예외를 삼킵니다. 전송부가 이미 삼키지만, 이 함수는 데이터 조회 함수 안에서도 불립니다
 * (`repository-client.ts`). 그런 자리에서 던지면 계측 실패가 조회 실패가 되어 사용자에게 오류
 * 화면이 뜹니다. 계측 실패가 서비스 오류로 보이면 안 됩니다(이슈 #125 제약).
 */
export function trackEvent(event: AnalyticsEvent): void {
  try {
    const { name, ...params } = event;
    sendGaEvent(name, params);
  } catch {
    // 계측이 죽는 것이 화면이 죽는 것보다 낫습니다.
  }
}

/** 이 페이지에서 `user_id`를 실제로 세운 적이 있는지입니다. 아래 주석이 이 값이 필요한 이유입니다. */
let userIdApplied = false;

/**
 * `user_id`입니다. `githubUserId`를 서버에서 HMAC으로 변환한 값이고 로그인 전에는 붙지 않습니다.
 * 변환은 `lib/analytics/user-id.ts`가 하고 값은 `src/app/page.tsx`가 prop으로 내려보냅니다.
 *
 * 값이 없을 때 gtag를 부르지 않습니다. `gtag('set', { user_id: null })`을 부르면 gtag가 그 자리를
 * 빈 문자열로 직렬화해 이후 모든 이벤트에 `uid=`를 실어 보냅니다. 2026-09-15에 실제 수집 요청을
 * 가로채 확인했습니다. 로그인 전에는 붙지 않아야 하므로 아예 세우지 않습니다.
 *
 * 한 번이라도 세운 뒤에 비우는 경우는 지웁니다. 로그아웃은 새로고침 없이 서버 컴포넌트만 다시
 * 그리므로, 지우지 않으면 로그아웃한 사용자의 이벤트에 앞 사용자의 `user_id`가 계속 붙습니다.
 */
export function setAnalyticsUser(userId: string | null): void {
  if (userId === null && !userIdApplied) return;
  userIdApplied = userId !== null;
  safelySetGaParams({ user_id: userId });
}

/** 흐름 공통 파라미터를 실제로 세운 적이 있는지입니다. `userIdApplied`와 같은 이유로 필요합니다. */
let flowApplied = false;

/**
 * 저장소 문맥(`repo_visibility`, `repo_language`)을 세운 적이 있는지입니다. `flowApplied`와 따로
 * 둡니다. 저장된 인터뷰를 잇는 흐름은 흐름을 세우면서도 저장소 문맥은 세우지 않기 때문입니다.
 *
 * 로그인하자마자 저장된 인터뷰를 이어가면 분석을 한 번도 하지 않은 채 흐름이 시작됩니다. 그때 두
 * 값을 한 가드로 묶어 두면 세운 적 없는 저장소 문맥을 null로 지우게 되고, gtag가 그 자리를 빈
 * 문자열로 직렬화해 이후 모든 이벤트에 실어 보냅니다.
 */
let repoContextApplied = false;

function newFlowId(): string | null {
  try {
    return crypto.randomUUID();
  } catch {
    return null;
  }
}

/**
 * 흐름 하나를 묶는 공통 파라미터입니다. 흐름을 시작할 때 세우고 Repository 선택으로 돌아가거나
 * 로그아웃하면 비웁니다.
 *
 * 흐름은 두 갈래입니다. 분석을 돌려 후보를 고르는 갈래와 저장된 인터뷰를 이어가는 갈래이고,
 * `entry_path`가 둘을 가릅니다. 저장 경로가 생기기 전에는 앞 갈래뿐이라 이 함수 이름도
 * `startAnalysisFlow`였습니다.
 *
 * `repo_visibility`와 `repo_language`를 `analysis_requested`의 파라미터로 따로 싣지 않고 여기서
 * 세웁니다. 공통 파라미터는 이후 모든 이벤트에 붙으므로 `analysis_requested`에도 그대로 실리고,
 * 뒤따르는 분석 이벤트까지 같은 값을 갖게 됩니다.
 *
 * 발급 시점을 저장소를 고른 순간이 아니라 분석을 시작하는 순간으로 둡니다. "한 번의 흐름을 묶는
 * 값"이라는 정의에 맞고, 화면 순서가 바뀌어도 분석 시작이라는 액션은 남기 때문입니다. 이어가기는
 * 저장된 인터뷰를 여는 순간입니다.
 *
 * `flow_id`를 부르는 쪽에서 받지 않고 여기서 만듭니다. `crypto.randomUUID`는 보안 컨텍스트
 * (HTTPS와 localhost)에만 있어서, LAN 주소로 띄운 개발 서버처럼 없는 곳에서는 부르는 순간
 * 던집니다. 화면 쪽에서 만들면 그 예외가 이 모듈의 try/catch 바깥이라 분석 시작 자체를 막습니다.
 *
 * 만들지 못한 경우에 저장소 문맥까지 함께 잃지 않습니다. 둘을 한 try 안에 두면 `flow_id` 생성 실패가
 * `repo_visibility`·`repo_language` 설정을 건너뛰게 만들고, 곧바로 나가는 `analysis_requested`가
 * 저장소 문맥 없이 전송됩니다(PR #129 리뷰). 묶는 값이 없을 뿐 나머지는 그대로 붙어야 합니다.
 */
export type FlowStart =
  | { readonly entryPath: "new_analysis"; readonly repoVisibility: string; readonly repoLanguage: string | null }
  | { readonly entryPath: "resumed_interview" };

export function startFlow(flow: FlowStart): void {
  const flowId = newFlowId();
  // `flow_id`를 못 만들어도 나머지는 세우므로 지울 것이 생긴 것은 마찬가지입니다.
  flowApplied = true;
  safelySetGaParams({
    // 만들지 못했으면 아예 싣지 않습니다. 빈 값을 세우면 서로 다른 흐름이 같은 값으로 묶입니다.
    ...(flowId === null ? {} : { flow_id: flowId }),
    entry_path: flow.entryPath,
    ...repoContextFor(flow),
  });
}

/**
 * 저장된 인터뷰에는 공개 여부와 언어가 없습니다. 그 값은 GitHub 목록 조회에서 오는 것이고 저장하지
 * 않으므로 이어가기 경로에서 되살릴 수 없습니다. 앞 분석이 세워 둔 값을 그대로 두면 이어가는
 * 인터뷰의 이벤트가 엉뚱한 저장소의 문맥을 달고 나가므로 지웁니다.
 */
function repoContextFor(flow: FlowStart): Record<string, string | null> {
  if (flow.entryPath === "new_analysis") {
    repoContextApplied = true;
    // 언어가 없는 저장소가 있습니다. 빈 문자열 대신 파라미터를 지워 값 없음과 값 있음을 가릅니다.
    return { repo_visibility: flow.repoVisibility, repo_language: flow.repoLanguage };
  }
  if (!repoContextApplied) return {};
  repoContextApplied = false;
  return { repo_visibility: null, repo_language: null };
}

/**
 * 흐름 묶음을 지웁니다. Repository 선택으로 돌아갈 때와 로그아웃할 때 부릅니다.
 *
 * 한 번도 세운 적이 없으면 아무 일도 하지 않습니다. `gtag('set', { flow_id: null })`을 부르면 gtag가
 * 그 자리를 빈 문자열로 직렬화해 이후 모든 이벤트에 실어 보냅니다. `user_id`에서 실측한 것과 같은
 * 동작이고(2026-09-15), 이 가드가 없으면 로그인 화면처럼 흐름을 시작한 적 없는 자리에서 지우기를
 * 부를 수 없습니다.
 */
export function clearFlow(): void {
  if (!flowApplied) return;
  flowApplied = false;
  const repoContext: Record<string, null> = repoContextApplied
    ? { repo_visibility: null, repo_language: null }
    : {};
  repoContextApplied = false;
  safelySetGaParams({ flow_id: null, entry_path: null, ...repoContext });
}

/** 공통 파라미터 설정도 이벤트 전송과 같은 이유로 예외를 삼킵니다. */
function safelySetGaParams(params: Parameters<typeof setGaParams>[0]): void {
  try {
    setGaParams(params);
  } catch {
    // 계측이 죽는 것이 화면이 죽는 것보다 낫습니다.
  }
}

/**
 * 버킷 경계입니다. 0-50, 51-200, 201-1000, 1000+이므로 1000은 `201-1000`이고 1001부터 `1000+`입니다.
 */
export function commitCountBucket(count: number): CommitCountBucket {
  if (count <= 50) return "0-50";
  if (count <= 200) return "51-200";
  if (count <= 1000) return "201-1000";
  return "1000+";
}

import { sendGaEvent, setGaParams } from "@/lib/analytics/ga";
import type {
  AnalysisEmptyKind,
  AnalysisError,
  AnalysisStage,
  RecoveryAction,
} from "@/features/repository-analysis/repository-analysis";

/**
 * GA4로 나가는 퍼널 이벤트의 어휘입니다. 전송은 `lib/analytics/ga.ts`가 하고 여기는 무엇을 어떤
 * 이름으로 보낼지만 정합니다.
 *
 * 값을 계측용으로 새로 짓지 않고 코드에 이미 있는 유니온에서 가져옵니다. `AnalysisStage`,
 * `AnalysisEmptyKind`, `AnalysisError["kind"]`, `RecoveryAction`이 그대로 파라미터 타입이 됩니다.
 * 계측 전용 문자열을 따로 지으면 분류가 늘거나 바뀔 때 화면 안내와 계측이 조용히 갈라지고, 타입에서
 * 유도하면 컴파일이 누락을 잡습니다(이슈 #125 Approach).
 *
 * 이슈 #125는 1차 범위인 퍼널 이벤트 12종 가운데 10종을 다룹니다. `candidate_confirmed`와
 * `interview_started`는 화면 구조에 직접 붙어 있어 화면 개편 확정 뒤로 미뤘습니다. 경위는
 * `llm-wiki/wiki/2026-09-15-GA4-계측-후속-backlog.md` 2번에 있습니다.
 */

/** 재시도가 후보 생성부터인지 분석 전체부터인지입니다. 화면의 재시도 라벨과 같은 근거로 갈립니다. */
export type RetryScope = "candidate_generation" | "full_analysis";

/** 커밋 수 버킷입니다. 원값을 보내면 GA4 리포트에서 other로 뭉쳐 쓸 수 없게 됩니다. */
export type CommitCountBucket = "0-50" | "51-200" | "201-1000" | "1000+";

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
  | { name: "analysis_retried"; error_kind: AnalysisError["kind"]; retry_scope: RetryScope };

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

/**
 * 분석 한 번을 묶는 공통 파라미터입니다. 분석을 시작할 때 세우고 저장소를 바꾸면 비웁니다.
 *
 * `repo_visibility`와 `repo_language`를 `analysis_requested`의 파라미터로 따로 싣지 않고 여기서
 * 세웁니다. 공통 파라미터는 이후 모든 이벤트에 붙으므로 `analysis_requested`에도 그대로 실리고,
 * 뒤따르는 분석 이벤트까지 같은 값을 갖게 됩니다.
 *
 * 발급 시점을 저장소를 고른 순간이 아니라 분석을 시작하는 순간으로 둡니다. "분석 한 번을 묶는
 * 값"이라는 정의에 맞고, 화면 순서가 바뀌어도 분석 시작이라는 액션은 남기 때문입니다.
 *
 * `flow_id`를 부르는 쪽에서 받지 않고 여기서 만듭니다. `crypto.randomUUID`는 보안 컨텍스트
 * (HTTPS와 localhost)에만 있어서, LAN 주소로 띄운 개발 서버처럼 없는 곳에서는 부르는 순간
 * 던집니다. 화면 쪽에서 만들면 그 예외가 이 모듈의 try/catch 바깥이라 분석 시작 자체를 막습니다.
 * 계측이 만드는 값은 계측 안에서 만들고, 못 만들면 이 분석에는 `flow_id`가 붙지 않습니다.
 */
export function startAnalysisFlow(flow: { repoVisibility: string; repoLanguage: string | null }): void {
  try {
    setGaParams({
      flow_id: crypto.randomUUID(),
      repo_visibility: flow.repoVisibility,
      // 언어가 없는 저장소가 있습니다. 빈 문자열 대신 파라미터를 지워 값 없음과 값 있음을 가릅니다.
      repo_language: flow.repoLanguage,
    });
  } catch {
    // 계측이 죽는 것이 화면이 죽는 것보다 낫습니다.
  }
}

export function clearAnalysisFlow(): void {
  safelySetGaParams({ flow_id: null, repo_visibility: null, repo_language: null });
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

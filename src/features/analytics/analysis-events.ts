import {
  analysisStageOf,
  type AnalysisStage,
  type AnalysisState,
} from "@/features/repository-analysis/repository-analysis";
import { commitCountBucket, type AnalyticsEvent } from "./events";

/**
 * 분석 상태 전이를 계측 이벤트로 옮깁니다. 순수 함수이고 전송은 부르는 쪽이 합니다.
 *
 * 이렇게 나눈 이유가 둘입니다.
 *
 * 첫째, `analysis_stage_done`은 상태가 실제로 다음 단계로 넘어갈 때만 나와야 합니다. 상세 조회
 * 단계는 커밋마다 진행률을 담아 `onStateChange`를 부르므로, 상태 변화마다 이벤트를 보내면 저장소
 * 하나에 수백 건이 나갑니다. 직전 단계를 기억하는 자리가 필요하고 그 자리가 여기입니다.
 *
 * 둘째, 화면에서 떼어 두면 Loading 화면을 어떻게 그리든 계측이 흔들리지 않습니다. 이 다섯 종은
 * `AnalysisState`라는 도메인 타입의 전이에만 의존하므로 체크리스트를 진행 막대로 바꾸든 단계 표기를
 * 줄이든 그대로입니다. 이슈 #125를 화면 개편 확정 전에 진행할 수 있는 근거이기도 합니다.
 */

export interface AnalysisTracker {
  /** 진행 중인 단계입니다. 아직 시작하지 않았거나 이미 끝났으면 null입니다. */
  readonly stage: AnalysisStage | null;
  readonly stageStartedAt: number;
  readonly analysisStartedAt: number;
}

export function createAnalysisTracker(now: number): AnalysisTracker {
  return { stage: null, stageStartedAt: now, analysisStartedAt: now };
}

interface Advance {
  readonly tracker: AnalysisTracker;
  readonly events: readonly AnalyticsEvent[];
}

/** 진행 중이던 단계가 끝났음을 알립니다. 시작 전이었으면 보낼 것이 없습니다. */
function stageDone(tracker: AnalysisTracker, now: number): readonly AnalyticsEvent[] {
  if (tracker.stage === null) return [];
  return [{ name: "analysis_stage_done", stage: tracker.stage, duration_ms: now - tracker.stageStartedAt }];
}

export function advanceAnalysisTracker(
  tracker: AnalysisTracker,
  next: AnalysisState,
  now: number
): Advance {
  switch (next.status) {
    case "idle":
      return { tracker, events: [] };

    case "loading": {
      const stage = analysisStageOf(next.loading);
      // 같은 단계의 진행률 갱신입니다. 상세 조회는 커밋마다 여기로 들어옵니다.
      if (tracker.stage === stage) return { tracker, events: [] };
      return {
        tracker: { ...tracker, stage, stageStartedAt: now },
        events: stageDone(tracker, now),
      };
    }

    case "success":
      return {
        tracker: { ...tracker, stage: null },
        events: [
          ...stageDone(tracker, now),
          {
            name: "analysis_succeeded",
            candidate_count: next.candidates.candidates.length,
            // 상세 조회한 커밋 수입니다. Loading 체크리스트가 사용자에게 보여주는 수와 같고,
            // 상세 조회와 Stage A 입력이 이 수에 비례하므로 소요 시간과 짝지어 볼 값입니다.
            commit_count_bucket: commitCountBucket(next.data.includedCommits.length),
            duration_ms: now - tracker.analysisStartedAt,
          },
        ],
      };

    case "empty":
      // 단계 자체는 끝났고 결과가 비어 있는 것이므로 그 단계의 완료도 함께 남깁니다.
      return {
        tracker: { ...tracker, stage: null },
        events: [...stageDone(tracker, now), { name: "analysis_empty", empty_kind: next.kind }],
      };

    case "error":
      // 실패한 단계는 끝난 것이 아니므로 `analysis_stage_done`을 보내지 않습니다. 어느 단계에서
      // 멈췄는지는 `analysis_failed`의 `stage`가 싣습니다.
      return {
        tracker: { ...tracker, stage: null },
        events: [
          {
            name: "analysis_failed",
            error_kind: next.error.kind,
            recovery: next.error.recovery,
            ...(tracker.stage === null ? {} : { stage: tracker.stage }),
          },
        ],
      };
  }
}

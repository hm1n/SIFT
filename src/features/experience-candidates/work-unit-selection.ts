import {
  scoreWorkUnit,
  sortByScoreDescending,
  type ScorableCommit,
  type WorkUnitSignal,
} from "./work-unit-score";
import { renderWorkUnitSummary, summarizeWorkUnit } from "./work-unit-summary";
import type { WorkUnit } from "./work-unit";
import { STAGE_A_MAX_UNITS } from "./stage-a";

/**
 * Stage A 한 번에 보낼 수 있는 작업 묶음의 프롬프트 바이트 상한입니다.
 *
 * **2026-09-01에 10,500에서 20,000으로 올렸습니다.**
 *
 * 10,500의 근거는 Groq 무료 등급의 분당 토큰 한도(TPM) 8,000이었습니다. 프롬프트 5,842바이트가
 * 총 3,949토큰이었고(입력·출력·추론 합계) 바이트당 0.676토큰이 관측 최대치라, 10,500바이트면 약
 * 7,100토큰으로 한도 대비 11퍼센트가 남는다는 계산이었습니다.
 *
 * 제공자를 Gemini로 옮기면서 그 벽이 사라졌습니다. 유료 등급은 분당 입력 4,000,000토큰이고 모델
 * 컨텍스트도 이 단계 입력과 비교할 크기가 아닙니다. 벽에서 나온 값이므로 벽과 함께 재산정합니다.
 * 근거 스냅샷 상한을 3,500에서 5,250으로 올린 것과 같은 이유이며, 그때 이 값이 빠졌습니다.
 *
 * 남겨 두면 지는 대가가 있습니다. `hm1n/demian`은 작업 묶음이 27개인데 10,500바이트에서는 12개만
 * 실리고 **15개가 `over_byte_budget`으로 제외됩니다.** 그 사유는 화면에 "한 번에 보낼 수 있는
 * 분량을 넘어 제외했습니다"로 나가는데, Gemini에서는 사실이 아닌 설명입니다.
 *
 * **2026-09-02에 20,000에서 110,000으로 다시 올렸습니다.** 20,000은 `demian` 27묶음(17,343바이트)
 * 하나로 정한 값이었고, `andbread`를 재자마자 모자랐습니다. 그 저장소는 66묶음 전량이
 * 35,550바이트인데 20,000에서는 10묶음만 실리고 **56묶음이 모델에 닿지 못했습니다.**
 *
 * 이제 이 값은 묶음 수 상한(`STAGE_A_MAX_UNITS` 200)을 담을 수 있는 크기로 정합니다. 실측에서
 * 200묶음이 109,333바이트였고 110,000은 그 값입니다. **바이트가 아니라 개수가 실질 상한입니다.**
 * 바이트로만 걸면 같은 상한이 저장소마다 다른 묶음 수를 뜻합니다. 묶음 하나의 크기가 저장소마다
 * 다르기 때문입니다. 근거와 측정은 `STAGE_A_MAX_UNITS`에 있습니다.
 *
 * 두 상한은 함께 움직여야 합니다. 어긋나면 선별 결과가 청크 둘로 갈리고, Groq의 분당 창에서 나온
 * 61초 대기가 되살아납니다(`STAGE_A_DEGRADED_WAIT_MS`). 회귀 테스트가 두 값이 같은지 고정합니다.
 */
export const STAGE_A_MAX_SELECTION_BYTES = 110_000;

/**
 * 묶음이 판단 대상에서 빠진 이유입니다.
 *
 * `over_input_budget`은 2026-09-02에 `below_score_threshold`에서 이름을 바꿨습니다. 옛 이름은
 * 점수가 어떤 고정 기준에 못 미쳤다는 뜻으로 읽히는데, 실제 방아쇠는 **입력 상한**입니다.
 * `andbread` 66묶음에서 56개가 이 사유로 빠졌고, 상한을 올리자 같은 56개가 전부 들어왔습니다.
 * 점수는 상한 안에서 무엇을 남길지 정하는 순서일 뿐 합격선이 아닙니다.
 */
export type WorkUnitSelectionExclusionReason = "over_input_budget" | "over_byte_budget";

export interface SelectedWorkUnit<TCommit extends ScorableCommit> {
  readonly unit: WorkUnit<TCommit>;
  readonly score: number;
}

export interface ExcludedWorkUnit<TCommit extends ScorableCommit>
  extends SelectedWorkUnit<TCommit> {
  readonly reason: WorkUnitSelectionExclusionReason;
  /**
   * 발화한 신호입니다. `scoreWorkUnit`이 이미 계산해 두는 값이고, 화면이 "왜 이 점수인지"를
   * 보여주려면 필요합니다. `selected`에는 화면이 쓰지 않아 싣지 않습니다.
   */
  readonly signals: readonly WorkUnitSignal[];
}

export interface WorkUnitSelection<TCommit extends ScorableCommit> {
  readonly selected: readonly SelectedWorkUnit<TCommit>[];
  readonly excluded: readonly ExcludedWorkUnit<TCommit>[];
  /**
   * 선택된 묶음 중 가장 낮은 점수입니다. 통계로만 씁니다. 선택이 개별 항목 단위로 이뤄지므로
   * 이 값보다 낮은 점수가 선택되고 이 값과 같거나 높은 점수가 제외될 수 있습니다. 화면에서
   * "N점 이상을 선택했다"는 합격선으로 설명하지 않습니다.
   */
  readonly thresholdScore: number;
  readonly bytes: number;
}

/** 사용자에게 보여줄 제외 사유 문구입니다. */
export const WORK_UNIT_SELECTION_EXCLUSION_COPY: Record<
  WorkUnitSelectionExclusionReason,
  string
> = {
  over_input_budget:
    "한 번에 판단할 수 있는 입력 상한 안에서 점수 순으로 골랐고, 이 묶음은 그 안에 들지 못했습니다",
  over_byte_budget: "이 묶음 하나가 한 번에 보낼 수 있는 분량을 혼자 넘습니다",
};

/**
 * Stage A에 보낼 작업 묶음을 점수 순으로 고릅니다.
 *
 * 묶음을 여러 청크로 쪼개 각 청크에 후보 쿼터를 나눠주던 방식을 대신합니다. 그 방식은 실측에서
 * 첫 시도 계약 준수가 6청크 중 2회(33퍼센트)였고, 청크 하나가 복구를 소진하면 이미 끝난 청크의
 * 결과까지 버리고 전체가 실패했습니다(`andbread` 66묶음 7청크 실측). 쿼터를 청크에 나눠주는
 * 것도 "어느 청크에 담겼는가"라는 우연이 선정을 좌우해 근거가 없었습니다.
 *
 * 점수 내림차순으로 정렬한 뒤 항목을 하나씩 순회하며 남은 예산에 들어가는지 개별로 봅니다.
 * 한 항목이 들어가지 않아도 뒤 항목은 계속 확인합니다. 그 결과 점수가 높고 요약이 큰 항목이
 * 빠지고 점수가 낮고 작은 항목이 들어갈 수 있습니다. **선택 결과는 "N점 이상"이라는 단일 점수
 * 경계로 설명되지 않습니다.**
 *
 * **2026-09-11 이전에는 동점 무리를 통째로 넣거나 뺐습니다.** 이슈 #101 측정에서
 * `hm1n/Algorithm`은 435개 커밋 중 1점 커밋 1개만 선택되고, 0점 커밋 434개가 하나의 동점
 * 무리로 묶여 개수 상한 200에 199자리가 남아 있었는데도 통째로 제외됐습니다. 점수는 제한된
 * 예산 안에서 처리 순서를 정할 뿐 경험의 유무를 확정하지 않으므로, 동점 무리 크기 때문에 남은
 * 예산을 쓰지 못하는 것은 의도한 동작이 아닙니다. 설계 경위는
 * `llm-wiki/raw/2026-09-11-Stage-A-개별-예산-선별-설계-session-log.md`에 있습니다.
 *
 * 제외된 묶음은 사유와 점수를 달아 그대로 돌려줍니다. 조용히 버리면 사용자가 자기 작업이 왜
 * 안 보이는지 알 수 없습니다.
 *
 * **바이트와 개수 두 상한을 함께 지킵니다.** 개수 상한이 여기 없으면 묶음 요약이 작은 저장소에서
 * 선별이 개수 상한을 넘는 결과를 내놓고, 그 결과를 `splitUnitsIntoChunks`가 청크 둘로 나눕니다.
 * 청크가 갈리면 Groq의 분당 창에서 나온 61초 대기가 되살아나 사용자가 근거 없이 1분을 기다립니다
 * (`STAGE_A_DEGRADED_WAIT_MS`). 선별이 두 상한을 모두 지키면 결과는 언제나 청크 하나입니다.
 */
export function selectWorkUnitsForStageA<TCommit extends ScorableCommit>(
  units: readonly WorkUnit<TCommit>[],
  maxBytes: number = STAGE_A_MAX_SELECTION_BYTES,
  maxUnits: number = STAGE_A_MAX_UNITS
): WorkUnitSelection<TCommit> {
  const scored = units.map((unit) => {
    const summary = summarizeWorkUnit(unit);
    const { score, signals } = scoreWorkUnit(unit, summary);
    return {
      unit,
      score,
      signals,
      bytes: Buffer.byteLength(renderWorkUnitSummary(summary), "utf8"),
    };
  });
  const ordered = sortByScoreDescending(scored, ({ score }) => score);

  const selected: SelectedWorkUnit<TCommit>[] = [];
  const excluded: ExcludedWorkUnit<TCommit>[] = [];
  let selectedBytes = 0;

  for (const { unit, score, signals, bytes } of ordered) {
    /**
     * 두 사유를 정확히 갈라야 화면 문구가 원인을 바로 지목합니다.
     *
     * `over_byte_budget`은 **이 묶음 하나가 혼자 전체 바이트 상한을 넘는** 경우입니다. 상한을
     * 올리지 않으면 이 묶음은 어떤 저장소에서도 들어가지 못합니다. 그 밖의 제외는 상한 안에
     * 자리(개수 또는 남은 바이트)가 없어서 밀린 것이고, 상한을 올리면 들어올 수 있습니다.
     */
    if (bytes > maxBytes) {
      excluded.push({ unit, score, signals, reason: "over_byte_budget" });
      continue;
    }
    // 이미 선택된 항목이 있으면 그 뒤에 줄바꿈 한 글자가 붙습니다. 첫 선택 항목에는 구분자가
    // 없습니다.
    const separator = selected.length > 0 ? 1 : 0;
    if (selected.length < maxUnits && selectedBytes + separator + bytes <= maxBytes) {
      selected.push({ unit, score });
      selectedBytes += separator + bytes;
      continue;
    }
    excluded.push({ unit, score, signals, reason: "over_input_budget" });
  }

  // 모든 묶음이 개별적으로 예산을 넘으면 selected는 빈 배열로 남습니다. 억지로 하나를 되살리지
  // 않습니다. 입력이 비면 호출부가 Stage A를 부르지 않고 빈 상태를 보여줍니다(Codex 리뷰 P2-2
  // 재발 방지).
  return {
    selected,
    excluded,
    thresholdScore: selected.length > 0 ? selected[selected.length - 1].score : 0,
    bytes: selectedBytes,
  };
}

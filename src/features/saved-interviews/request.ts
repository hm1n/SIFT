import { blockEditByteLength } from "@/features/experience-block/block-edits";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockKind, type DisplaySentence } from "@/features/experience-block/types";
import { isCandidate } from "@/features/experience-candidates/schema";
import { STAGE_B_MAX_TOTAL_PATCH_CHARS } from "@/features/experience-candidates/stage-b";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { isExperienceEvidenceSnapshot, SNAPSHOT_BODY_BYTES } from "@/features/interview/question-request";
import type { StoredAnalysis } from "@/features/repository-analysis/analysis-snapshot";
import type { SavedInterviewErrorKind } from "./errors";

/**
 * `POST /api/interviews`의 요청 본문입니다. 경험을 확정하는 순간 인터뷰 한 줄을 만듭니다.
 *
 * **이슈 #116에서 분석 저장이 빠졌습니다.** 이슈 #115에서는 분석 한 줄과 인터뷰 한 줄을 이 요청이
 * 함께 만들었습니다. 정의서가 정한 저장 시점(Stage B 성공 직후)으로 분석 저장을 옮기면서 "분석을
 * 만드는 일"과 "인터뷰를 붙이는 일"이 갈라졌고, 이 요청에는 `analysisId`만 남습니다.
 *
 * `analysisId`가 필수입니다. 예전에는 없으면 분석을 새로 저장했는데, 그 폴백이 두 가지를 낳았습니다.
 * 확정 요청이 겹치면 같은 분석이 두 줄로 쌓였고(backlog 9번), 남의 분석 식별자나 지워진 식별자를
 * 보내도 조용히 새 줄을 만들어 무엇이 저장됐는지가 요청만 보고는 정해지지 않았습니다. 지금은 가리킬
 * 분석이 없으면 거절하고, 분석을 먼저 저장하는 일은 화면이 합니다.
 */
export interface CreateInterviewRequestBody {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly title: string;
  readonly evidence: ExperienceEvidenceSnapshot;
}

/**
 * `POST /api/analyses`의 요청 본문입니다(이슈 #116). Stage B가 성공해 분석이 끝나는 순간 축약본
 * 한 줄을 만듭니다.
 *
 * 분석과 인터뷰의 요청 모양을 이 파일에 함께 둡니다. 분석 축약본의 모양 검사를 두 경로가 함께
 * 쓰다가 한쪽만 고치는 일을 막기 위해서입니다. 파일 이름이 인터뷰를 가리키는 것과 어긋나지만, 이름을
 * 바꾸면 오류 종류(`SavedInterviewErrorKind`)까지 함께 옮겨야 해서 이번 이슈에서는 두었습니다.
 */
export interface SaveAnalysisRequestBody {
  readonly analysis: StoredAnalysis;
}

/**
 * 분석 한 줄의 상한입니다.
 *
 * patch 본문은 Stage B가 총 `STAGE_B_MAX_TOTAL_PATCH_CHARS`자로 묶습니다. UTF-8에서 한 글자가
 * 최대 3바이트이므로 본문 몫의 상한은 그 세 배입니다. 나머지(후보 목록, 후보가 가리키는 커밋의
 * 메타데이터, Stage A 제외 묶음 요약)에 `SNAPSHOT_BODY_BYTES`와 같은 크기를 더 둡니다.
 *
 * 정의서는 분석 한 줄을 100KB 안쪽으로 봤는데, 그 계산은 patch가 한 글자에 한 바이트인 경우입니다.
 * 한글 주석과 문자열이 섞이면 세 배까지 커지므로 요청을 거절하는 상한은 최악을 기준으로 잡습니다.
 */
export const STORED_ANALYSIS_MAX_BYTES = STAGE_B_MAX_TOTAL_PATCH_CHARS * 3 + SNAPSHOT_BODY_BYTES;

/** 저장소 이름과 후보 키와 제목처럼 짧은 값의 몫입니다. */
const CREATE_INTERVIEW_META_BYTES = 4 * 1024;

/**
 * 인터뷰를 만드는 요청은 이제 분석 축약본을 싣지 않으므로(이슈 #116) 근거 스냅샷 몫만 남습니다.
 * 상한을 그대로 두면 분석 한 줄만 한 본문을 읽고 나서야 거절하게 됩니다.
 */
export const MAX_CREATE_INTERVIEW_BODY_BYTES = SNAPSHOT_BODY_BYTES + CREATE_INTERVIEW_META_BYTES;

export const MAX_SAVE_ANALYSIS_BODY_BYTES = STORED_ANALYSIS_MAX_BYTES + CREATE_INTERVIEW_META_BYTES;

export type ParsedCreateInterview =
  | { readonly ok: true; readonly body: CreateInterviewRequestBody }
  | {
      readonly ok: false;
      readonly kind: Extract<SavedInterviewErrorKind, "invalid_request">;
      readonly message: string;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(message: string): ParsedCreateInterview {
  return { ok: false, kind: "invalid_request", message };
}

/**
 * 모양만 봅니다. 여기 담기는 분석 결과와 근거 스냅샷은 그 사용자의 브라우저가 만들어 보낸 그 사용자의
 * 값이고, 저장한 뒤 그 사용자에게만 되돌려 줍니다. 값의 진위를 서버가 다시 따지지 않는 것은 이미 무상태
 * 서버 전제를 따르는 `experience-block` 경로와 같습니다.
 *
 * 근거 스냅샷만 예외로 깊이 봅니다. 이 값은 인터뷰를 복원할 때 화면과 프롬프트가 그대로 쓰므로, 모양이
 * 어긋난 채 저장되면 저장은 성공하고 복원에서만 깨집니다.
 */
export function parseCreateInterviewBody(value: unknown): ParsedCreateInterview {
  if (!isRecord(value)) return fail("요청 본문은 객체여야 합니다.");

  const { analysisId, candidateKey, title, evidence } = value;

  if (!isNonEmptyString(analysisId)) return fail("analysisId가 필요합니다.");
  if (!isNonEmptyString(candidateKey)) return fail("candidateKey가 필요합니다.");
  if (!isNonEmptyString(title)) return fail("title이 필요합니다.");
  if (!isExperienceEvidenceSnapshot(evidence)) return fail("evidence가 근거 스냅샷 모양이 아닙니다.");

  return { ok: true, body: { analysisId, candidateKey, title, evidence } };
}

/** 파일 한 줄입니다. 근거 화면이 경로와 상태와 증감 수치를 그대로 그립니다. */
function isStoredFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.status === "string" &&
    typeof value.additions === "number" &&
    typeof value.deletions === "number" &&
    typeof value.changes === "number"
  );
}

/** 후보가 가리키는 커밋입니다. 후보 목록이 `sha`로 색인을 만들고 상세가 파일을 그립니다. */
function isStoredCommit(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sha) &&
    Array.isArray(value.files) &&
    value.files.every(isStoredFile)
  );
}

/** 근거 diff입니다. 인터뷰를 시작할 때 `buildExperienceEvidenceSnapshot`이 여기서 patch를 꺼냅니다. */
function isStoredDiff(value: unknown): boolean {
  return (
    isRecord(value) && isNonEmptyString(value.sha) && Array.isArray(value.files) && value.files.every(isStoredFile)
  );
}

function isStoredCandidates(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const stageB = value.candidates;
  if (!isRecord(stageB)) return false;
  if (!Array.isArray(stageB.candidates) || !stageB.candidates.every(isCandidate)) return false;
  const reason = stageB.insufficientCandidatesReason;
  if (reason !== null && typeof reason !== "string") return false;
  if (!Array.isArray(stageB.diffs) || !stageB.diffs.every(isStoredDiff)) return false;
  return Array.isArray(value.includedCommits) && value.includedCommits.every(isStoredCommit);
}

/** Stage A가 제외한 묶음 하나입니다. 제외 목록이 제목과 점수와 신호를 그립니다. */
function isStoredExcludedUnit(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.unitId) &&
    typeof value.kind === "string" &&
    typeof value.title === "string" &&
    (value.pullRequestNumber === null || typeof value.pullRequestNumber === "number") &&
    typeof value.score === "number" &&
    typeof value.reason === "string" &&
    Array.isArray(value.signals) &&
    value.signals.every((signal) => typeof signal === "string")
  );
}

function isStoredStageASummary(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.excludedUnits) &&
    value.excludedUnits.every(isStoredExcludedUnit) &&
    typeof value.selectedUnitCount === "number" &&
    typeof value.thresholdScore === "number" &&
    Array.isArray(value.unjudgedShas) &&
    value.unjudgedShas.every((sha) => typeof sha === "string")
  );
}

/**
 * 분석 축약본의 모양을 봅니다. 저장할 때는 요청 본문을, 읽을 때는 저장된 값을 이 함수로 봅니다.
 *
 * 읽을 때도 보는 이유는 저장된 값이 오래전에 쓴 것일 수 있기 때문입니다. 저장한 뒤에 `StoredAnalysis`의
 * 모양이 바뀌면 옛 줄은 지금 화면이 기대하는 모양이 아니고, 그대로 화면에 넘기면 후보 목록을 그리다
 * 깨집니다. 읽는 자리에서 걸러 Error 상태로 안내합니다.
 *
 * **중첩된 원소까지 봅니다**(PR #130 리뷰). 바깥 모양만 보면 `{candidates: {}, stageASummary: {}}`가
 * 그대로 저장되고, 읽는 자리도 같은 검사를 쓰므로 그 줄이 멀쩡한 분석으로 돌아옵니다. 화면은
 * `data.includedCommits.map`에서 멈춥니다. 저장 경계에서 막아야 그런 줄이 애초에 생기지 않고, 읽는
 * 경계에서도 막아야 이미 쌓인 줄이 화면을 깨지 않습니다. 블록 상태를 `isRestorableBlockState`가
 * 중첩까지 보는 것과 같은 자리입니다(PR #127 재검증 라운드).
 */
export function isStoredAnalysis(value: unknown): value is StoredAnalysis {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.repoOwner) || !isNonEmptyString(value.repoName)) return false;
  if (!Array.isArray(value.contributionItems) || value.contributionItems.some((item) => typeof item !== "string")) {
    return false;
  }
  if (!isStoredCandidates(value.candidates)) return false;
  return isStoredStageASummary(value.stageASummary);
}

export type ParsedSaveAnalysis =
  | { readonly ok: true; readonly body: SaveAnalysisRequestBody }
  | {
      readonly ok: false;
      readonly kind: Extract<SavedInterviewErrorKind, "invalid_request">;
      readonly message: string;
    };

/**
 * 모양만 봅니다. 값의 진위를 서버가 다시 따지지 않는 이유는 `parseCreateInterviewBody`와 같습니다.
 * 여기 담기는 분석 결과는 그 사용자의 브라우저가 만들어 보낸 그 사용자의 값이고, 저장한 뒤 그
 * 사용자에게만 되돌려 줍니다.
 */
export function parseSaveAnalysisBody(value: unknown): ParsedSaveAnalysis {
  if (!isRecord(value)) {
    return { ok: false, kind: "invalid_request", message: "요청 본문은 객체여야 합니다." };
  }
  if (!isStoredAnalysis(value.analysis)) {
    return { ok: false, kind: "invalid_request", message: "analysis가 분석 축약본 모양이 아닙니다." };
  }
  return { ok: true, body: { analysis: value.analysis } };
}

/**
 * `PATCH /api/interviews/[id]`가 받는 블록 편집입니다(이슈 #115). 끝난 인터뷰의 요약 화면에서 블록
 * 문장을 고칠 때 옵니다.
 *
 * 문장을 표시 문장 객체가 아니라 **문자열 배열**로 받습니다. 그래야 고친 문장에 예전 주장이 따라올
 * 길이 없습니다. 객체로 받으면 `claimIds`를 실어 보낼 수 있고, 서버가 그것을 지우는 것을 한 번이라도
 * 빠뜨리면 사용자가 직접 쓴 문장에 저장소가 뒷받침한다는 표시가 붙습니다(설계 8절). 자료 모양으로
 * 막으면 빠뜨릴 자리가 없습니다.
 *
 * 저장 전용 경로를 새로 만들지 않는다는 이슈의 Constraint를 지킵니다. 끝내기 표시가 이미 이 PATCH에
 * 있으므로 같은 자리에 분기를 하나 더합니다.
 */
export interface BlockEditRequestBody {
  readonly block: BlockKind;
  readonly sentences: readonly string[];
  /** 화면이 읽어 온 블록 버전입니다. 저장된 값과 다르면 다른 탭이 먼저 고친 것입니다. */
  readonly expectedBlockVersion: number;
}

export type ParsedBlockEdit =
  | { readonly ok: true; readonly body: BlockEditRequestBody }
  | {
      readonly ok: false;
      readonly kind: Extract<SavedInterviewErrorKind, "invalid_request">;
      readonly message: string;
    };

/** 본문이 블록 편집인지 봅니다. 이 판정이 참일 때만 상태 변경이 아닌 길로 갑니다. */
export function isBlockEditBody(value: unknown): boolean {
  return isRecord(value) && value.blockEdit !== undefined;
}

/** 저장할 표시 문장입니다. 빈 줄은 버리고 출처는 언제나 비웁니다. */
export function blockEditSentences(body: BlockEditRequestBody): readonly DisplaySentence[] {
  return body.sentences
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => ({ text: line, claimIds: [] }));
}

/**
 * 상한을 서버가 다시 잽니다. 화면도 같은 기준으로 먼저 막지만, 화면의 검사는 요청을 아끼려는 것이고
 * 거절할 권한은 서버에 있습니다. 재는 대상은 저장될 표시 문장이라 `applyBlockUpdate`의 검증과 같은
 * 값을 봅니다.
 */
export function parseBlockEditBody(value: unknown): ParsedBlockEdit {
  if (!isRecord(value) || !isRecord(value.blockEdit)) {
    return { ok: false, kind: "invalid_request", message: "blockEdit이 객체여야 합니다." };
  }
  const edit = value.blockEdit;
  if (typeof edit.block !== "string" || !BLOCK_KINDS.includes(edit.block as BlockKind)) {
    return { ok: false, kind: "invalid_request", message: "blockEdit.block이 PAAR 블록 이름이어야 합니다." };
  }
  if (!Array.isArray(edit.sentences) || edit.sentences.some((line) => typeof line !== "string")) {
    return { ok: false, kind: "invalid_request", message: "blockEdit.sentences는 문자열 배열이어야 합니다." };
  }
  if (!Number.isInteger(edit.expectedBlockVersion) || (edit.expectedBlockVersion as number) < 0) {
    return {
      ok: false,
      kind: "invalid_request",
      message: "blockEdit.expectedBlockVersion은 0 이상의 정수여야 합니다.",
    };
  }

  const body: BlockEditRequestBody = {
    block: edit.block as BlockKind,
    sentences: edit.sentences as readonly string[],
    expectedBlockVersion: edit.expectedBlockVersion as number,
  };
  const sentences = blockEditSentences(body);
  if (sentences.length > BLOCK_MAX_STATEMENTS) {
    return { ok: false, kind: "invalid_request", message: `블록 문장은 ${BLOCK_MAX_STATEMENTS}개까지입니다.` };
  }
  if (blockEditByteLength(sentences) > BLOCK_MAX_BYTES) {
    return { ok: false, kind: "invalid_request", message: `블록 하나는 ${BLOCK_MAX_BYTES}바이트까지입니다.` };
  }
  return { ok: true, body };
}

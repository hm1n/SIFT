import { blockEditByteLength } from "@/features/experience-block/block-edits";
import { BLOCK_MAX_BYTES, BLOCK_MAX_STATEMENTS } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockKind, type DisplaySentence } from "@/features/experience-block/types";
import { STAGE_B_MAX_TOTAL_PATCH_CHARS } from "@/features/experience-candidates/stage-b";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { isExperienceEvidenceSnapshot, SNAPSHOT_BODY_BYTES } from "@/features/interview/question-request";
import type { StoredAnalysis } from "@/features/repository-analysis/analysis-snapshot";
import type { SavedInterviewErrorKind } from "./errors";

/**
 * `POST /api/interviews`의 요청 본문입니다. 경험을 확정하는 순간 분석 한 줄과 인터뷰 한 줄을 함께
 * 만듭니다.
 *
 * 정의서는 분석 저장을 Stage B 성공 직후로 적었고 이슈 #115는 그것을 후속으로 미뤘습니다. 그런데
 * `interview_session.analysis_id`가 `not null`이고 실재하는 분석을 가리켜야 해서, 인터뷰만 저장하는
 * 것이 성립하지 않습니다. 그래서 이 이슈는 확정 시점에 둘을 함께 만들고, 저장 시점을 앞당기는 일만
 * 이슈 #116에 남깁니다. 그때 이 경로가 둘로 갈립니다.
 *
 * `analysisId`는 같은 분석에서 두 번째 경험을 고를 때 옵니다. 없으면 분석을 새로 저장합니다. 이 값이
 * 없으면 한 분석에서 경험을 여러 개 고를 때마다 같은 분석이 여러 줄로 쌓이고, 목록에 같은 저장소가
 * 여러 번 나오며, 후보 화면을 복원할 때 어느 줄이 진짜인지 알 수 없게 됩니다.
 */
export interface CreateInterviewRequestBody {
  readonly analysis: StoredAnalysis;
  readonly analysisId?: string;
  readonly candidateKey: string;
  readonly title: string;
  readonly evidence: ExperienceEvidenceSnapshot;
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

export const MAX_CREATE_INTERVIEW_BODY_BYTES =
  STORED_ANALYSIS_MAX_BYTES + SNAPSHOT_BODY_BYTES + CREATE_INTERVIEW_META_BYTES;

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

  const { analysis, analysisId, candidateKey, title, evidence } = value;

  if (!isRecord(analysis)) return fail("analysis가 없습니다.");
  if (!isNonEmptyString(analysis.repoOwner) || !isNonEmptyString(analysis.repoName)) {
    return fail("analysis.repoOwner와 analysis.repoName이 필요합니다.");
  }
  if (!Array.isArray(analysis.contributionItems) || analysis.contributionItems.some((item) => typeof item !== "string")) {
    return fail("analysis.contributionItems는 문자열 배열이어야 합니다.");
  }
  if (!isRecord(analysis.candidates)) return fail("analysis.candidates가 없습니다.");
  if (!isRecord(analysis.stageASummary)) return fail("analysis.stageASummary가 없습니다.");

  if (analysisId !== undefined && !isNonEmptyString(analysisId)) {
    return fail("analysisId는 비어 있지 않은 문자열이어야 합니다.");
  }
  if (!isNonEmptyString(candidateKey)) return fail("candidateKey가 필요합니다.");
  if (!isNonEmptyString(title)) return fail("title이 필요합니다.");
  if (!isExperienceEvidenceSnapshot(evidence)) return fail("evidence가 근거 스냅샷 모양이 아닙니다.");

  return {
    ok: true,
    body: {
      analysis: analysis as unknown as StoredAnalysis,
      ...(analysisId === undefined ? {} : { analysisId }),
      candidateKey,
      title,
      evidence,
    },
  };
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

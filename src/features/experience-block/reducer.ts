import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { INTERVIEW_HISTORY_ITEM_MAX_BYTES } from "@/features/interview/history";
import {
  BLOCK_KINDS,
  isBlockKind,
  type BlockKind,
  type Claim,
  type ClaimOp,
  type ClaimSource,
  type DisplaySentence,
  type ExperienceBlockState,
} from "./types";

/**
 * 블록 갱신 응답을 검증하고 상태에 적용하는 순수 함수입니다. 서버와 클라이언트 훅이 같은 함수를 씁니다.
 * 서버는 모델 출력을 이 함수로 검증해 통과한 출력과 새 상태를 돌려주고, 훅은 같은 출력을 다시 적용합니다.
 *
 * 보장하는 것은 누락 방지와 변경 범위입니다. 언급되지 않은 주장은 유지되고, 존재하지 않거나 철회된 주장,
 * 근거에 없는 커밋과 파일을 참조하면 응답 전체를 거절합니다. 모델이 정정 대상을 의미적으로 맞게 골랐는지,
 * 유효한 주장을 참조하면서 근거 없는 수치를 문장에 덧붙였는지는 여기서 잡히지 않습니다.
 */

/** 블록 하나의 표시 문장 전체 상한입니다. 이력 항목 상한을 그대로 씁니다. */
export const BLOCK_MAX_BYTES = INTERVIEW_HISTORY_ITEM_MAX_BYTES;
/** 블록 하나의 표시 문장 수 상한입니다. 목표 형태가 블록당 한 문장이고 부정을 응축해도 둘을 넘길 이유가 없습니다. */
export const BLOCK_MAX_STATEMENTS = 2;
/** 주장 상태 전체의 상한입니다. 네 블록에 블록 상한을 곱합니다. */
export const CLAIMS_STATE_MAX_BYTES = BLOCK_KINDS.length * BLOCK_MAX_BYTES;

export type BlockUpdateRejection =
  | "invalid_shape"
  | "unknown_block"
  | "empty_text"
  | "no_source"
  | "unknown_commit"
  | "unknown_file"
  | "duplicate_temp_id"
  | "unknown_claim"
  | "claim_not_active"
  | "display_missing"
  | "too_many_statements"
  | "no_claim_reference"
  | "claim_block_mismatch"
  | "block_too_large"
  | "claims_too_large"
  | "invalid_evaluation";

/** 응답을 거절하지 않고 조정한 내용입니다. 충돌한 주장을 참조한 표시 문장은 설계 8절에 따라 그 문장만 뺍니다. */
export type BlockUpdateWarning = { readonly kind: "conflicted_sentence_dropped"; readonly detail: string };

export type BlockUpdateResult =
  | { readonly ok: true; readonly state: ExperienceBlockState; readonly affectedBlocks: readonly BlockKind[]; readonly warnings: readonly BlockUpdateWarning[] }
  | { readonly ok: false; readonly errors: readonly { kind: BlockUpdateRejection; detail: string }[] };

const utf8 = new TextEncoder();
/** route의 요청 사전 검증(`experience-block/request.ts`)도 같은 측정 방식을 씁니다. */
export function byteLength(text: string): number {
  return utf8.encode(text).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** route의 요청 사전 검증(`experience-block/request.ts`)도 같은 방식으로 저장소 출처를 대조합니다. */
export function evidenceIndex(snapshot: ExperienceEvidenceSnapshot) {
  const commits = new Map<string, ReadonlySet<string>>();
  for (const commit of [snapshot.representativeCommit, ...snapshot.relatedCommits]) {
    commits.set(commit.sha, new Set(commit.files.map((file) => file.path)));
  }
  return commits;
}

/**
 * 응답을 검증해 새 상태를 만듭니다. 실패하면 상태를 바꾸지 않고 오류 목록을 돌려줍니다.
 * 원자성은 호출자가 반환된 상태를 통째로 바꿔 끼우는 것으로 얻습니다.
 */
export function applyBlockUpdate(
  state: ExperienceBlockState,
  output: unknown,
  context: { readonly snapshot: ExperienceEvidenceSnapshot; readonly turnId: string }
): BlockUpdateResult {
  const errors: { kind: BlockUpdateRejection; detail: string }[] = [];
  const warnings: BlockUpdateWarning[] = [];
  const fail = (kind: BlockUpdateRejection, detail: string) => {
    errors.push({ kind, detail });
  };

  if (!isRecord(output) || !Array.isArray(output.ops) || !Array.isArray(output.display) || !Array.isArray(output.evaluation)) {
    return { ok: false, errors: [{ kind: "invalid_shape", detail: "ops, display, evaluation 배열이 필요합니다." }] };
  }
  const commits = evidenceIndex(context.snapshot);

  const validateSources = (sources: unknown, where: string): sources is readonly ClaimSource[] => {
    if (!Array.isArray(sources) || sources.length === 0) {
      fail("no_source", where);
      return false;
    }
    let valid = true;
    for (const source of sources) {
      if (!isRecord(source)) {
        fail("invalid_shape", `${where}: 출처 형식`);
        valid = false;
      } else if (source.source === "user") {
        continue;
      } else if (source.source === "repository" && typeof source.commitSha === "string") {
        const files = commits.get(source.commitSha);
        if (!files) {
          fail("unknown_commit", `${where}: ${source.commitSha}`);
          valid = false;
        } else if (source.filePath !== null && (typeof source.filePath !== "string" || !files.has(source.filePath))) {
          fail("unknown_file", `${where}: ${String(source.filePath)}`);
          valid = false;
        }
      } else {
        fail("invalid_shape", `${where}: 출처 종류`);
        valid = false;
      }
    }
    return valid;
  };

  // 1. 연산을 검증하며 임시 상태에 적용합니다. 언급되지 않은 주장은 그대로 남습니다.
  const claims = new Map<string, Claim>(state.claims.map((claim) => [claim.id, claim]));
  const conflicts = [...state.conflicts];
  const tempIds = new Map<string, string>();
  const seenTempIds = new Set<string>();
  const affected = new Set<BlockKind>();
  let nextClaimSeq = state.nextClaimSeq;

  // 같은 응답에서 추가한 주장은 `new:<tempId>`로 가리킵니다. 표시 문장뿐 아니라 뒤따르는 연산에서도 씁니다.
  const resolveId = (ref: unknown): string | null =>
    typeof ref === "string" ? (ref.startsWith("new:") ? tempIds.get(ref.slice(4)) ?? null : ref) : null;
  // 충돌한 주장은 revise나 retract로 해소할 수 있습니다. 철회된 주장은 어떤 연산도 받지 않습니다.
  const targetClaim = (ref: unknown, where: string, allowConflicted: boolean): Claim | null => {
    const claimId = resolveId(ref);
    if (claimId === null || !claims.has(claimId)) {
      fail("unknown_claim", `${where}: ${String(ref)}`);
      return null;
    }
    const claim = claims.get(claimId)!;
    if (claim.status === "retracted" || (claim.status === "conflicted" && !allowConflicted)) {
      fail("claim_not_active", `${where}: ${claimId} ${claim.status}`);
      return null;
    }
    return claim;
  };
  const resolveConflict = (claimId: string) => {
    for (let index = conflicts.length - 1; index >= 0; index--) if (conflicts[index].claimId === claimId) conflicts.splice(index, 1);
  };

  (output.ops as unknown[]).forEach((raw, index) => {
    const where = `ops[${index}]`;
    if (!isRecord(raw)) return fail("invalid_shape", where);
    const op = raw as Partial<Record<keyof (ClaimOp & Record<string, unknown>), unknown>> & { op?: unknown };
    switch (op.op) {
      case "add": {
        if (typeof op.tempId !== "string" || !op.tempId) return fail("invalid_shape", `${where}: tempId`);
        if (seenTempIds.has(op.tempId)) return fail("duplicate_temp_id", `${where}: ${op.tempId}`);
        seenTempIds.add(op.tempId);
        if (!isBlockKind(op.block)) return fail("unknown_block", `${where}: ${String(op.block)}`);
        if (typeof op.text !== "string" || !op.text.trim()) return fail("empty_text", where);
        if (!validateSources(op.sources, where)) return;
        const id = `c${nextClaimSeq++}`;
        tempIds.set(op.tempId, id);
        claims.set(id, { id, block: op.block, text: op.text.trim(), sources: op.sources, status: "active", turnId: context.turnId });
        affected.add(op.block);
        return;
      }
      case "revise": {
        const claim = targetClaim(op.claimId, where, true);
        if (!claim) return;
        if (typeof op.text !== "string" || !op.text.trim()) return fail("empty_text", where);
        if (!validateSources(op.sources, where)) return;
        resolveConflict(claim.id);
        claims.set(claim.id, { ...claim, status: "active", text: op.text.trim(), sources: op.sources, turnId: context.turnId });
        affected.add(claim.block);
        return;
      }
      case "retract": {
        const claim = targetClaim(op.claimId, where, true);
        if (!claim) return;
        resolveConflict(claim.id);
        claims.set(claim.id, { ...claim, status: "retracted", turnId: context.turnId });
        affected.add(claim.block);
        return;
      }
      case "conflict": {
        const claim = targetClaim(op.claimId, where, false);
        if (!claim) return;
        if (typeof op.observation !== "string" || !op.observation.trim()) return fail("empty_text", `${where}: observation`);
        claims.set(claim.id, { ...claim, status: "conflicted", turnId: context.turnId });
        conflicts.push({ claimId: claim.id, observation: op.observation.trim(), turnId: context.turnId });
        affected.add(claim.block);
        return;
      }
      default:
        return fail("invalid_shape", `${where}: op ${String(op.op)}`);
    }
  });

  // 2. 표시 문장을 검증합니다. 표시 문장이 있던 블록의 주장이 바뀌면 새 표시 문장이 반드시 와야 합니다(빈 배열 허용).
  //    표시가 비어 있던 블록은 낡은 문장이 남을 위험이 없으므로 주장만 쌓이는 것을 허용합니다.
  const display: Record<BlockKind, readonly DisplaySentence[]> = { ...state.display };
  const displayedBlocks = new Set<BlockKind>();
  (output.display as unknown[]).forEach((raw, index) => {
    const where = `display[${index}]`;
    if (!isRecord(raw) || !Array.isArray(raw.sentences)) return fail("invalid_shape", where);
    if (!isBlockKind(raw.block)) return fail("unknown_block", `${where}: ${String(raw.block)}`);
    const block = raw.block;
    displayedBlocks.add(block);
    if (raw.sentences.length > BLOCK_MAX_STATEMENTS) fail("too_many_statements", `${where}: ${raw.sentences.length}`);
    const sentences: DisplaySentence[] = [];
    for (const sentence of raw.sentences as unknown[]) {
      if (!isRecord(sentence) || typeof sentence.text !== "string" || !sentence.text.trim()) {
        fail("empty_text", where);
        continue;
      }
      if (!Array.isArray(sentence.claimIds) || sentence.claimIds.length === 0) {
        fail("no_claim_reference", `${where}: ${sentence.text.slice(0, 30)}`);
        continue;
      }
      const claimIds: string[] = [];
      let conflicted = false;
      for (const ref of sentence.claimIds as unknown[]) {
        const id = resolveId(ref);
        if (id === null || !claims.has(id)) {
          fail("unknown_claim", `${where}: ${String(ref)}`);
          continue;
        }
        const claim = claims.get(id)!;
        if (claim.status === "conflicted") conflicted = true;
        else if (claim.status !== "active") fail("claim_not_active", `${where}: ${id} ${claim.status}`);
        else if (claim.block !== block) fail("claim_block_mismatch", `${where}: ${id}는 ${claim.block} 블록`);
        else claimIds.push(id);
      }
      // 미해소 충돌을 참조한 문장은 그 문장만 뺍니다. 충돌은 블록 문장 밖에서 보여 줍니다.
      if (conflicted) {
        warnings.push({ kind: "conflicted_sentence_dropped", detail: `${where}: ${sentence.text.slice(0, 40)}` });
        continue;
      }
      sentences.push({ text: sentence.text.trim(), claimIds });
    }
    if (byteLength(JSON.stringify(sentences)) > BLOCK_MAX_BYTES) fail("block_too_large", where);
    display[block] = sentences;
  });
  for (const block of affected) {
    if (!displayedBlocks.has(block) && state.display[block].length > 0) {
      fail("display_missing", `${block} 블록의 주장이 바뀌었지만 표시 문장이 없습니다.`);
    }
  }
  for (const block of displayedBlocks) affected.add(block);

  // 3. 평가를 검증합니다.
  const evaluation = { ...state.evaluation };
  (output.evaluation as unknown[]).forEach((raw, index) => {
    const where = `evaluation[${index}]`;
    if (!isRecord(raw)) return fail("invalid_shape", where);
    if (!isBlockKind(raw.block)) return fail("unknown_block", `${where}: ${String(raw.block)}`);
    const reasons = ["sufficient", "askable", "unknown", "not_done", "refused", "none"];
    if (typeof raw.sufficient !== "boolean" || typeof raw.askable !== "boolean" || !reasons.includes(raw.reason as string)) {
      return fail("invalid_evaluation", where);
    }
    // 충분하면 사유는 sufficient(충족)나 none(더 물을 것 없음)입니다. 충분하지 않은데 sufficient 사유를 내면 거절합니다.
    const consistent = raw.sufficient ? raw.reason === "sufficient" || raw.reason === "none" : raw.reason !== "sufficient";
    if (!consistent) return fail("invalid_evaluation", `${where}: sufficient와 reason이 어긋납니다.`);
    evaluation[raw.block] = { sufficient: raw.sufficient, askable: raw.askable, reason: raw.reason as never };
    affected.add(raw.block);
  });

  if (errors.length > 0) return { ok: false, errors };

  const next: ExperienceBlockState = {
    version: state.version + 1,
    nextClaimSeq,
    claims: [...claims.values()],
    conflicts,
    display,
    evaluation,
  };
  if (byteLength(JSON.stringify(next.claims)) > CLAIMS_STATE_MAX_BYTES) {
    return { ok: false, errors: [{ kind: "claims_too_large", detail: `주장 상태가 ${CLAIMS_STATE_MAX_BYTES}바이트를 넘습니다.` }] };
  }
  return { ok: true, state: next, affectedBlocks: BLOCK_KINDS.filter((block) => affected.has(block)), warnings };
}

/** 화면 표시입니다. 모델 출력이 아니라 참조된 주장의 출처에서 계산합니다. */
export interface DisplayMark {
  readonly text: string;
  /** 참조한 주장 가운데 사용자 진술만 근거인 것이 하나라도 있으면 true입니다. 문구는 "사용자 진술 · 저장소 미검증"입니다. */
  readonly userStatement: boolean;
  readonly repositorySources: readonly Extract<ClaimSource, { source: "repository" }>[];
}

export function markDisplay(state: ExperienceBlockState, block: BlockKind): readonly DisplayMark[] {
  const claims = new Map(state.claims.map((claim) => [claim.id, claim]));
  return state.display[block].map((sentence) => {
    const referenced = sentence.claimIds.map((id) => claims.get(id)).filter((claim): claim is Claim => claim !== undefined);
    return {
      text: sentence.text,
      userStatement: referenced.some((claim) => claim.sources.every((source) => source.source === "user")),
      repositorySources: referenced.flatMap((claim) =>
        claim.sources.filter((source): source is Extract<ClaimSource, { source: "repository" }> => source.source === "repository")
      ),
    };
  });
}

/** 블록의 미해소 충돌입니다. 블록 문장 밖에서 "근거와 불일치 · 확인 필요"로 보여 줍니다. */
export function blockConflicts(state: ExperienceBlockState, block: BlockKind) {
  const claims = new Map(state.claims.map((claim) => [claim.id, claim]));
  return state.conflicts.filter((conflict) => claims.get(conflict.claimId)?.block === block && claims.get(conflict.claimId)?.status === "conflicted");
}

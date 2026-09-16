import { generateObject } from "ai";
import { LLM_ERROR_CONTEXT } from "@/copy/interview";
import type { NextRequest } from "next/server";
import { applyBlockUpdate, blockConflicts, markDisplay } from "@/features/experience-block/reducer";
import {
  BLOCK_KINDS,
  type BlockElement,
  type BlockKind,
  type BlockUpdateOutput,
  type ExperienceBlockState,
  type TargetResponse,
} from "@/features/experience-block/types";
import {
  experienceBlockErrorStatus,
  type ExperienceBlockErrorKind,
} from "@/features/experience-block/errors";
import { createBlockUpdateModel } from "@/features/experience-block/llm-provider";
import { recordResponse } from "@/features/experience-block/progress";
import {
  isSaveOnlyRequest,
  MAX_EXPERIENCE_BLOCK_BODY_BYTES,
  parseExperienceBlockRequestBody,
  parseSaveOnlyRequestBody,
  type ExperienceBlockSaveTarget,
} from "@/features/experience-block/request";
import { LLM_MAX_RETRIES } from "@/features/experience-candidates/llm-provider";
import {
  blockUpdateOutputSchema,
  buildBlockUpdatePrompt,
  BLOCK_MAX_OUTPUT_TOKENS,
  BLOCK_UPDATE_MODEL,
  BLOCK_UPDATE_REASONING_EFFORT,
  type BlockUpdateTurn,
} from "@/features/interview/block-prompt";
import { INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS } from "@/features/interview/question-generation";
import { mapInterviewLlmError } from "@/features/interview/llm-error";
import type { BlockUpdateSaveStatus } from "@/features/saved-interviews/save-status";
import { turnsToSave } from "@/features/saved-interviews/turn";
import { getGitHubSessionFromRequest } from "@/lib/github/auth-session";
import { GitHubFetchError } from "@/lib/github/errors";
import { neonStore } from "@/lib/db/neon-store";
import type { SiftStore } from "@/lib/db/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * PAAR 경험 블록 갱신 경로입니다(이슈 #89). 설계는
 * `llm-wiki/wiki/2026-09-11-PAAR-경험블록-설계-개정.md` 3~5절, 8절입니다.
 *
 * 화면 연결은 이번 범위가 아닙니다(#90, #91). 이 route는 답변 하나를 처리해 검증된 새
 * `ExperienceBlockState`를 돌려주는 것까지만 합니다. 요청 ID·상태 버전 충돌 처리는 무상태 서버가
 * 보장할 수 없어(설계 3-2절) 클라이언트 훅의 몫으로 남겨 둡니다.
 */
function errorResponse(kind: ExperienceBlockErrorKind, message: string): Response {
  return Response.json({ error: { kind, message } }, { status: experienceBlockErrorStatus(kind) });
}

export type GenerateBlockUpdate = (
  prompt: ReturnType<typeof buildBlockUpdatePrompt>,
  signal: AbortSignal
) => Promise<BlockUpdateOutput>;

async function defaultGenerate(
  prompt: ReturnType<typeof buildBlockUpdatePrompt>,
  signal: AbortSignal
): Promise<BlockUpdateOutput> {
  const { object } = await generateObject({
    model: createBlockUpdateModel(BLOCK_UPDATE_MODEL),
    schema: blockUpdateOutputSchema,
    system: prompt.system,
    messages: [
      { role: "user", content: prompt.evidence },
      { role: "user", content: prompt.turn },
    ],
    maxOutputTokens: BLOCK_MAX_OUTPUT_TOKENS,
    maxRetries: LLM_MAX_RETRIES,
    abortSignal: signal,
    providerOptions: {
      openai: {
        reasoningEffort: BLOCK_UPDATE_REASONING_EFFORT,
        // 명시 캐시 경계입니다. `@ai-sdk/openai`(4.0.65)는 호출 단위 모드만 노출하고 근거 블록
        // 뒤에만 경계를 두는 콘텐츠 파트 단위 지정은 노출하지 않습니다(2026-09-11 확인). 캐시
        // 적중이 측정 하네스(raw fetch)와 같은 수준으로 유지된다고 보장하지 않습니다.
        promptCacheOptions: { mode: "explicit" },
      },
    },
  });
  return object;
}

/**
 * 저장 실패를 요청 전체의 실패로 돌리지 않습니다. 블록 갱신은 이미 성공했으므로, 여기서 실패를 올리면
 * 사용자는 방금 화면에 그려진 답변과 블록을 잃습니다. 결과만 응답에 실어 화면이 안내하게 합니다.
 */
async function saveTurn(
  store: SiftStore,
  githubUserId: number,
  save: ExperienceBlockSaveTarget | undefined,
  history: readonly BlockUpdateTurn[],
  answerTurnId: string,
  blockState: ExperienceBlockState,
  target: { readonly targetBlock: BlockKind; readonly targetElement: BlockElement },
  targetResponse: TargetResponse
): Promise<BlockUpdateSaveStatus> {
  if (save === undefined) return "skipped";
  try {
    return await store.appendTurn({
      githubUserId,
      interviewId: save.interviewId,
      turn: turnsToSave(history, [...(save.pendingTurnIds ?? []), answerTurnId]),
      blockState,
      // 이번 답변의 반응을 여기서 반영합니다. 반응은 모델 출력에서 방금 계산한 값이라 클라이언트가
      // 요청을 보내는 시점에는 알 수 없습니다. 그래서 반영 전 값을 받아 서버가 반영합니다.
      progress: recordResponse(
        save.progress,
        target.targetBlock,
        target.targetElement,
        targetResponse,
        save.askedCountAtQuestion
      ),
      expectedBlockVersion: save.expectedBlockVersion,
    });
  } catch {
    return "failed";
  }
}

export async function handleExperienceBlockUpdate(
  request: NextRequest,
  options: { generate?: GenerateBlockUpdate; store?: SiftStore } = {}
): Promise<Response> {
  let githubUserId: number;
  try {
    githubUserId = getGitHubSessionFromRequest(request).githubUserId;
  } catch (error) {
    if (error instanceof GitHubFetchError && error.kind === "auth_revoked") {
      return errorResponse("unauthorized", "GitHub 로그인 세션이 필요합니다.");
    }
    // 두 갈래를 남기는 이유는 `stream/route.ts`와 같습니다. 세션 쿠키가 있는데 암호화 키 설정이
    // 없거나 32바이트가 아니면 `server_error`가 그대로 올라옵니다.
    return errorResponse("server_error", "서버 설정 문제로 블록 갱신을 시작하지 못했습니다.");
  }

  const declaredLength = Number(request.headers.get("content-length"));
  if (declaredLength > MAX_EXPERIENCE_BLOCK_BODY_BYTES) {
    return errorResponse(
      "body_too_large",
      `요청 본문은 ${Math.floor(MAX_EXPERIENCE_BLOCK_BODY_BYTES / 1024)}KB 이하여야 합니다.`
    );
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_EXPERIENCE_BLOCK_BODY_BYTES) {
    return errorResponse(
      "body_too_large",
      `요청 본문은 ${Math.floor(MAX_EXPERIENCE_BLOCK_BODY_BYTES / 1024)}KB 이하여야 합니다.`
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return errorResponse("invalid_json", "요청 본문은 JSON이어야 합니다.");
  }

  const store = options.store ?? neonStore();

  /**
   * 저장만 다시 보내는 길입니다(이슈 #115). 모델을 부르지 않고 밀린 턴만 이어 붙입니다.
   *
   * 블록 갱신은 성공했는데 저장만 실패한 턴을 다시 저장하려고 같은 답변으로 블록 갱신을 다시 부르면,
   * 모델을 한 번 더 호출하는 데다 같은 답변의 주장이 블록에 두 번 들어갑니다.
   */
  if (isSaveOnlyRequest(json)) {
    const parsedSave = parseSaveOnlyRequestBody(json);
    if (!parsedSave.ok) return errorResponse(parsedSave.kind, parsedSave.message);
    const { history, state, save } = parsedSave.body;
    const turn = turnsToSave(history, save.pendingTurnIds);
    let saved: BlockUpdateSaveStatus;
    try {
      /**
       * 블록에 새로 쓸 것이 없으면 이력만 이어 붙입니다(이슈 #116, backlog 7번).
       *
       * `appendTurn`은 블록 버전이 올라야만 씁니다. 모델 호출이 실패한 턴은 블록이 그대로라 그 조건에
       * 걸려 `version_conflict`가 되고, 모델이 계속 실패하면 그 대화가 영영 저장되지 않습니다. 블록을
       * 건드리지 않는 저장을 따로 두면 대화만 먼저 남길 수 있습니다.
       */
      saved =
        state.version > save.expectedBlockVersion
          ? await store.appendTurn({
              githubUserId,
              interviewId: save.interviewId,
              turn,
              blockState: state,
              // 반영이 이미 끝난 값입니다. 여기서 다시 반영하면 같은 답변의 반응이 두 번 기록됩니다.
              progress: save.progress,
              expectedBlockVersion: save.expectedBlockVersion,
            })
          : await store.appendHistory({
              githubUserId,
              interviewId: save.interviewId,
              turn,
              expectedBlockVersion: save.expectedBlockVersion,
            });
    } catch {
      saved = "failed";
    }
    return Response.json({ save: saved });
  }

  const parsed = parseExperienceBlockRequestBody(json);
  if (!parsed.ok) {
    return errorResponse(parsed.kind, parsed.message);
  }
  const { snapshot, history, state, targetBlock, targetElement, answerTurnId, save } = parsed.body;

  const prompt = buildBlockUpdatePrompt({ snapshot, state, history, targetBlock, targetElement, answerTurnId });
  const generate = options.generate ?? defaultGenerate;

  let modelOutput: BlockUpdateOutput;
  try {
    // request.signal과 별개로 자체 시한을 둡니다. route `maxDuration` 60초보다 먼저 오류 계약을
    // 반환하기 위해서이고, 값과 근거는 `question-generation.ts`와 같습니다.
    modelOutput = await generate(
      prompt,
      AbortSignal.any([request.signal, AbortSignal.timeout(INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS)])
    );
  } catch (error) {
    const mapped = mapInterviewLlmError(error, LLM_ERROR_CONTEXT.blockUpdate);
    return errorResponse(mapped.kind, mapped.message);
  }

  const result = applyBlockUpdate(state, modelOutput, { snapshot, turnId: answerTurnId, targetBlock });
  if (!result.ok) {
    return errorResponse(
      "block_update_rejected",
      `모델 출력이 검증을 통과하지 못했습니다: ${result.errors.map((e) => `${e.kind}(${e.detail})`).join(", ")}`
    );
  }

  // 블록 갱신을 적용한 직후에 저장합니다. 저장이 먼저 오면 검증을 통과하지 못한 상태를 쓰게 됩니다.
  const saveStatus = await saveTurn(
    store,
    githubUserId,
    save,
    history,
    answerTurnId,
    result.state,
    { targetBlock, targetElement },
    result.targetResponse
  );

  return Response.json({
    state: result.state,
    affectedBlocks: result.affectedBlocks,
    display: Object.fromEntries(BLOCK_KINDS.map((block) => [block, markDisplay(result.state, block)])),
    conflicts: Object.fromEntries(BLOCK_KINDS.map((block) => [block, blockConflicts(result.state, block)])),
    warnings: result.warnings,
    targetResponse: result.targetResponse,
    save: saveStatus,
  });
}

export function POST(request: NextRequest): Promise<Response> {
  return handleExperienceBlockUpdate(request);
}

import { generateObject } from "ai";
import type { NextRequest } from "next/server";
import { applyBlockUpdate, blockConflicts, markDisplay } from "@/features/experience-block/reducer";
import { BLOCK_KINDS, type BlockUpdateOutput } from "@/features/experience-block/types";
import {
  experienceBlockErrorStatus,
  type ExperienceBlockErrorKind,
} from "@/features/experience-block/errors";
import { createBlockUpdateModel } from "@/features/experience-block/llm-provider";
import {
  MAX_EXPERIENCE_BLOCK_BODY_BYTES,
  parseExperienceBlockRequestBody,
} from "@/features/experience-block/request";
import { LLM_MAX_RETRIES } from "@/features/experience-candidates/llm-provider";
import {
  blockUpdateOutputSchema,
  buildBlockUpdatePrompt,
  BLOCK_MAX_OUTPUT_TOKENS,
  BLOCK_UPDATE_MODEL,
  BLOCK_UPDATE_REASONING_EFFORT,
} from "@/features/interview/block-prompt";
import { INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS } from "@/features/interview/question-generation";
import { mapInterviewLlmError } from "@/features/interview/llm-error";
import { getGitHubTokenFromRequest } from "@/lib/github/auth-session";
import { GitHubFetchError } from "@/lib/github/errors";

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

export async function handleExperienceBlockUpdate(
  request: NextRequest,
  options: { generate?: GenerateBlockUpdate } = {}
): Promise<Response> {
  try {
    getGitHubTokenFromRequest(request);
  } catch (error) {
    if (error instanceof GitHubFetchError && error.kind === "auth_revoked") {
      return errorResponse("unauthorized", "GitHub 인증 세션이 필요합니다.");
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

  const parsed = parseExperienceBlockRequestBody(json);
  if (!parsed.ok) {
    return errorResponse(parsed.kind, parsed.message);
  }
  const { snapshot, history, state, targetBlock, answerTurnId } = parsed.body;

  const prompt = buildBlockUpdatePrompt({ snapshot, state, history, targetBlock, answerTurnId });
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
    const mapped = mapInterviewLlmError(error, "블록 갱신");
    return errorResponse(mapped.kind, mapped.message);
  }

  const result = applyBlockUpdate(state, modelOutput, { snapshot, turnId: answerTurnId });
  if (!result.ok) {
    return errorResponse(
      "block_update_rejected",
      `모델 출력이 검증을 통과하지 못했습니다: ${result.errors.map((e) => `${e.kind}(${e.detail})`).join(", ")}`
    );
  }

  return Response.json({
    state: result.state,
    affectedBlocks: result.affectedBlocks,
    display: Object.fromEntries(BLOCK_KINDS.map((block) => [block, markDisplay(result.state, block)])),
    conflicts: Object.fromEntries(BLOCK_KINDS.map((block) => [block, blockConflicts(result.state, block)])),
    warnings: result.warnings,
  });
}

export function POST(request: NextRequest): Promise<Response> {
  return handleExperienceBlockUpdate(request);
}

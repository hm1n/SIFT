import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import type { ExperienceBlockErrorKind } from "./errors";
import type { BlockElement, BlockKind, ExperienceBlockState, TargetResponse } from "./types";

/**
 * `POST /api/interview/experience-block`를 부르는 브라우저 쪽 클라이언트입니다. 훅에서 fetch 세부를
 * 분리해 순수 함수로 테스트할 수 있게 둡니다.
 */
export interface FetchBlockUpdateInput {
  readonly url: string;
  readonly snapshot: ExperienceEvidenceSnapshot;
  readonly history: readonly BlockUpdateTurn[];
  readonly state: ExperienceBlockState;
  readonly targetBlock: BlockKind;
  readonly targetElement: BlockElement;
  readonly answerTurnId: string;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface FetchBlockUpdateResult {
  readonly state: ExperienceBlockState;
  readonly affectedBlocks: readonly BlockKind[];
  readonly targetResponse: TargetResponse;
}

/** route가 낼 수 없는 전송 실패("network")를 더해 호출부가 한 타입으로 갈라 처리하게 합니다. */
export type BlockUpdateFetchErrorKind = ExperienceBlockErrorKind | "network";

export class BlockUpdateFetchError extends Error {
  readonly kind: BlockUpdateFetchErrorKind;

  constructor(kind: BlockUpdateFetchErrorKind, message: string) {
    super(message);
    this.name = "BlockUpdateFetchError";
    this.kind = kind;
  }
}

function isErrorBody(value: unknown): value is { error: { kind?: string; message?: string } } {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function fetchBlockUpdate(input: FetchBlockUpdateInput): Promise<FetchBlockUpdateResult> {
  const request = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await request(input.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        snapshot: input.snapshot,
        history: input.history,
        state: input.state,
        targetBlock: input.targetBlock,
        targetElement: input.targetElement,
        answerTurnId: input.answerTurnId,
      }),
      signal: input.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new BlockUpdateFetchError(
      "network",
      error instanceof Error ? error.message : "네트워크 요청에 실패했습니다."
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new BlockUpdateFetchError("network", "응답을 읽지 못했습니다.");
  }

  if (!response.ok) {
    const kind = isErrorBody(json) && typeof json.error.kind === "string" ? json.error.kind : "server_error";
    const message = isErrorBody(json) && typeof json.error.message === "string"
      ? json.error.message
      : "블록 갱신에 실패했습니다.";
    throw new BlockUpdateFetchError(kind as BlockUpdateFetchErrorKind, message);
  }

  const body = json as FetchBlockUpdateResult;
  return { state: body.state, affectedBlocks: body.affectedBlocks, targetResponse: body.targetResponse };
}

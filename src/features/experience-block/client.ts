import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import type { BlockUpdateSaveStatus } from "@/features/saved-interviews/save-status";
import type { ExperienceBlockErrorKind } from "./errors";
import type { ExperienceBlockSaveOnlyTarget, ExperienceBlockSaveTarget } from "./request";
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
  /**
   * 이 턴을 저장할 대상입니다. 없으면 저장하지 않습니다. 경험을 확정하기 전이거나 인터뷰 줄을 만들지
   * 못한 경우입니다.
   */
  readonly save?: ExperienceBlockSaveTarget;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

export interface FetchBlockUpdateResult {
  readonly state: ExperienceBlockState;
  readonly affectedBlocks: readonly BlockKind[];
  readonly targetResponse: TargetResponse;
  /** 이 턴을 저장한 결과입니다. 저장 대상을 보내지 않았으면 `skipped`입니다. */
  readonly save: BlockUpdateSaveStatus;
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
  // `error`가 있어도 null이면 아래에서 `json.error.kind`에 접근할 때 TypeError가 납니다(CodeRabbit
  // PR #117). 중첩 객체까지 확인해야 안전하게 좁혀집니다.
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null
  );
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
        // 값이 없으면 아예 싣지 않습니다. `save: undefined`는 JSON에서 사라지지만 `save: null`은
        // 남아, 저장하지 않겠다는 뜻과 값을 잘못 만든 것을 서버가 가를 수 없게 됩니다.
        ...(input.save === undefined ? {} : { save: input.save }),
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
  return {
    state: body.state,
    affectedBlocks: body.affectedBlocks,
    targetResponse: body.targetResponse,
    // 저장을 얹기 전에 배포된 서버는 이 값을 내지 않습니다. 없으면 저장하지 않은 것으로 봅니다.
    save: body.save ?? "skipped",
  };
}

export interface FetchSaveOnlyInput {
  readonly url: string;
  readonly snapshot: ExperienceEvidenceSnapshot;
  readonly history: readonly BlockUpdateTurn[];
  readonly state: ExperienceBlockState;
  readonly save: ExperienceBlockSaveOnlyTarget;
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
}

/**
 * 밀린 턴을 다시 저장합니다(이슈 #115). 블록 갱신 route의 저장 전용 길을 부르므로 모델을 호출하지
 * 않고 블록 상태도 그대로 둡니다. "다시 저장" 안내의 버튼이 쓰는 경로입니다.
 */
export async function fetchSaveOnly(input: FetchSaveOnlyInput): Promise<BlockUpdateSaveStatus> {
  const request = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await request(input.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "save_only",
        snapshot: input.snapshot,
        history: input.history,
        state: input.state,
        save: input.save,
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
      : "다시 저장하지 못했습니다.";
    throw new BlockUpdateFetchError(kind as BlockUpdateFetchErrorKind, message);
  }

  const body = json as { save?: BlockUpdateSaveStatus };
  return body.save ?? "failed";
}

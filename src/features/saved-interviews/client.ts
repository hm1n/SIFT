import type { CreateInterviewRequestBody } from "./request";
import type { SavedInterviewErrorKind } from "./errors";
import type { InterviewListItemPayload, StoredInterviewPayload } from "./payload";

/**
 * 저장된 인터뷰 경로를 부르는 브라우저 쪽 클라이언트입니다(이슈 #115). 화면에서 fetch 세부를 분리해
 * 순수 함수로 테스트할 수 있게 둡니다. `experience-block/client.ts`와 같은 방식입니다.
 *
 * 저장 자체는 여기에 없습니다. 저장 전용 요청을 만들지 않고 블록 갱신 요청에 얹기 때문입니다. 이
 * 파일이 다루는 것은 경험을 확정할 때 인터뷰 줄을 만드는 일과, 목록과 복원과 삭제입니다.
 */
export const INTERVIEWS_PATH = "/api/interviews";

/** route가 낼 수 없는 전송 실패("network")를 더해 호출부가 한 타입으로 갈라 처리하게 합니다. */
export type SavedInterviewFetchErrorKind = SavedInterviewErrorKind | "network";

export class SavedInterviewFetchError extends Error {
  readonly kind: SavedInterviewFetchErrorKind;

  constructor(kind: SavedInterviewFetchErrorKind, message: string) {
    super(message);
    this.name = "SavedInterviewFetchError";
    this.kind = kind;
  }
}

function isErrorBody(value: unknown): value is { error: { kind?: string; message?: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "object" &&
    value.error !== null
  );
}

/**
 * 요청 한 번을 보내고 오류 봉투를 타입이 있는 오류로 바꿉니다.
 *
 * 본문이 없는 응답(204)에는 `null`을 돌려줍니다. 삭제가 그 경우이고, 없는 본문을 읽으려 하면 파싱에서
 * 실패해 성공한 삭제가 실패로 보고됩니다.
 */
async function request<T>(
  path: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch
): Promise<T | null> {
  let response: Response;
  try {
    response = await fetchImpl(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new SavedInterviewFetchError(
      "network",
      error instanceof Error ? error.message : "네트워크 요청에 실패했습니다."
    );
  }

  if (response.status === 204) return null;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new SavedInterviewFetchError("network", "응답을 읽지 못했습니다.");
  }

  if (!response.ok) {
    const kind = isErrorBody(json) && typeof json.error.kind === "string" ? json.error.kind : "server_error";
    const message = isErrorBody(json) && typeof json.error.message === "string"
      ? json.error.message
      : "저장된 인터뷰 요청에 실패했습니다.";
    throw new SavedInterviewFetchError(kind as SavedInterviewFetchErrorKind, message);
  }

  return json as T;
}

export interface CreatedInterview {
  readonly interviewId: string;
  /** 이번에 저장했거나 다시 쓴 분석 줄입니다. 같은 분석에서 경험을 하나 더 고를 때 그대로 넘깁니다. */
  readonly analysisId: string;
}

/**
 * 경험을 확정할 때 인터뷰 한 줄을 만듭니다. 분석 결과와 근거 스냅샷을 함께 보내 그 시점의 근거를
 * 인터뷰 쪽에 남깁니다. 이어가기는 이 근거만 있으면 성립하므로 분석 결과를 다시 계산하지 않습니다.
 */
export async function createSavedInterview(
  body: CreateInterviewRequestBody,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal
): Promise<CreatedInterview> {
  const result = await request<CreatedInterview>(
    INTERVIEWS_PATH,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal },
    fetchImpl
  );
  if (result === null || typeof result.interviewId !== "string" || typeof result.analysisId !== "string") {
    throw new SavedInterviewFetchError("server_error", "서버 응답 형식이 올바르지 않습니다.");
  }
  return { interviewId: result.interviewId, analysisId: result.analysisId };
}

/** 저장된 인터뷰 목록입니다. 마지막으로 이어간 시각이 최근인 순서로 옵니다. */
export async function fetchSavedInterviews(
  fetchImpl?: typeof fetch,
  signal?: AbortSignal
): Promise<InterviewListItemPayload[]> {
  const result = await request<{ interviews?: unknown }>(INTERVIEWS_PATH, { signal }, fetchImpl);
  if (result === null || !Array.isArray(result.interviews)) {
    throw new SavedInterviewFetchError("server_error", "서버 응답 형식이 올바르지 않습니다.");
  }
  return result.interviews as InterviewListItemPayload[];
}

/** 인터뷰 하나를 통째로 읽습니다. 대화와 블록 상태와 진행 상태와 근거가 함께 옵니다. */
export async function fetchSavedInterview(
  interviewId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal
): Promise<StoredInterviewPayload> {
  const result = await request<{ interview?: unknown }>(
    `${INTERVIEWS_PATH}/${encodeURIComponent(interviewId)}`,
    { signal },
    fetchImpl
  );
  if (result === null || typeof result.interview !== "object" || result.interview === null) {
    throw new SavedInterviewFetchError("server_error", "서버 응답 형식이 올바르지 않습니다.");
  }
  return result.interview as StoredInterviewPayload;
}

/**
 * 인터뷰를 끝난 것으로 표시합니다. 목록의 기호와 세션 화면의 버튼 문구가 이 값을 읽습니다.
 *
 * 실패해도 대화 자체에는 영향이 없습니다. 상태만 진행 중으로 남습니다.
 */
export async function completeSavedInterview(
  interviewId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal
): Promise<void> {
  await request<null>(
    `${INTERVIEWS_PATH}/${encodeURIComponent(interviewId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
      signal,
    },
    fetchImpl
  );
}

/** 인터뷰 하나를 지웁니다. 이미 지워졌거나 남의 인터뷰면 `not_found`로 올라옵니다. */
export async function deleteSavedInterview(
  interviewId: string,
  fetchImpl?: typeof fetch,
  signal?: AbortSignal
): Promise<void> {
  await request<null>(
    `${INTERVIEWS_PATH}/${encodeURIComponent(interviewId)}`,
    { method: "DELETE", signal },
    fetchImpl
  );
}

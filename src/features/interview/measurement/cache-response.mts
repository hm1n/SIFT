/**
 * 캐시 생성 응답을 값으로 바꾸는 순수 함수입니다.
 *
 * 측정 스크립트에서 떼어 낸 이유는 그 스크립트가 모듈을 읽는 즉시 실행되기 때문입니다. 그대로
 * 두면 이 함수 하나를 테스트하려고 키를 요구하고 API를 부르게 됩니다.
 */

/**
 * 캐시 생성 응답을 읽지 못했을 때의 오류입니다.
 *
 * 성공 상태인데 본문이 잘렸거나 JSON이 아닌 경우가 있습니다. `response.json()`을 그냥 부르면
 * 분류 없는 `SyntaxError`만 남아 어느 모델의 어느 단계에서 깨졌는지가 사라지고, 던지는 자리가
 * 정리 경로보다 앞이라 이미 만들어진 캐시를 지우지도 못합니다.
 */
export class CachedContentParseError extends Error {
  constructor(model: string, detail: string, options?: ErrorOptions) {
    super(`${model}의 캐시 생성 응답을 읽지 못했습니다: ${detail}`, options);
    this.name = "CachedContentParseError";
  }
}

export interface CreatedCache {
  readonly name?: string;
  readonly totalTokenCount?: number;
}

/**
 * 성공 응답 본문을 읽습니다. 파싱 실패를 분류가 있는 오류로 바꿉니다.
 *
 * 문자열을 받아 값만 내므로 회귀 테스트가 붙습니다. 잘린 성공 응답은 실제 API로 만들기 어렵습니다.
 */
export function parseCreatedCache(model: string, raw: string): CreatedCache {
  let parsed: { name?: unknown; usageMetadata?: { totalTokenCount?: unknown } };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (error) {
    throw new CachedContentParseError(model, (error as Error).message, { cause: error });
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new CachedContentParseError(model, "본문이 객체가 아닙니다.");
  }
  return {
    ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
    ...(typeof parsed.usageMetadata?.totalTokenCount === "number"
      ? { totalTokenCount: parsed.usageMetadata.totalTokenCount }
      : {}),
  };
}

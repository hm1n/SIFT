import type { ExperienceCandidateOutputErrorKind } from "@/features/experience-candidates/errors";

/**
 * route가 모델을 부르기 전에 거절할 때 쓰는 분류입니다. `interview/errors.ts`의
 * `InterviewStreamRequestErrorKind`와 같은 패턴이되, 이력 상한 대신 이 경로만 받는 주장 상태 상한이
 * 있어 별도로 둡니다.
 */
export type ExperienceBlockRequestErrorKind =
  | "unauthorized"
  | "invalid_json"
  | "invalid_request"
  | "body_too_large"
  | "history_too_large"
  | "claims_too_large"
  | "server_error";

/**
 * 모델 출력이 `applyBlockUpdate` 검증을 통과하지 못한 경우입니다. 요청이나 서버 설정 문제가 아니라
 * 모델 출력이 흔들린 것이므로 `ExperienceCandidateOutputErrorKind`의 `schema_validation`과 같은
 * 성격(재시도로 풀릴 수 있음)입니다.
 */
export type BlockUpdateRejectedErrorKind = "block_update_rejected";

export type ExperienceBlockErrorKind =
  | ExperienceBlockRequestErrorKind
  | BlockUpdateRejectedErrorKind
  | ExperienceCandidateOutputErrorKind;

/**
 * `Record`로 두는 이유는 `interview/errors.ts`의 같은 패턴과 같습니다. 분류가 추가될 때 여기 빠뜨리면
 * 컴파일이 실패하게 해 새 분류가 조용히 전송 실패로 뭉개지는 것을 막습니다.
 */
const STATUS: Record<ExperienceBlockErrorKind, number> = {
  unauthorized: 401,
  invalid_json: 400,
  invalid_request: 422,
  body_too_large: 413,
  history_too_large: 413,
  claims_too_large: 413,
  server_error: 500,
  block_update_rejected: 502,
  json_parse: 502,
  schema_validation: 502,
  unknown_sha: 502,
  unrelated_sha: 502,
  unknown_file_path: 502,
  llm_network: 502,
  llm_auth: 502,
  llm_rate_limit: 503,
  llm_timeout: 504,
  llm_configuration: 500,
  llm_request: 502,
  llm_failure: 502,
};

export function experienceBlockErrorStatus(kind: ExperienceBlockErrorKind): number {
  return STATUS[kind];
}

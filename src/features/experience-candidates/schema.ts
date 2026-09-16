import { jsonSchema } from "ai";
import { CANDIDATE_CONTRACT_COPY } from "@/copy/candidates";
import { ExperienceCandidateOutputError } from "./errors";
import type {
  ExperienceCandidate,
  ExperienceCandidateEvidenceInput,
  ExperienceCandidateOutput,
  ExperienceCandidateSource,
} from "./types";

const SOURCES: readonly ExperienceCandidateSource[] = [
  "contribution_match",
  "automatic_recommendation",
];

/** JSON Schema의 `required`와 런타임 `hasOnlyKeys`가 같은 목록을 보게 한 곳에 둡니다. */
const CANDIDATE_KEYS = [
  "sha",
  "relatedShas",
  "summary",
  "evidence",
  "technicalTopics",
  "citedFilePaths",
  "source",
] as const;

/**
 * 토픽 개수 상한입니다. 프롬프트로만 요청하고 JSON Schema와 런타임 검증 어느 쪽에서도 세지
 * 않습니다. 넘겨 온 응답은 화면 정규화(`createExperienceCandidateListItems`)가 이 값으로 잘라
 * 레이아웃만 지킵니다.
 *
 * 개수를 강제하면 한 후보가 상한을 넘겼을 때 응답 전체, 즉 후보 최대 `STAGE_B_MAX_CANDIDATES`개가
 * 함께 버려집니다. 토픽이 몇 개 더 오는 것보다 후보가 사라지는 손해가 큽니다(이슈 #110
 * Constraint).
 *
 * JSON Schema의 `maxItems`도 같은 이유로 쓰지 않습니다. `maxItems`는 요청이 아니라 강제입니다.
 * Gemini 구조화 출력이 직접 거부하고 SDK가 `NoObjectGeneratedError`를 던지므로, 런타임 검증과
 * 정규화에 닿기 전에 응답 전체가 사라집니다. 프롬프트가 항목을 잘게 나누라고 유도했을 때 이
 * 경로로 14회 중 3회가 실패했습니다(2026-09-14 실측).
 */
export const MAX_TECHNICAL_TOPICS = 6;

// ponytail: 새 검증 의존성 없이 JSON Schema와 최소 런타임 검증을 병행합니다. 계약 변경 시
// 둘의 불일치가 반복되면 단일 스키마에서 타입과 JSON Schema를 함께 생성하는 방식으로 승격합니다.
/**
 * 후보 개수 상한을 호출부가 정합니다. 상한이 3으로 고정되어 있던 동안에는 Stage B 입력 판단
 * 단위가 1~2개인 저장소에서 "서로 다른 묶음에서 3개"와 "부족 사유 null"을 동시에 만족할 방법이
 * 없어 `schema_validation`으로 실패했습니다(이슈 #108).
 */
function buildCandidateOutputJsonSchema(maxCandidates: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["candidates", "insufficientCandidatesReason"] as string[],
    properties: {
      candidates: {
        type: "array",
        maxItems: maxCandidates,
        items: {
          type: "object",
          additionalProperties: false,
          required: [...CANDIDATE_KEYS] as string[],
          properties: {
            sha: { type: "string", minLength: 1 },
            relatedShas: { type: "array", items: { type: "string", minLength: 1 } },
            // `summary`와 `technicalTopics`에 `minLength`·`minItems`·`maxItems`를 두지 않는 이유는
            // `MAX_TECHNICAL_TOPICS`에 적었습니다.
            summary: { type: "string" },
            evidence: { type: "string", minLength: 1 },
            technicalTopics: { type: "array", items: { type: "string" } },
            citedFilePaths: { type: "array", items: { type: "string", minLength: 1 } },
            source: { type: "string", enum: [...SOURCES] as string[] },
          },
        },
      },
      insufficientCandidatesReason: {
        anyOf: [{ type: "string", minLength: 1 }, { type: "null" }] as Array<
          { type: "string"; minLength: number } | { type: "null" }
        >,
      },
    },
  } as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

/**
 * 빈 문자열 원소를 허용하는 배열 검사입니다. `technicalTopics`에만 씁니다.
 *
 * `isStringArray`를 쓰면 원소 하나가 빈 문자열인 것만으로 응답 전체가 거부되고, 그때
 * `createExperienceCandidateListItems`의 빈 문자열 제거는 도달할 수 없는 코드가 됩니다.
 */
function isLooseStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * 후보 하나의 모양입니다. Stage B 응답과 저장된 분석이 같은 검사를 씁니다(PR #130 리뷰).
 *
 * 저장된 분석을 읽을 때도 이 검사를 거칩니다. 모델 응답에 쓰는 것과 갈라 두면 한쪽만 고쳐지고,
 * 저장은 성공했는데 화면이 그리다 멈추는 값이 남습니다.
 */
export function isCandidate(value: unknown): value is ExperienceCandidate {
  if (!isRecord(value)) return false;

  return (
    hasOnlyKeys(value, CANDIDATE_KEYS) &&
    isNonEmptyString(value.sha) &&
    isStringArray(value.relatedShas) &&
    typeof value.summary === "string" &&
    isNonEmptyString(value.evidence) &&
    isLooseStringArray(value.technicalTopics) &&
    isStringArray(value.citedFilePaths) &&
    typeof value.source === "string" &&
    SOURCES.includes(value.source as ExperienceCandidateSource)
  );
}

/**
 * Stage B 구조화 응답을 검증합니다. 서버의 `selectStageBCandidates`와 클라이언트의
 * `fetchStageBCandidatesFromApi`가 같은 계약으로 한 번씩 봅니다.
 *
 * Stage A는 이 계약을 쓰지 않습니다. 판단 단위마다 판정을 돌려주는 다른 구조라
 * `stage-a.ts`의 `validateStructuredOutput`이 따로 검증합니다.
 *
 * `maxCandidates`는 호출부가 정합니다. Stage B는 입력 커밋 수를 넘기고 판단 단위 상한은 같은
 * Pull Request 후보를 합친 뒤에 따로 적용합니다. 클라이언트는 Stage A 후보 수를 넘깁니다.
 */
export function validateExperienceCandidateOutput(
  value: unknown,
  maxCandidates: number
): ExperienceCandidateOutput {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["candidates", "insufficientCandidatesReason"]) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > maxCandidates ||
    !value.candidates.every(isCandidate)
  ) {
    throw new ExperienceCandidateOutputError(
      "schema_validation",
      CANDIDATE_CONTRACT_COPY.schemaMismatch
    );
  }

  const representativeShas = value.candidates.map(({ sha }) => sha);
  if (new Set(representativeShas).size !== representativeShas.length) {
    throw new ExperienceCandidateOutputError(
      "schema_validation",
      CANDIDATE_CONTRACT_COPY.duplicateSha
    );
  }

  /**
   * 부족 사유를 후보 0개에만 묶습니다.
   *
   * 사유를 필수로 소비하는 유일한 지점은 `repository-analysis.ts`의 non-null 단언이고 그 분기가
   * 후보 0개입니다. `experience-candidate-list.tsx`는 사유가 있으면 보여주는 자리입니다. 후보가
   * 1개 이상일 때 사유를 강제하면, 상한만큼 고른 정상 응답까지 거부하게 됩니다(이슈 #108).
   */
  const reason = value.insufficientCandidatesReason;
  const reasonIsValid =
    value.candidates.length === 0
      ? isNonEmptyString(reason)
      : reason === null || isNonEmptyString(reason);

  if (!reasonIsValid) {
    throw new ExperienceCandidateOutputError(
      "schema_validation",
      CANDIDATE_CONTRACT_COPY.reasonRequired
    );
  }

  return value as unknown as ExperienceCandidateOutput;
}

/** 대표 SHA와 관련 SHA 중 입력 집합에 없는 값이 하나라도 있으면 전체 결과를 거부합니다. */
export function assertCandidateShas(
  output: ExperienceCandidateOutput,
  allowedShas: ReadonlySet<string> | readonly string[]
): ExperienceCandidateOutput {
  const allowed = allowedShas instanceof Set ? allowedShas : new Set(allowedShas);
  const returnedShas = output.candidates.flatMap((candidate) => [
    candidate.sha,
    ...candidate.relatedShas,
  ]);
  const unknownShas = [...new Set(returnedShas.filter((sha) => !allowed.has(sha)))];

  if (unknownShas.length > 0) {
    throw new ExperienceCandidateOutputError(
      "unknown_sha",
      CANDIDATE_CONTRACT_COPY.unknownShas(unknownShas.join(", ")),
      { unknownShas }
    );
  }

  return output;
}

/** Stage B 후보의 PR 관계와 인용 경로를 실제 Repository 근거와 대조합니다. */
export function assertCandidateEvidence(
  output: ExperienceCandidateOutput,
  input: ExperienceCandidateEvidenceInput
): ExperienceCandidateOutput {
  const commitsBySha = new Map(input.commits.map((commit) => [commit.sha, commit]));
  assertCandidateShas(output, [...commitsBySha.keys()]);

  for (const candidate of output.candidates) {
    const representative = commitsBySha.get(candidate.sha)!;
    const representativePullRequests = new Set(
      representative.pullRequests.map((pullRequest) => pullRequest.number)
    );
    /**
     * 대표 커밋이 어느 Pull Request에도 속하지 않으면 관련 커밋도 있을 수 없으므로
     * `relatedShas`는 비어 있어야 합니다.
     *
     * 이 분기를 따로 두지 않으면 빈 `pullRequests`에 대한 `every`가 항상 `true`를 돌려주어,
     * 관련 커밋의 소속과 무관하게 전부 `unrelated_sha`로 거부됩니다. 자기 SHA를 넣은 응답도
     * 같은 이유로 거부됐습니다(이슈 #108). 반대 방향으로 뚫어 주는 것이 아니라, PR이 없는
     * 대표 커밋에서는 어떤 값이든 거부한다는 판정을 명시적으로 적습니다.
     */
    const unrelatedShas =
      representativePullRequests.size === 0
        ? [...candidate.relatedShas]
        : candidate.relatedShas.filter((sha) =>
            commitsBySha
              .get(sha)!
              .pullRequests.every(
                (pullRequest) => !representativePullRequests.has(pullRequest.number)
              )
          );

    if (unrelatedShas.length > 0) {
      throw new ExperienceCandidateOutputError(
        "unrelated_sha",
        CANDIDATE_CONTRACT_COPY.unrelatedShas(unrelatedShas.join(", ")),
        { unknownShas: unrelatedShas }
      );
    }

    const citedPaths = new Set(input.fileTree.map(({ path }) => path));
    for (const sha of [candidate.sha, ...candidate.relatedShas]) {
      for (const file of commitsBySha.get(sha)!.files) citedPaths.add(file.path);
    }

    const unknownPaths = candidate.citedFilePaths.filter((path) => !citedPaths.has(path));
    if (unknownPaths.length > 0) {
      throw new ExperienceCandidateOutputError(
        "unknown_file_path",
        CANDIDATE_CONTRACT_COPY.unknownPaths(unknownPaths.join(", "))
      );
    }
  }

  return output;
}

/**
 * Stage B의 `generateObject` 호출에 직접 전달하는 구조화 출력 스키마입니다.
 *
 * 모듈 상수가 아니라 팩토리인 이유는 후보 개수 상한이 호출마다 다르기 때문입니다. 상한은 Stage B
 * 입력 판단 단위 수에 따라 정해집니다(이슈 #108).
 */
export function createExperienceCandidateOutputSchema(maxCandidates: number) {
  return jsonSchema<ExperienceCandidateOutput>(buildCandidateOutputJsonSchema(maxCandidates), {
    validate(value) {
      try {
        return { success: true, value: validateExperienceCandidateOutput(value, maxCandidates) };
      } catch (error) {
        return {
          success: false,
          error:
            error instanceof ExperienceCandidateOutputError
              ? error
              : new ExperienceCandidateOutputError(
                  "schema_validation",
                  CANDIDATE_CONTRACT_COPY.validationFailed,
                  { cause: error }
                ),
        };
      }
    },
  });
}

import { jsonSchema } from "ai";
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
          required: ["sha", "relatedShas", "evidence", "citedFilePaths", "source"] as string[],
          properties: {
            sha: { type: "string", minLength: 1 },
            relatedShas: { type: "array", items: { type: "string", minLength: 1 } },
            evidence: { type: "string", minLength: 1 },
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

function isCandidate(value: unknown): value is ExperienceCandidate {
  if (!isRecord(value)) return false;

  return (
    hasOnlyKeys(value, ["sha", "relatedShas", "evidence", "citedFilePaths", "source"]) &&
    isNonEmptyString(value.sha) &&
    isStringArray(value.relatedShas) &&
    isNonEmptyString(value.evidence) &&
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
      "경험 후보 구조화 응답이 출력 스키마와 일치하지 않습니다."
    );
  }

  const representativeShas = value.candidates.map(({ sha }) => sha);
  if (new Set(representativeShas).size !== representativeShas.length) {
    throw new ExperienceCandidateOutputError(
      "schema_validation",
      "경험 후보의 대표 커밋 SHA는 서로 달라야 합니다."
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
      "후보가 0개이면 부족 사유가 필요하고, 사유는 null이거나 빈 문자열이 아닌 문자열이어야 합니다."
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
      `입력 집합에 없는 커밋 SHA가 포함되어 있습니다: ${unknownShas.join(", ")}`,
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
        `대표 커밋과 같은 PR에 속하지 않은 관련 SHA가 있습니다: ${unrelatedShas.join(", ")}`,
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
        `Repository 근거에 없는 인용 파일 경로가 있습니다: ${unknownPaths.join(", ")}`
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
                  "경험 후보 구조화 응답 검증에 실패했습니다.",
                  { cause: error }
                ),
        };
      }
    },
  });
}

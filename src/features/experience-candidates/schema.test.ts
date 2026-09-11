import { describe, expect, expectTypeOf, it } from "vitest";
import {
  assertCandidateEvidence,
  assertCandidateShas,
  createExperienceCandidateOutputSchema,
  validateExperienceCandidateOutput,
} from "./schema";
import { ExperienceCandidateOutputError } from "./errors";
import type { ExperienceCandidateOutput } from "./types";

const VALID_OUTPUT: ExperienceCandidateOutput = {
  candidates: [
    {
      sha: "representative",
      relatedShas: ["related"],
      evidence: "PR 안에서 파서와 오류 처리를 함께 구현했습니다.",
      citedFilePaths: ["src/parser.ts"],
      source: "contribution_match",
    },
    {
      sha: "automatic",
      relatedShas: [],
      evidence: "스트리밍 경계를 명확하게 분리했습니다.",
      citedFilePaths: ["src/stream.ts"],
      source: "automatic_recommendation",
    },
    {
      sha: "third",
      relatedShas: [],
      evidence: "실패 상태를 타입으로 구분했습니다.",
      citedFilePaths: ["src/errors.ts"],
      source: "automatic_recommendation",
    },
  ],
  insufficientCandidatesReason: null,
};

describe("경험 후보 출력 검증", () => {
  it("유효한 응답을 타입 안전하게 반환한다", () => {
    const output = validateExperienceCandidateOutput(VALID_OUTPUT, 3);

    expect(output).toEqual(VALID_OUTPUT);
    expectTypeOf(output).toEqualTypeOf<ExperienceCandidateOutput>();
  });

  /**
   * 모델에 보내는 JSON Schema의 `maxItems`는 런타임 검증과 같은 상한을 써야 합니다. 이 값이
   * 굳어 있으면 상한을 올려도 모델 쪽 계약만 옛 값에 남고, 단위 테스트는 전부 통과합니다.
   */
  it("JSON Schema의 maxItems가 넘긴 상한을 따른다", () => {
    const { jsonSchema } = createExperienceCandidateOutputSchema(7);

    expect(
      (jsonSchema as { properties: { candidates: { maxItems: number } } }).properties.candidates
        .maxItems
    ).toBe(7);
  });

  it("스키마 위반을 타입 있는 오류로 변환한다", () => {
    expect(() =>
      validateExperienceCandidateOutput({
        candidates: [{ ...VALID_OUTPUT.candidates[0], source: "ranked" }],
        insufficientCandidatesReason: "후보가 부족합니다.",
      }, 3)
    ).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "schema_validation",
      })
    );
  });

  it("상한보다 적게 고른 응답의 부족 사유를 보존한다", () => {
    const output = validateExperienceCandidateOutput({
      candidates: [VALID_OUTPUT.candidates[0]],
      insufficientCandidatesReason: "근거가 충분한 커밋이 하나뿐입니다.",
    }, 3);

    expect(output.insufficientCandidatesReason).toBe("근거가 충분한 커밋이 하나뿐입니다.");
  });

  /**
   * 이슈 #108 회귀입니다. 부족 사유를 후보 3개 미만에 묶어 두면, 판단 단위가 1~2개인 저장소는
   * 상한만큼 다 골라도 사유가 없다는 이유로 거부됩니다.
   */
  it("후보가 1개 이상이면 부족 사유가 없어도 통과한다", () => {
    const output = validateExperienceCandidateOutput({
      candidates: [VALID_OUTPUT.candidates[0]],
      insufficientCandidatesReason: null,
    }, 1);

    expect(output.candidates).toHaveLength(1);
    expect(output.insufficientCandidatesReason).toBeNull();
  });

  /** 후보 0개에서 사유를 보장하는 계약입니다. `repository-analysis.ts`가 non-null로 읽습니다. */
  it("후보가 0개인데 부족 사유가 없으면 거부한다", () => {
    expect(() =>
      validateExperienceCandidateOutput({
        candidates: [],
        insufficientCandidatesReason: null,
      }, 3)
    ).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "schema_validation",
      })
    );
  });

  it("후보가 상한을 초과하면 거부한다", () => {
    expect(() =>
      validateExperienceCandidateOutput({
        candidates: [...VALID_OUTPUT.candidates, VALID_OUTPUT.candidates[0]],
        insufficientCandidatesReason: null,
      }, 3)
    ).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "schema_validation",
      })
    );
  });

  it("같은 대표 SHA를 여러 후보로 반복하면 거부한다", () => {
    expect(() =>
      validateExperienceCandidateOutput({
        candidates: VALID_OUTPUT.candidates.map((candidate) => ({
          ...candidate,
          sha: "representative",
        })),
        insufficientCandidatesReason: null,
      }, 3)
    ).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "schema_validation",
      })
    );
  });
});

describe("후보 SHA 검증", () => {
  it("대표 SHA와 관련 SHA가 모두 입력에 있으면 전체 결과를 반환한다", () => {
    expect(
      assertCandidateShas(VALID_OUTPUT, ["representative", "related", "automatic", "third"])
    ).toBe(VALID_OUTPUT);
  });

  it("하나라도 입력에 없는 SHA이면 일부 후보도 반환하지 않고 오류로 처리한다", () => {
    expect(() =>
      assertCandidateShas(VALID_OUTPUT, ["representative", "automatic", "third"])
    ).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "unknown_sha",
        unknownShas: ["related"],
      })
    );
  });
});

describe("후보 Repository 근거 검증", () => {
  const evidenceInput = {
    commits: [
      {
        sha: "representative",
        files: [{ path: "src/parser.ts" }],
        pullRequests: [{ number: 10 }],
      },
      {
        sha: "related",
        files: [{ path: "src/parser.test.ts" }],
        pullRequests: [{ number: 10 }],
      },
      {
        sha: "automatic",
        files: [{ path: "src/stream.ts" }],
        pullRequests: [],
      },
      {
        sha: "third",
        files: [{ path: "src/errors.ts" }],
        pullRequests: [],
      },
    ],
    fileTree: [{ path: "README.md" }],
  };

  it("입력에 존재해도 대표 커밋과 같은 PR이 아닌 관련 SHA는 거부한다", () => {
    const output = {
      ...VALID_OUTPUT,
      candidates: [
        { ...VALID_OUTPUT.candidates[0], relatedShas: ["automatic"] },
        ...VALID_OUTPUT.candidates.slice(1),
      ],
    };

    expect(() => assertCandidateEvidence(output, evidenceInput)).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "unrelated_sha",
      })
    );
  });

  /**
   * 이슈 #108 회귀입니다. 대표 커밋의 `pullRequests`가 비어 있으면 빈 배열에 대한 `every`가 항상
   * `true`라, 관련 SHA가 무엇이든 `unrelated_sha`가 됐습니다. 자기 SHA를 넣은 응답도 같습니다.
   */
  it("Pull Request가 없는 대표 커밋의 관련 SHA는 자기 SHA라도 거부한다", () => {
    const output = {
      ...VALID_OUTPUT,
      candidates: [
        VALID_OUTPUT.candidates[0],
        { ...VALID_OUTPUT.candidates[1], relatedShas: ["automatic"] },
        VALID_OUTPUT.candidates[2],
      ],
    };

    expect(() => assertCandidateEvidence(output, evidenceInput)).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "unrelated_sha",
        unknownShas: ["automatic"],
      })
    );
  });

  it("Pull Request가 없는 대표 커밋도 관련 SHA가 비어 있으면 통과한다", () => {
    expect(assertCandidateEvidence(VALID_OUTPUT, evidenceInput)).toBe(VALID_OUTPUT);
  });

  it("Repository 파일 트리와 후보 커밋에 없는 인용 경로는 거부한다", () => {
    const output = {
      ...VALID_OUTPUT,
      candidates: [
        { ...VALID_OUTPUT.candidates[0], citedFilePaths: ["src/invented.ts"] },
        ...VALID_OUTPUT.candidates.slice(1),
      ],
    };

    expect(() => assertCandidateEvidence(output, evidenceInput)).toThrowError(
      expect.objectContaining<Partial<ExperienceCandidateOutputError>>({
        kind: "unknown_file_path",
      })
    );
  });
});

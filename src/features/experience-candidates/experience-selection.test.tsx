// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CandidateDataOutput, ReadonlyCommitDetail } from "@/lib/github/types";
import type { CandidateDiff, ExperienceCandidate, StageBCandidateResult } from "./types";
import { ExperienceCandidateList } from "./experience-candidate-list";
import {
  EVIDENCE_SNAPSHOT_BYTES_PER_TOKEN,
  EVIDENCE_SNAPSHOT_MAX_INPUT_TOKENS,
} from "./evidence-snapshot";

const CONFIRM_LABEL = "인터뷰 시작";
const BACK_LABEL = "← 뒤로";
/** 확정 실패 안내에서 돌아가는 버튼입니다. InterviewScreen 자체의 뒤로가기(BACK_LABEL)와는 다른 버튼입니다. */
const CANDIDATE_BACK_LABEL = "← 후보 목록으로";

const commit = (
  sha: string,
  title: string,
  files: ReadonlyCommitDetail["files"] = [
    { path: `src/${sha}.ts`, status: "modified", additions: 10, deletions: 2, changes: 12 },
  ]
): ReadonlyCommitDetail => ({
  sha,
  title,
  author: "octocat",
  date: "2026-08-24T00:00:00Z",
  parentCount: 1,
  message: title,
  additions: 10,
  deletions: 2,
  changedFiles: files.length,
  files,
  pullRequests: [],
});

/**
 * 이 파일의 관심은 확정 전이와 근거 스냅샷이라 행을 커밋 제목으로 찾습니다. `summary`를 비워
 * 제목이 대표 커밋 제목으로 떨어지게 두면 선택자를 바꾸지 않고 그 관심만 볼 수 있습니다.
 * 제목을 `summary`가 정한다는 계약 자체는 `experience-candidate-list.test.tsx`와
 * `experience-candidate-detail.test.tsx`가 봅니다.
 */
const candidate = (sha: string, overrides: Partial<ExperienceCandidate> = {}): ExperienceCandidate => ({
  sha,
  relatedShas: [],
  summary: "",
  evidence: `${sha}의 Repository 근거입니다.`,
  technicalTopics: [],
  citedFilePaths: [],
  source: "automatic_recommendation",
  ...overrides,
});

function renderList(
  candidateItems: readonly ExperienceCandidate[],
  commits: readonly ReadonlyCommitDetail[],
  diffs: readonly CandidateDiff[] = []
) {
  const data: CandidateDataOutput = {
    allCommits: commits,
    includedCommits: commits,
    repository: { fileTree: [], treeTruncated: false, languages: {} },
  };
  const candidates: StageBCandidateResult = {
    candidates: candidateItems,
    insufficientCandidatesReason: candidateItems.length < 3 ? "후보가 부족합니다." : null,
    diffs,
  };
  render(
    <ExperienceCandidateList
      repository={{ owner: "hm1n", repo: "demian" }}
      data={data}
      candidates={candidates}
      onSelectRepository={vi.fn()}
    />
  );
}

// 확정하면 인터뷰 화면이 질문 스트림에 바로 연결합니다. 이 테스트의 관심은 확정 상태 전이이므로
// 응답이 오지 않는 `fetch`로 스트림을 준비 상태에 묶어 둡니다.
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise<Response>(() => {})));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("경험 선택 확정과 인터뷰 진입점", () => {
  it("상세 화면의 선택 액션으로 인터뷰 대상을 확정한다", () => {
    renderList([candidate("aaa")], [commit("aaa", "재시도 큐 도입")]);

    fireEvent.click(screen.getByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(screen.getByText("Experience")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "재시도 큐 도입" })).toBeInTheDocument();
    expect(screen.getByText("질문을 준비하고 있습니다.")).toBeInTheDocument();
    // 근거는 #98부터 왼쪽 코드 패널이 그립니다.
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /aaa\.ts/ })).toBeInTheDocument();
  });

  it("목록으로 돌아가 다른 경험을 확정하면 확정 상태가 교체된다", () => {
    renderList(
      [candidate("aaa"), candidate("bbb")],
      [commit("aaa", "재시도 큐 도입"), commit("bbb", "지연 시간 조정")]
    );

    fireEvent.click(screen.getByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(screen.getByRole("heading", { name: "재시도 큐 도입" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));
    // 인터뷰 화면의 뒤로가기는 대화가 사라진다는 확인을 한 번 받습니다.
    fireEvent.click(screen.getByRole("button", { name: "후보 목록으로" }));
    fireEvent.click(screen.getByRole("button", { name: /지연 시간 조정/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(screen.getByRole("heading", { name: "지연 시간 조정" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "재시도 큐 도입" })).not.toBeInTheDocument();
  });

  it("최종 후보가 없으면 선택 액션을 노출하지 않는다", () => {
    renderList([], []);

    expect(screen.queryByRole("button", { name: CONFIRM_LABEL })).not.toBeInTheDocument();
  });

  it("대표 커밋을 색인에서 찾지 못하면 무엇이 부족한지 알리고 목록으로 돌아갈 수 있다", () => {
    renderList([candidate("abcdef123456")], []);

    fireEvent.click(screen.getByRole("button", { name: /색인되지 않은 커밋 · abcdef1/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-selection-error", "representative_commit_not_indexed");
    expect(alert).toHaveTextContent("대표 커밋을 커밋 색인에서 찾지 못해");
    expect(screen.queryByText("AI 인터뷰")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: CANDIDATE_BACK_LABEL }));
    expect(screen.getByText("1 experience 발견")).toBeInTheDocument();
  });

  it("대표 커밋에 변경 파일이 없으면 근거가 없다고 알린다", () => {
    renderList([candidate("aaa")], [commit("aaa", "빈 커밋", [])]);

    fireEvent.click(screen.getByRole("button", { name: /빈 커밋/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(screen.getByRole("alert")).toHaveAttribute(
      "data-selection-error",
      "no_repository_evidence"
    );
  });

  it("목록으로 돌아가면 이전 실패 안내가 남지 않는다", () => {
    renderList([candidate("aaa")], [commit("aaa", "빈 커밋", [])]);

    fireEvent.click(screen.getByRole("button", { name: /빈 커밋/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: CANDIDATE_BACK_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: /빈 커밋/ }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("다른 후보를 바로 선택하면(뒤로가기 없이) 이전 후보의 실패 안내가 새 후보에 남지 않는다", () => {
    renderList(
      [candidate("aaa"), candidate("bbb")],
      [commit("aaa", "빈 커밋", []), commit("bbb", "정상 커밋")]
    );

    fireEvent.click(screen.getByRole("button", { name: /빈 커밋/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(screen.getByRole("alert")).toHaveAttribute("data-selection-error", "no_repository_evidence");

    fireEvent.click(screen.getByRole("button", { name: /정상 커밋/ }));

    expect(screen.getByRole("heading", { name: "정상 커밋" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("선택 액션의 접근성 이름이 확인 가능·불가 안내를 가리지 않는다", () => {
    renderList([candidate("aaa")], [commit("aaa", "접근성 검증")]);

    fireEvent.click(screen.getByRole("button", { name: /접근성 검증/ }));
    const action = screen.getByRole("button", { name: CONFIRM_LABEL });

    expect(action).toHaveAccessibleName(CONFIRM_LABEL);
    expect(action).toHaveAccessibleDescription(/Unverifiable · AI가 쓴 해석입니다/);
    expect(action).toHaveAccessibleDescription(/Verified/);
  });

  /*
    #98 전에는 확정 화면이 대표 커밋 변경 파일·관련 커밋·인용 파일 개수를 나열하고 개수마다 확인
    수준 태그를 붙였습니다. 3열 개편으로 그 목록이 사라져 개수별 태그를 확인할 자리가 없습니다.
    태그 경계 자체(PR #57 1차 리뷰 P2)는 `experience-candidate-detail.test.tsx`가 계속 지키고,
    여기서는 확정 뒤에도 AI 선택 안내가 화면에 남는지만 봅니다.
  */
  it("확정 화면은 관련 커밋의 관련성 판단이 확인 불가라는 안내를 남긴다", () => {
    renderList(
      [candidate("aaa", { relatedShas: ["bbb"], citedFilePaths: ["src/aaa.ts"] })],
      [commit("aaa", "근거 표시 경계"), commit("bbb", "관련 커밋")]
    );

    fireEvent.click(screen.getByRole("button", { name: /근거 표시 경계/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(
      screen.getByText(/근거로서 실제로 관련 있는지는 확인할 수 없습니다/)
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Code / Evidence" })).toHaveAccessibleDescription(
      /Unverifiable · AI가 쓴 해석입니다/
    );
  });

  it("근거 상한 때문에 patch를 자르면 확정 화면이 그 사실을 알린다", () => {
    renderList(
      [candidate("aaa")],
      [commit("aaa", "상한 절단")],
      [
        {
          sha: "aaa",
          files: [
            {
              path: "src/aaa.ts",
              status: "modified",
              additions: 10,
              deletions: 2,
              changes: 12,
              patch: "x".repeat(
                EVIDENCE_SNAPSHOT_MAX_INPUT_TOKENS * EVIDENCE_SNAPSHOT_BYTES_PER_TOKEN
              ),
            },
          ],
        },
      ]
    );

    fireEvent.click(screen.getByRole("button", { name: /상한 절단/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(screen.getByText(/맞추려고 코드 변경을 줄였습니다/)).toBeInTheDocument();
  });

  it("파일 단위로 절단 표시된 patch도 인터뷰 화면이 알린다", () => {
    renderList(
      [candidate("aaa")],
      [commit("aaa", "상위 절단 표시")],
      [
        {
          sha: "aaa",
          files: [
            {
              path: "src/aaa.ts",
              status: "modified",
              additions: 10,
              deletions: 2,
              changes: 12,
              patchTruncated: true,
            },
          ],
        },
      ]
    );

    fireEvent.click(screen.getByRole("button", { name: /상위 절단 표시/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    expect(screen.getByText(/이 diff는 잘렸습니다/)).toBeInTheDocument();
  });

  // PR #105 Codex 리뷰 P1: 인터뷰 활성 여부를 상위가 모르면 AppShell 사이드바의 Repository 변경가
  // InterviewScreen의 이탈 확인을 건너뛰고 대화를 잃습니다. 확정·목록 복귀마다 상위에 알려야 합니다.
  it("인터뷰를 확정하고 목록으로 돌아갈 때마다 onInterviewActiveChange를 부른다", () => {
    const onInterviewActiveChange = vi.fn();
    const data: CandidateDataOutput = {
      allCommits: [commit("aaa", "재시도 큐 도입")],
      includedCommits: [commit("aaa", "재시도 큐 도입")],
      repository: { fileTree: [], treeTruncated: false, languages: {} },
    };
    const candidates: StageBCandidateResult = {
      candidates: [candidate("aaa")],
      insufficientCandidatesReason: "후보가 부족합니다.",
      diffs: [],
    };
    render(
      <ExperienceCandidateList
        repository={{ owner: "hm1n", repo: "demian" }}
        data={data}
        candidates={candidates}
        onSelectRepository={vi.fn()}
        onInterviewActiveChange={onInterviewActiveChange}
      />
    );
    expect(onInterviewActiveChange).toHaveBeenLastCalledWith(false);

    fireEvent.click(screen.getByRole("button", { name: /재시도 큐 도입/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));
    expect(onInterviewActiveChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: BACK_LABEL }));
    fireEvent.click(screen.getByRole("button", { name: "후보 목록으로" }));
    expect(onInterviewActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("근거가 입력 상한을 넘으면 무엇이 부족한지 알린다", () => {
    renderList(
      [candidate("aaa")],
      [{ ...commit("aaa", "거대한 커밋 메시지"), message: "긴 커밋 메시지 ".repeat(5_000) }]
    );

    fireEvent.click(screen.getByRole("button", { name: /거대한 커밋 메시지/ }));
    fireEvent.click(screen.getByRole("button", { name: CONFIRM_LABEL }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-selection-error", "evidence_input_too_large");
    expect(alert).toHaveTextContent("코드 변경을 빼고");
  });
});

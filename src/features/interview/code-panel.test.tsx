// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { CodePanel } from "./code-panel";
import {
  evidenceSnapshotFixture,
  FIXTURE_RELATED_SHA,
  snapshotCommit,
  snapshotFile,
} from "./question-fixture";

afterEach(cleanup);

/**
 * 픽스처 기본값은 관련 커밋 1개와 상한 절단이 있는 스냅샷입니다. 절단 표시와 관련 커밋 표시를 각각
 * 확인하려면 출발점이 둘 다 없는 상태여야 하므로 여기서 걷어냅니다. 스냅샷을 손으로 다시 만들지
 * 않는 이유는 필드 간 일관성 조건이 걸려 있어서입니다(`question-fixture.ts` 주석).
 */
const snapshot = (overrides: Partial<ExperienceEvidenceSnapshot> = {}): ExperienceEvidenceSnapshot => {
  const base = evidenceSnapshotFixture();
  return {
    ...base,
    relatedCommits: [],
    patchBudget: { ...base.patchBudget, truncatedByBudget: false },
    ...overrides,
  };
};

const truncatedBudget = (base: ExperienceEvidenceSnapshot["patchBudget"]) => ({
  ...base,
  truncatedByBudget: true,
});

describe("CodePanel", () => {
  it("변경 파일을 디렉터리로 묶어 트리에 그린다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [
              snapshotFile({ path: "src/features/interview/sse.ts" }),
              snapshotFile({ path: "src/lib/github/client.ts" }),
            ],
          }),
        })}
      />
    );

    expect(screen.getByRole("button", { name: /sse\.ts/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /client\.ts/ })).toBeInTheDocument();
    // 공통 접두어 `src`를 덜어낸 이름입니다.
    expect(screen.getByText("features/interview")).toBeInTheDocument();
    expect(screen.getByText("lib/github")).toBeInTheDocument();
  });

  it("파일 행에 상태와 +/- 통계를 함께 보여 준다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [snapshotFile({ path: "src/a.ts", status: "added", additions: 9, deletions: 7 })],
          }),
        })}
      />
    );

    const row = screen.getByRole("button", { name: /a\.ts/ });
    expect(row).toHaveAccessibleName(/Added/);
    expect(row).toHaveTextContent("+9");
    expect(row).toHaveTextContent("−7");
  });

  it("첫 파일을 선택한 상태로 시작하고 다른 파일을 고르면 그 파일의 diff로 바꾼다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [
              snapshotFile({ path: "src/a.ts", patch: "@@ -1,1 +1,1 @@\n+from a" }),
              snapshotFile({ path: "src/b.ts", patch: "@@ -1,1 +1,1 @@\n+from b" }),
            ],
          }),
        })}
      />
    );

    expect(screen.getByText("from a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /b\.ts/ }));

    expect(screen.getByText("from b")).toBeInTheDocument();
    expect(screen.queryByText("from a")).not.toBeInTheDocument();
  });

  it("diff 줄에 줄 번호와 +/- 기호를 붙인다", () => {
    const { container } = render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [snapshotFile({ patch: "@@ -10,2 +10,2 @@\n-gone\n+added" })],
          }),
        })}
      />
    );

    const deleted = container.querySelector('[data-type="del"]');
    const added = container.querySelector('[data-type="add"]');
    expect(deleted).toHaveTextContent("10");
    expect(deleted).toHaveTextContent("−");
    expect(added).toHaveTextContent("10");
    expect(added).toHaveTextContent("+");
  });

  it("한 파일이 여러 커밋에서 바뀌었으면 커밋 선택기로 넘겨 본다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [snapshotFile({ path: "src/a.ts", patch: "@@ -1,1 +1,1 @@\n+first commit" })],
          }),
          relatedCommits: [
            snapshotCommit({
              sha: FIXTURE_RELATED_SHA,
              role: "related",
              files: [snapshotFile({ path: "src/a.ts", patch: "@@ -1,1 +1,1 @@\n+second commit" })],
            }),
          ],
        })}
      />
    );

    expect(screen.getByText("Commits / 02")).toBeInTheDocument();
    expect(screen.getByText("first commit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous commit" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next commit" }));

    expect(screen.getByText("second commit")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next commit" })).toBeDisabled();
  });

  it("커밋이 하나뿐인 파일에는 커밋 선택기를 두지 않는다", () => {
    render(<CodePanel snapshot={snapshot()} />);

    expect(screen.queryByRole("button", { name: "Next commit" })).not.toBeInTheDocument();
  });

  it("파일 목록을 접으면 트리를 감추고 선택한 파일명만 남긴다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({ files: [snapshotFile({ path: "src/a.ts" })] }),
        })}
      />
    );

    const tree = screen.getByRole("button", { name: /a\.ts/ }).closest("[id='code-panel-file-tree']");
    expect(tree).not.toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Collapse file list" }));

    expect(tree).toHaveAttribute("hidden");
    expect(screen.getByText("· a.ts")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand file list" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
  });

  // 근거 스냅샷에 파일 전체 원문이 없습니다. 자리를 비우지 않고 비활성으로 두되 이유를 남깁니다.
  it("FILE 모드는 비활성이고 이유를 접근성 이름에 남긴다", () => {
    render(<CodePanel snapshot={snapshot()} />);

    const fileMode = screen.getByRole("button", { name: /^File/ });
    expect(fileMode).toBeDisabled();
    expect(fileMode).toHaveAccessibleName(/only changed patches/);
    expect(screen.getByRole("button", { name: "Diff" })).toHaveAttribute("aria-pressed", "true");
  });

  it("스냅샷 상한 절단을 알린다", () => {
    const base = snapshot();
    render(<CodePanel snapshot={{ ...base, patchBudget: truncatedBudget(base.patchBudget) }} />);

    expect(screen.getByText(/trimmed to fit the estimated evidence input limit/)).toBeInTheDocument();
  });

  it("파일 단위 절단 표시도 알린다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({ files: [snapshotFile({ patchTruncated: true })] }),
        })}
      />
    );

    expect(screen.getByText(/This diff was truncated/)).toBeInTheDocument();
  });

  // 보는 자리가 달라 하나가 있어도 나머지를 감추지 않습니다. 앞은 스냅샷 전체의 상한 절단이고
  // 뒤는 파일 단위 절단입니다.
  it("상한 절단과 파일 단위 절단이 함께 있으면 둘 다 알린다", () => {
    const base = snapshot({
      representativeCommit: snapshotCommit({ files: [snapshotFile({ patchTruncated: true })] }),
    });
    render(<CodePanel snapshot={{ ...base, patchBudget: truncatedBudget(base.patchBudget) }} />);

    expect(screen.getByText(/trimmed to fit the estimated evidence input limit/)).toBeInTheDocument();
    expect(screen.getByText(/This diff was truncated/)).toBeInTheDocument();
  });

  it("patch 본문이 없는 이유를 예산 소진과 GitHub 미제공으로 구분한다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            files: [
              snapshotFile({ path: "src/a.ts", patch: null, patchOmittedReason: "budget_exhausted" }),
              snapshotFile({ path: "src/b.ts", patch: null, patchOmittedReason: "not_provided" }),
            ],
          }),
        })}
      />
    );

    expect(screen.getByText(/evidence input limit was used up/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /b\.ts/ }));

    expect(screen.getByText(/GitHub didn't provide a patch/)).toBeInTheDocument();
  });

  it("patch 본문을 화면에서 자르지 않고 모든 줄을 그린다", () => {
    const patch = `@@ -1,1 +1,400 @@\n${Array.from({ length: 400 }, (_, index) => `+line ${index}`).join("\n")}`;
    const { container } = render(
      <CodePanel
        snapshot={snapshot({ representativeCommit: snapshotCommit({ files: [snapshotFile({ patch })] }) })}
      />
    );

    // 화면이 한 번 더 자르면 Stage B 절단·스냅샷 절단과 구분되지 않는 세 번째 절단이 생깁니다.
    expect(container.querySelectorAll('[data-type="add"]')).toHaveLength(400);
    expect(screen.getByText("line 399")).toBeInTheDocument();
  });

  it("색인에서 찾지 못한 커밋은 무엇을 확인할 수 없는지 알린다", () => {
    render(
      <CodePanel
        snapshot={snapshot({
          representativeCommit: snapshotCommit({
            indexed: false,
            title: null,
            message: null,
            pullRequests: [],
          }),
        })}
      />
    );

    expect(screen.getByText(/Not found in the commit index/)).toBeInTheDocument();
  });

  // 디자인에 이 문구들의 자리가 없어 시각적으로 숨기지만, DOM에서 지우면 스크린리더가 확인 가능·불가
  // 구분을 듣지 못합니다. 이슈 #47 PR #52 1차 리뷰의 P1이 그 실수였습니다.
  it("확인 가능·불가 안내를 패널의 접근성 설명으로 계속 노출한다", () => {
    render(<CodePanel snapshot={snapshot()} />);

    const panel = screen.getByRole("region", { name: "Code / Evidence" });
    expect(panel).toHaveAccessibleDescription(/Verified/);
    expect(panel).toHaveAccessibleDescription(/Unverifiable · AI-written interpretation/);
  });

  it("관련 커밋이 있으면 관련성 판단이 확인 불가라는 안내를 남긴다", () => {
    render(<CodePanel snapshot={evidenceSnapshotFixture()} />);

    expect(
      screen.getByText(/Confirmed only as belonging to the same PR as the representative commit/)
    ).toBeInTheDocument();
  });

  it("Repository로 확인할 수 없는 항목을 계속 싣는다", () => {
    render(<CodePanel snapshot={snapshot()} />);

    expect(
      screen.getByRole("heading", { name: "What can't be confirmed from the Repository" })
    ).toBeInTheDocument();
    expect(screen.getByText("실제 근무 기간")).toBeInTheDocument();
    expect(screen.getByText("팀 안에서의 역할")).toBeInTheDocument();
  });
});

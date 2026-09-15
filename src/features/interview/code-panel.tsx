"use client";

import { useState } from "react";
import { CODE_PANEL_COPY, FILE_STATUS_LABEL, PATCH_OMITTED_COPY } from "@/copy/interview";
import {
  EVIDENCE_VERIFIABILITY_NOTICE,
  RELATED_COMMITS_VERIFICATION_NOTICE,
  REPOSITORY_VERIFIED_NOTICE,
} from "@/features/experience-candidates/evidence-verifiability";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { parsePatch, type DiffLine } from "./diff-patch";
import {
  collectEvidenceFiles,
  groupEvidenceFilesByDirectory,
  type EvidenceFile,
  type EvidenceFileCommit,
  type EvidenceFileStatus,
} from "./evidence-files";
import styles from "./code-panel.module.css";

/**
 * 인터뷰 워크스페이스 왼쪽 열입니다. 질문의 근거가 된 커밋과 코드 변경 내역을 파일 트리와 diff
 * 뷰어로 보여 줍니다. `InterviewEvidencePanel`(질문 아래 한 열)을 대체합니다.
 *
 * 스냅샷의 `커밋 → 파일`을 `evidence-files.ts`가 `파일 → 커밋`으로 뒤집은 결과를 그립니다. 사용자가
 * 파일을 고르고 그 파일이 어느 커밋에서 어떻게 바뀌었는지 넘겨 보는 것이 이 패널의 조작입니다.
 *
 * **Loading과 Error 상태를 만들지 않았습니다.** 근거 스냅샷은 `confirmExperienceSelection`이 확정
 * 시점에 동기 순수 함수로 만들고, 실패는 후보 화면에서 `EXPERIENCE_SELECTION_ERROR_COPY`로 갈립니다.
 * 이 패널이 그려지는 시점에는 근거가 이미 완성돼 있어 기다릴 것도 다시 시도할 것도 없습니다.
 * 도달할 수 없는 분기를 만들면 검증할 수 없는 코드가 남습니다. 이슈 #98 Goal과의 차이와 그 판단
 * 근거는 `llm-wiki/wiki/2026-09-14-인터뷰-3열-워크스페이스.md`에 있습니다. 실제로 도달하는 상태는
 * 선택한 파일의 그 커밋 patch 본문이 없는 경우 하나뿐이고, 아래 `NO DIFF BODY`가 그 자리입니다.
 *
 * 확인 가능·불가 안내는 시각적으로만 숨기고 DOM과 `aria-describedby` 연결은 남깁니다. 디자인에 이
 * 문구들의 자리가 없지만 DOM에서 지우면 스크린리더가 설명을 잃습니다. 이슈 #47 PR #52 1차 리뷰의
 * P1이 그 실수였습니다. 반대로 patch 절단·미포함 안내는 근거가 온전한지 판단하는 데 직접 쓰이므로
 * 눈에 보이는 자리를 따로 만듭니다.
 */

export const CODE_PANEL_EVIDENCE_NOTICE_ID = "code-panel-evidence-verifiability-notice";
export const CODE_PANEL_VERIFIED_NOTICE_ID = "code-panel-repository-verified-notice";

/** 파일 행에 붙는 한 글자 표시입니다. 스크린리더가 읽는 말은 `FILE_STATUS_LABEL`에 있습니다. */
const STATUS_MARK: Record<EvidenceFileStatus, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

const padded = (count: number) => String(count).padStart(2, "0");

interface CodePanelProps {
  snapshot: ExperienceEvidenceSnapshot;
}

export function CodePanel({ snapshot }: CodePanelProps) {
  const files = collectEvidenceFiles([snapshot.representativeCommit, ...snapshot.relatedCommits]);
  const groups = groupEvidenceFilesByDirectory(files);

  const [selectedPath, setSelectedPath] = useState(files[0]?.path ?? "");
  const [commitIndex, setCommitIndex] = useState(0);
  const [filesCollapsed, setFilesCollapsed] = useState(false);

  // `no_repository_evidence`가 변경 파일 0개인 근거를 확정 단계에서 이미 막으므로 파일은 항상
  // 하나 이상입니다. 여기서 방어하는 것은 빈 목록이 아니라 고른 경로가 목록에 없는 경우
  // 하나뿐입니다. 도달하지 않는 빈 상태 화면은 만들지 않습니다.
  const selectedFile: EvidenceFile =
    files.find((file) => file.path === selectedPath) ?? files[0];

  function selectFile(path: string) {
    setSelectedPath(path);
    setCommitIndex(0);
  }

  return (
    <section
      className={styles.panel}
      aria-labelledby="code-panel-heading"
      aria-describedby={`${CODE_PANEL_VERIFIED_NOTICE_ID} ${CODE_PANEL_EVIDENCE_NOTICE_ID}`}
    >
      <div className={styles.panelHeader}>
        <h3 id="code-panel-heading" className={styles.panelHeading}>
          Code / Evidence
        </h3>
        <div className={styles.viewModes} role="group" aria-label={CODE_PANEL_COPY.viewModeLabel}>
          <button type="button" className={styles.viewMode} aria-pressed={true}>
            Diff
          </button>
          {/*
            FILE 모드는 파일 전체 원문이 있어야 하는데 근거 스냅샷은 변경 patch만 싣습니다. 자리를
            비워 두면 디자인의 토글이 사라지므로 비활성 상태로 남기고 이유를 함께 둡니다.
          */}
          <button type="button" className={styles.viewMode} disabled aria-pressed={false}>
            File
            <span className={styles.visuallyHidden}>
              {CODE_PANEL_COPY.fileModeUnavailable}
            </span>
          </button>
        </div>
      </div>

      <div className={`${styles.filesSection} ${filesCollapsed ? styles.filesCollapsed : ""}`}>
        <div className={styles.filesHeader}>
          <span className={styles.sectionLabel}>Files</span>
          <span className={styles.sectionCount}>/ {padded(files.length)}</span>
          {filesCollapsed ? (
            <span className={styles.collapsedFilename}>· {selectedFile.filename}</span>
          ) : null}
          <button
            type="button"
            className={styles.collapseButton}
            aria-expanded={!filesCollapsed}
            aria-controls="code-panel-file-tree"
            onClick={() => setFilesCollapsed((collapsed) => !collapsed)}
          >
            {filesCollapsed ? CODE_PANEL_COPY.expandFiles : CODE_PANEL_COPY.collapseFiles}
          </button>
        </div>

        <div className={styles.fileTree} id="code-panel-file-tree" hidden={filesCollapsed}>
          {groups.map((group) => (
            <div key={group.directory} className={styles.directory}>
              <p className={styles.directoryLabel}>{group.label}</p>
              <ul className={styles.fileList}>
                {group.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={styles.fileRow}
                      aria-current={file.path === selectedFile?.path}
                      onClick={() => selectFile(file.path)}
                    >
                      <span className={styles.fileStatus} data-status={file.status} aria-hidden="true">
                        {STATUS_MARK[file.status]}
                      </span>
                      <span className={styles.visuallyHidden}>{FILE_STATUS_LABEL[file.status]}</span>
                      <span className={styles.filename}>{file.filename}</span>
                      <span className={styles.fileStat} data-kind="add">
                        +{file.additions}
                      </span>
                      <span className={styles.fileStat} data-kind="del">
                        −{file.deletions}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/*
        커밋 번호는 함께 좁힙니다. `selectFile`이 0으로 되돌리지만, 고른 경로가 목록에서
        사라져 첫 파일로 떨어지는 길은 `selectFile`을 지나지 않아 앞 파일의 번호가 남습니다.
      */}
      <SelectedFileDiff
        file={selectedFile}
        commitIndex={Math.min(commitIndex, selectedFile.commits.length - 1)}
        onCommitIndexChange={setCommitIndex}
      />

      {/*
        스냅샷 전체의 상한 절단입니다. 파일 단위 절단과 보는 자리가 달라 하나가 나머지를 감추지
        않습니다. 선택한 파일과 무관하게 참이므로 패널 바닥에 둡니다.
      */}
      {snapshot.patchBudget.truncatedByBudget ? (
        <p className={styles.panelNotice}>
          {CODE_PANEL_COPY.budgetTrimmed(snapshot.patchBudget.patchBytes.toLocaleString("en-US"))}
        </p>
      ) : null}

      {/*
        아래 셋은 시각적으로만 숨깁니다. 디자인의 코드 패널에 자리가 없지만 DOM에서 지우면 위
        `aria-describedby`가 가리킬 곳을 잃고 스크린리더가 확인 가능·불가 구분을 듣지 못합니다.
      */}
      <p id={CODE_PANEL_VERIFIED_NOTICE_ID} className={styles.visuallyHidden}>
        {REPOSITORY_VERIFIED_NOTICE}
      </p>
      <p id={CODE_PANEL_EVIDENCE_NOTICE_ID} className={styles.visuallyHidden}>
        {EVIDENCE_VERIFIABILITY_NOTICE}
      </p>
      {snapshot.relatedCommits.length > 0 ? (
        <p className={styles.visuallyHidden}>{RELATED_COMMITS_VERIFICATION_NOTICE}</p>
      ) : null}
      {snapshot.unverifiableItems.length > 0 ? (
        <section className={styles.visuallyHidden} aria-labelledby="code-panel-unverifiable-heading">
          <h4 id="code-panel-unverifiable-heading">{CODE_PANEL_COPY.unverifiableHeading}</h4>
          <p>{CODE_PANEL_COPY.unverifiableIntro}</p>
          <ul>
            {snapshot.unverifiableItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function SelectedFileDiff({
  file,
  commitIndex,
  onCommitIndexChange,
}: {
  file: EvidenceFile;
  commitIndex: number;
  onCommitIndexChange: (index: number) => void;
}) {
  const commit: EvidenceFileCommit = file.commits[commitIndex];
  const lines = commit.file.patch === null ? [] : parsePatch(commit.file.patch);

  return (
    <div className={styles.diffSection}>
      <div className={styles.diffHeader}>
        <p className={styles.sectionLabel}>Selected file</p>
        <p className={styles.diffPath} title={file.path}>
          {file.path}
        </p>

        {/* 커밋이 하나뿐이면 SHA만 남고 넘기는 조작이 사라집니다. */}
        <div className={styles.commitSelector}>
          {file.commits.length > 1 ? (
            <>
              <span className={styles.sectionCount}>Commits / {padded(file.commits.length)}</span>
              <button
                type="button"
                className={styles.commitStep}
                disabled={commitIndex === 0}
                aria-label={CODE_PANEL_COPY.previousCommit}
                onClick={() => onCommitIndexChange(commitIndex - 1)}
              >
                ←
              </button>
            </>
          ) : null}
          <code>{commit.sha.slice(0, 7)}</code>
          {file.commits.length > 1 ? (
            <button
              type="button"
              className={styles.commitStep}
              disabled={commitIndex === file.commits.length - 1}
              aria-label={CODE_PANEL_COPY.nextCommit}
              onClick={() => onCommitIndexChange(commitIndex + 1)}
            >
              →
            </button>
          ) : null}
        </div>

        {/*
          색인에서 찾지 못한 커밋은 제목과 메시지가 비어 있습니다. 비었다는 사실만 보여 주면
          사용자는 그 커밋에 메시지가 없다고 읽습니다. 무엇을 확인할 수 없는지 말합니다.
        */}
        {commit.indexed ? null : (
          <p className={styles.commitTitle}>
            {CODE_PANEL_COPY.commitNotIndexed}
          </p>
        )}
        {commit.title === null ? null : <p className={styles.commitTitle}>{commit.title}</p>}
        <p className={styles.diffStats}>
          <span data-kind="add">+{commit.file.additions}</span>
          <span data-kind="del">−{commit.file.deletions}</span>
        </p>
      </div>

      {commit.file.patch === null ? (
        <div className={styles.diffEmpty}>
          <p className={styles.sectionLabel}>No diff body</p>
          <p>
            {commit.file.patchOmittedReason === null
              ? CODE_PANEL_COPY.noPatchBody
              : PATCH_OMITTED_COPY[commit.file.patchOmittedReason]}
          </p>
        </div>
      ) : (
        <div className={styles.diffBody}>
          {lines.map((line, index) => (
            <DiffLineRow key={index} line={line} />
          ))}
        </div>
      )}

      {/*
        파일 단위 절단 표시입니다. 단계를 지목하지 않습니다. `evidence-snapshot.ts`가 Stage B 절단과
        스냅샷 예산 절단을 한 boolean으로 합쳐 실어 오므로 화면이 출처를 가를 수 없고, 지목하면
        예산으로만 잘린 경우에 거짓을 말하게 됩니다. PR #65 재검증 P2가 이 지점이었습니다.
      */}
      {commit.file.patchTruncated ? (
        <p className={styles.diffNotice}>
          {CODE_PANEL_COPY.diffTruncated}
        </p>
      ) : null}
    </div>
  );
}

/**
 * 줄 하나입니다. 추가와 삭제를 색으로 가르지 않습니다. 배경 대비, `+`/`−` 기호, 왼쪽 표시선 셋으로
 * 구분하고, 색은 읽기 어렵다는 실측이 나올 때만 검토합니다(이슈 #98 Non-goal).
 *
 * 줄 번호는 추가된 줄이면 변경 후 번호, 나머지는 변경 전 번호를 씁니다. 디자인은 변경 전 번호만
 * 써서 추가된 줄의 번호 칸이 비는데, 그러면 추가된 줄이 새 파일의 몇 번째 줄인지 알 수 없습니다.
 */
function DiffLineRow({ line }: { line: DiffLine }) {
  if (line.type === "meta") {
    return (
      <div className={styles.diffMeta}>
        <span className={styles.diffLineNumber} />
        <span className={styles.diffContent}>{line.content}</span>
      </div>
    );
  }

  const number = line.type === "add" ? line.newNumber : line.oldNumber;
  const mark = line.type === "add" ? "+" : line.type === "del" ? "−" : " ";

  return (
    <div className={styles.diffLine} data-type={line.type}>
      <span className={styles.diffLineNumber}>{number ?? ""}</span>
      <span className={styles.diffMark} aria-hidden="true">
        {mark}
      </span>
      <span className={styles.diffContent}>{line.content || " "}</span>
    </div>
  );
}

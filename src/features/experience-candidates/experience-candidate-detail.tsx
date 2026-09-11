import { useState } from "react";
import type { ReadonlyCommitDetail, RepositoryRef } from "@/lib/github/types";
import type { EvidenceSnapshotFailureReason, ExperienceCandidateListItem } from "./types";
import {
  AI_SELECTION_LABEL,
  EVIDENCE_VERIFIABILITY_NOTICE,
  RELATED_COMMITS_VERIFICATION_NOTICE,
  REPOSITORY_VERIFIED_NOTICE,
  VERIFIABILITY_LABEL,
} from "./evidence-verifiability";
import { deriveCandidatePeriod, formatCommitDate } from "./candidate-period";
import { EXPERIENCE_SELECTION_ERROR_COPY } from "./experience-selection";
import styles from "./experience-candidate-detail.module.css";

interface ExperienceCandidateDetailProps {
  repository: RepositoryRef;
  /** sha→커밋 조회용입니다. `ExperienceCandidateList`가 목록 행에도 쓰는 것을 그대로 받아, 여기서 다시 만들지 않습니다. */
  commitsBySha: ReadonlyMap<string, ReadonlyCommitDetail>;
  item: ExperienceCandidateListItem;
  onBack: () => void;
  /** 이 경험을 인터뷰 대상으로 확정합니다. */
  onConfirm: () => void;
  onSelectRepository: () => void;
  /** 근거 스냅샷을 만들지 못한 이유입니다. 성공했거나 아직 확정하지 않았으면 undefined입니다. */
  selectionError?: EvidenceSnapshotFailureReason;
}

// 확정 액션의 접근성 설명으로 연결합니다. 액션 접근성 이름은 버튼 문구로 짧게 두고, 확인 가능·불가
// 안내는 `aria-describedby`로 계속 노출합니다. `aria-label`로 이름만 주면 안내가 스크린리더에서
// 사라지고, 그것이 이슈 #47 PR #52 1차 리뷰의 P1이었습니다.
const EVIDENCE_NOTICE_ID = "candidate-evidence-verifiability-notice";
const VERIFIED_NOTICE_ID = "candidate-repository-verified-notice";

/** "Why worth discussing"·"Technical topics"처럼 지금 스키마에 대응 값이 없는 항목에 씁니다. 임의로 채우지 않습니다(이슈 #97 Constraint). */
const SCHEMA_GAP_NOTICE = "No corresponding data in the Repository schema to display this.";

/** 목록에 3개 초과일 때 접어 두는 기준입니다. 디자인의 "View all" 기준과 같습니다. */
const EVIDENCE_LIST_COLLAPSE_THRESHOLD = 3;

const commitUrl = ({ owner, repo }: RepositoryRef, sha: string) =>
  `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commit/${sha}`;

interface EvidenceListEntry {
  readonly sha: string;
  readonly title: string;
  readonly date: string | null;
  readonly pullRequests: ReadonlyCommitDetail["pullRequests"];
  /** 대표 커밋 자신의 필드는 확인 가능이고, 관련 커밋은 관계까지만 확인되는 AI 선택입니다. */
  readonly aiSelected: boolean;
}

function evidenceEntry(sha: string, commit: ReadonlyCommitDetail | null, aiSelected: boolean): EvidenceListEntry {
  return {
    sha,
    title: commit?.title ?? `커밋 색인 실패 · ${sha.slice(0, 7)}`,
    date: commit?.date ?? null,
    pullRequests: commit?.pullRequests ?? [],
    aiSelected,
  };
}

export function ExperienceCandidateDetail({
  repository,
  commitsBySha,
  item,
  onBack,
  onConfirm,
  onSelectRepository,
  selectionError,
}: ExperienceCandidateDetailProps) {
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const { candidate, commit, normalizedRelatedShas } = item;
  const title = commit?.title ?? `커밋 색인 실패 · ${candidate.sha.slice(0, 7)}`;
  const commitCount = 1 + normalizedRelatedShas.length;

  const evidenceEntries: readonly EvidenceListEntry[] = [
    evidenceEntry(candidate.sha, commit, false),
    ...normalizedRelatedShas.map((sha) => evidenceEntry(sha, commitsBySha.get(sha) ?? null, true)),
  ];
  const period = deriveCandidatePeriod(
    evidenceEntries.map((entry) => entry.date).filter((date): date is string => date !== null)
  );
  const visibleEvidenceEntries = showAllEvidence
    ? evidenceEntries
    : evidenceEntries.slice(0, EVIDENCE_LIST_COLLAPSE_THRESHOLD);

  return (
    <section className={styles.detail} aria-live="polite">
      <div className={styles.header}>
        <p className={styles.eyebrow}>Experience</p>
        <h2>{title}</h2>
        {commit === null ? <p className={styles.notice}>Representative commit not found in the commit index.</p> : null}
        <div className={styles.meta}>
          <span>{`${commitCount} commits`}</span>
          {period ? <span>{period.start === period.end ? period.start : `${period.start} – ${period.end}`}</span> : null}
        </div>
      </div>

      <div className={styles.body}>
        <section className={styles.section} aria-labelledby="why-heading">
          <p id="why-heading" className={styles.sectionEyebrow}>Why worth discussing</p>
          <p className={styles.evidenceText}>{candidate.evidence}</p>
          <p id={EVIDENCE_NOTICE_ID} className={styles.evidenceNotice}>{EVIDENCE_VERIFIABILITY_NOTICE}</p>
        </section>

        <section className={styles.section} aria-labelledby="topics-heading">
          <p id="topics-heading" className={styles.sectionEyebrow}>Technical topics</p>
          <p className={styles.schemaGapNotice}>{SCHEMA_GAP_NOTICE}</p>
        </section>

        <section className={`${styles.section} ${styles.evidenceSection}`} aria-labelledby="evidence-heading">
          <p id="evidence-heading" className={styles.sectionEyebrow}>Repository evidence</p>
          <p id={VERIFIED_NOTICE_ID} className={styles.verifiedNotice}>{REPOSITORY_VERIFIED_NOTICE}</p>
          {normalizedRelatedShas.length > 0 ? (
            <p className={styles.aiSelectionNotice}>{RELATED_COMMITS_VERIFICATION_NOTICE}</p>
          ) : null}
          <div className={styles.evidenceListPanel}>
            <div className={styles.evidenceListHeader}>
              <span>VERIFIED FROM REPOSITORY</span>
              <span>{`${commitCount} commits`}</span>
            </div>
            <ul className={styles.evidenceList}>
              {visibleEvidenceEntries.map((entry) => (
                <li key={entry.sha}>
                  <span className={entry.aiSelected ? styles.aiSelectionTag : styles.verifiedTag}>
                    {entry.aiSelected ? AI_SELECTION_LABEL : VERIFIABILITY_LABEL.verified}
                  </span>
                  <a href={commitUrl(repository, entry.sha)} target="_blank" rel="noreferrer">{entry.title}</a>
                  <span className={styles.evidenceListMeta}>
                    <code>{entry.sha.slice(0, 7)}</code>
                    {entry.date ? <span>{formatCommitDate(entry.date)}</span> : null}
                    {entry.pullRequests.map((pullRequest) => <span key={pullRequest.number}>PR #{pullRequest.number}</span>)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          {evidenceEntries.length > EVIDENCE_LIST_COLLAPSE_THRESHOLD ? (
            <button className={styles.viewAllButton} type="button" onClick={() => setShowAllEvidence((value) => !value)}>
              {showAllEvidence ? "Show less" : `View all ${evidenceEntries.length} commits →`}
            </button>
          ) : null}
        </section>

        {selectionError ? (
          <div className={styles.selectionError} role="alert" data-selection-error={selectionError}>
            <strong>{EXPERIENCE_SELECTION_ERROR_COPY[selectionError].title}</strong>
            <span>{EXPERIENCE_SELECTION_ERROR_COPY[selectionError].message}</span>
            <button className={styles.backButton} type="button" onClick={onBack}>← Back to candidates</button>
          </div>
        ) : null}
      </div>

      <div className={styles.footer}>
        <button className={styles.secondaryButton} type="button" onClick={onSelectRepository}>
          Choose a different repository
        </button>
        <button
          className={styles.primaryButton}
          type="button"
          aria-describedby={`${EVIDENCE_NOTICE_ID} ${VERIFIED_NOTICE_ID}`}
          onClick={onConfirm}
        >
          Start interview <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

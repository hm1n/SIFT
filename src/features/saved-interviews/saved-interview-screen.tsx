"use client";

import { BLOCK_KINDS, type BlockKind, type ExperienceBlockState } from "@/features/experience-block/types";
import {
  EVIDENCE_VERIFIABILITY_NOTICE,
  REPOSITORY_VERIFIED_NOTICE,
} from "@/features/experience-candidates/evidence-verifiability";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { StoredInterviewPayload } from "./payload";
import styles from "./saved-interview-screen.module.css";

/**
 * 저장된 인터뷰를 이어가기 전에 보는 화면입니다(이슈 #115). 디자인 파일 `App.tsx`의
 * `SessionReviewScreen`을 옮겼습니다.
 *
 * 근거는 커밋 목록으로만 보입니다. 코드와 diff를 보여 주는 `CodePanel`은 인터뷰 화면의 왼쪽 열이고,
 * 여기서 같은 것을 한 번 더 그리면 이어가기 전에 볼 것과 이어간 뒤에 볼 것이 겹칩니다.
 *
 * 대화로 곧바로 들어가지 않는 이유는 원본 주석에 있습니다. 며칠 전에 하던 대화 한가운데로 떨어지면
 * 무엇을 이야기하던 중이었는지 모른 채 답을 써야 합니다. 그래서 고른 경험이 무엇이었고 어디까지
 * 왔는지를 먼저 보입니다.
 */
export interface SavedInterviewScreenProps {
  interview: StoredInterviewPayload;
  onResume: () => void;
}

/** 저장된 분석에서 고른 후보입니다. 오래전에 쓴 값이라 지금 기대하는 모양이 아닐 수 있습니다. */
interface StoredCandidate {
  readonly evidence: string | null;
  readonly technicalTopics: readonly string[];
}

export function parseStoredCandidate(value: unknown): StoredCandidate | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as { evidence?: unknown; technicalTopics?: unknown };
  const topics = Array.isArray(candidate.technicalTopics)
    ? candidate.technicalTopics.filter((topic): topic is string => typeof topic === "string" && topic.trim().length > 0)
    : [];
  return {
    evidence: typeof candidate.evidence === "string" && candidate.evidence.length > 0 ? candidate.evidence : null,
    technicalTopics: topics,
  };
}

/** 저장된 값이라 모양을 한 번 봅니다. 근거 패널은 스냅샷의 모든 칸을 읽습니다. */
function asSnapshot(value: unknown): ExperienceEvidenceSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const snapshot = value as Partial<ExperienceEvidenceSnapshot>;
  return typeof snapshot.candidateSha === "string" && snapshot.representativeCommit !== undefined
    ? (value as ExperienceEvidenceSnapshot)
    : null;
}

/** 블록이 어디까지 왔는지입니다. 평가가 없으면 아직 다루지 않은 블록입니다. */
function blockSymbol(blockState: ExperienceBlockState, block: BlockKind): "✓" | "●" | "○" {
  const evaluation = blockState.evaluation[block];
  if (evaluation === null) return "○";
  return evaluation.sufficient ? "✓" : "●";
}

const BLOCK_LABEL: Record<BlockKind, string> = {
  problem: "Problem",
  alternatives: "Analyze",
  action: "Action",
  result: "Result",
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function SavedInterviewScreen({ interview, onResume }: SavedInterviewScreenProps) {
  const candidate = parseStoredCandidate(interview.candidate);
  const snapshot = asSnapshot(interview.evidence);
  const date = formatDate(interview.updatedAt);
  const progress = `PAAR ${interview.completedBlockCount}/${BLOCK_KINDS.length}`;

  return (
    <section className={styles.screen}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Experience</p>
        <h1 className={styles.title}>{interview.title}</h1>
        <div className={styles.meta}>
          <span>{interview.repoOwner} / {interview.repoName}</span>
          <span className={styles.dot}>·</span>
          <span>{date}</span>
        </div>
      </header>

      <div className={styles.body}>
        <div className={styles.column}>
          <section className={styles.section} aria-labelledby="saved-why-heading">
            <p id="saved-why-heading" className={styles.sectionEyebrow}>Why worth discussing</p>
            {candidate?.evidence ? (
              <>
                <p className={styles.text}>{candidate.evidence}</p>
                <p className={styles.notice}>{EVIDENCE_VERIFIABILITY_NOTICE}</p>
              </>
            ) : (
              <p className={styles.notice}>This interview was saved without the analysis for this candidate.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="saved-topics-heading">
            <p id="saved-topics-heading" className={styles.sectionEyebrow}>Technical topics</p>
            {candidate && candidate.technicalTopics.length > 0 ? (
              <>
                <ul className={styles.topics}>
                  {candidate.technicalTopics.map((topic) => <li key={topic}>{topic}</li>)}
                </ul>
                <p className={styles.notice}>{EVIDENCE_VERIFIABILITY_NOTICE}</p>
              </>
            ) : (
              <p className={styles.notice}>No topics were saved with this interview.</p>
            )}
          </section>

          <section className={styles.section} aria-labelledby="saved-evidence-heading">
            <p id="saved-evidence-heading" className={styles.sectionEyebrow}>Repository evidence</p>
            <p className={styles.notice}>{REPOSITORY_VERIFIED_NOTICE}</p>
            {snapshot ? (
              <ul className={styles.commits}>
                {[snapshot.representativeCommit, ...snapshot.relatedCommits].map((commit) => (
                  <li key={commit.sha} className={styles.commit}>
                    <span className={styles.commitBadge}>
                      {commit.pullRequests.length > 0 ? `PR #${commit.pullRequests[0].number}` : commit.sha.slice(0, 7)}
                    </span>
                    <span className={styles.commitMain}>
                      <span className={styles.commitTitle}>
                        {commit.title ?? "Not found in the commit index."}
                      </span>
                      <span className={styles.commitMeta}>
                        {commit.files.length === 1 ? "1 file" : `${commit.files.length} files`}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.notice}>The saved evidence can no longer be read.</p>
            )}
          </section>

          {/*
            블록 문장까지 그리는 패널은 이슈 #91의 범위입니다. 여기서는 어디까지 왔는지만 보입니다.
            같은 값을 두 화면이 각자 그리면 #91에서 둘이 어긋납니다.
          */}
          <section className={styles.section} aria-labelledby="saved-paar-heading">
            <div className={styles.sectionHeader}>
              <p id="saved-paar-heading" className={styles.sectionEyebrow}>PAAR experience</p>
              <span className={styles.progress}>{progress}</span>
            </div>
            <ul className={styles.blocks}>
              {BLOCK_KINDS.map((block) => (
                <li key={block} className={styles.block}>
                  <span className={styles.blockSymbol} aria-hidden="true">{blockSymbol(interview.blockState, block)}</span>
                  <span className={styles.blockLabel}>{BLOCK_LABEL[block]}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerMeta}>{progress} · {date}</span>
        <button type="button" className={styles.resume} onClick={onResume}>
          {interview.status === "completed" ? "Review interview" : "Continue interview"}
          <span className={styles.arrow} aria-hidden="true">→</span>
        </button>
      </footer>
    </section>
  );
}

import styles from "./block-sentences.module.css";

/**
 * 블록 하나의 문장과 출처와 충돌입니다. 인터뷰 화면의 PAAR 패널과 저장된 인터뷰의 요약 화면이 같은
 * 것을 그리므로 한 곳에 둡니다(이슈 #115).
 *
 * 두 화면이 각자 그리면 출처 표시와 충돌 표시가 갈립니다. 실제로 갈리면 안 되는 것이 둘입니다.
 * 고친 문장에 예전 인용이 따라붙지 않아야 하고(설계 8절), 충돌은 문장 안이 아니라 밖에 적어야
 * 합니다. 둘 다 화면이 아니라 이 컴포넌트가 지킵니다.
 *
 * 출처 구분을 색으로만 하지 않습니다(이슈 #91 Constraint). 충돌 표시는 글자로 적고 색과 테두리는
 * 그 글자를 찾기 쉽게 하는 보조 수단으로만 씁니다.
 */
export interface BlockSentenceMark {
  readonly text: string;
  readonly repositorySources: readonly { commitSha: string; filePath: string | null }[];
}

export interface BlockSentenceConflict {
  readonly claimId: string;
  readonly observation: string;
}

export interface BlockSentencesProps {
  readonly marks: readonly BlockSentenceMark[];
  readonly conflicts: readonly BlockSentenceConflict[];
  /** 문장이 없을 때 그 자리에 적을 말입니다. 비어 있는 이유가 화면마다 다릅니다. */
  readonly emptyText: string;
}

/** 사용자 주장과 저장소 관찰이 어긋난 상태입니다. 문장 안이 아니라 밖에 그립니다(설계 8절). */
export const CONFLICT_MARK = "Conflicts with the evidence · needs checking";

/** 같은 커밋·파일 인용이 여러 주장에 붙어 있으면 화면에는 한 번만 그립니다. */
function uniqueSources(sources: readonly { commitSha: string; filePath: string | null }[]) {
  const seen = new Map<string, { commitSha: string; filePath: string | null }>();
  for (const source of sources) seen.set(`${source.commitSha}:${source.filePath ?? ""}`, source);
  return [...seen.values()];
}

export function BlockSentences({ marks, conflicts, emptyText }: BlockSentencesProps) {
  return (
    <>
      {marks.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <ul className={styles.sentences}>
          {marks.map((mark, index) => (
            // 문장은 사용자가 고치면 순서가 그대로이므로 위치를 키로 씁니다. 표시 문장에는 식별자가
            // 없고, 본문을 키로 쓰면 같은 문장이 두 번 나올 때 깨집니다.
            <li key={index} className={styles.sentence}>
              <p className={styles.sentenceText}>{mark.text}</p>
              {mark.repositorySources.length > 0 ? (
                <ul className={styles.sources}>
                  {uniqueSources(mark.repositorySources).map((source) => (
                    <li key={`${source.commitSha}:${source.filePath ?? ""}`} className={styles.source}>
                      <span className={styles.sourceSha}>{source.commitSha.slice(0, 7)}</span>
                      {source.filePath === null ? null : (
                        <span className={styles.sourcePath}>{source.filePath}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {conflicts.length > 0 ? (
        <div className={styles.conflict}>
          <p className={styles.conflictMark}>{CONFLICT_MARK}</p>
          <ul className={styles.conflictList}>
            {conflicts.map((conflict) => (
              <li key={conflict.claimId}>{conflict.observation}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

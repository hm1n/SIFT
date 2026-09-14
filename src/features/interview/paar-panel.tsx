import styles from "./paar-panel.module.css";

/** PAAR 블록은 PROBLEM·ANALYZE·ACTION·RESULT 넷입니다. */
export const PAAR_BLOCK_COUNT = 4;

/**
 * 인터뷰 워크스페이스의 오른쪽 열입니다.
 *
 * **#98은 자리와 빈 상태만 둡니다.** 블록 계약과 갱신은 #89~#91의 범위입니다. 여기에 가짜 블록을
 * 미리 그리면 아직 없는 계약을 화면이 먼저 정해 버립니다. 완료 개수도 인자로만 받고 이 컴포넌트가
 * 세지 않습니다.
 */
export function PaarPanel({ completedCount = 0 }: { completedCount?: number }) {
  return (
    <section className={styles.panel} aria-labelledby="paar-panel-heading">
      <div className={styles.header}>
        <h3 id="paar-panel-heading" className={styles.heading}>
          PAAR
        </h3>
        <span className={styles.count}>
          / {String(completedCount).padStart(2, "0")} OF {String(PAAR_BLOCK_COUNT).padStart(2, "0")}
        </span>
      </div>
      <p className={styles.empty}>
        No PAAR block has been filled yet. Blocks appear here as the interview goes on.
      </p>
    </section>
  );
}

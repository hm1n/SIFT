import { useId, useState } from "react";
import styles from "./paar-panel.module.css";

/** PAAR 블록은 PROBLEM·ANALYZE·ACTION·RESULT 넷입니다. */
export const PAAR_BLOCK_COUNT = 4;

export interface PaarPanelProps {
  /** 인터뷰가 끝났는지입니다. 끝난 뒤에는 종료 조작을 그리지 않습니다. */
  isEnded: boolean;
  /** 확인까지 받은 종료입니다. 스트림 훅의 종료를 부릅니다. */
  onEnd: () => void;
}

/**
 * 인터뷰 워크스페이스의 오른쪽 열입니다.
 *
 * **#98은 자리와 빈 상태만 둡니다.** 블록 계약과 갱신은 #89~#91의 범위입니다. 여기에 가짜 블록을
 * 미리 그리면 아직 없는 계약을 화면이 먼저 정해 버립니다. 완료 개수를 받는 인자도 채울 블록이
 * 생길 때 함께 만듭니다.
 *
 * 인터뷰 종료는 디자인 원본에서 이 패널의 맨 아래 자리입니다. 블록이 다 차야 눌리는 규칙은 아직
 * 옮기지 않았습니다. 완료 개수가 언제나 0이라 그 규칙을 지금 옮기면 인터뷰를 끝낼 수 없습니다.
 * 잠금은 블록 계약이 생기는 #89~#91에서 함께 붙입니다.
 */
export function PaarPanel({ isEnded, onEnd }: PaarPanelProps) {
  // 종료 확인은 이 조작의 화면 상태입니다. 훅에는 확정된 종료만 알립니다. 확인 단계를 훅에 두면
  // 종료하지 않은 상태가 두 가지가 되고, 조작 잠금이 어느 쪽을 봐야 하는지 갈립니다.
  const [isConfirmingEnd, setIsConfirmingEnd] = useState(false);
  const endConfirmId = useId();

  return (
    <section className={styles.panel} aria-labelledby="paar-panel-heading">
      <div className={styles.header}>
        <h3 id="paar-panel-heading" className={styles.heading}>
          PAAR
        </h3>
        <span className={styles.count}>/ 00 OF {String(PAAR_BLOCK_COUNT).padStart(2, "0")}</span>
      </div>
      <p className={styles.empty}>
        No PAAR block has been filled yet. Blocks appear here as the interview goes on.
      </p>

      {/*
        종료는 되돌릴 수 없으므로 한 번 확인을 받습니다. 확인 문구는 사라지는 것을 모두 적습니다.
        작성 중인 답변, 그리고 후보 목록으로 돌아갈 때의 대화입니다.

        생성 중에도 누를 수 있게 둡니다. 질문을 기다리다 그만두는 것을 막을 이유가 없고, 종료가
        진행 중인 요청을 끊습니다. 끝난 뒤에는 자리째 걷습니다. 다시 시작하는 조작이 없기 때문입니다.
      */}
      {isEnded ? null : (
        <div className={styles.footer}>
          {isConfirmingEnd ? (
            <div className={styles.endConfirm} role="group" aria-labelledby={endConfirmId}>
              <p id={endConfirmId} className={styles.endConfirmText}>
                Ending the interview closes the answer box and leaves the conversation read-only. Any
                answer you are still writing is discarded. Going back to the candidate list clears the
                conversation too, and it cannot be resumed.
              </p>
              <div className={styles.endActions}>
                {/* 확인 문구를 읽지 않고 누르는 일을 줄이려고 초점을 확인 버튼으로 옮깁니다. */}
                <button type="button" className={styles.endButton} onClick={onEnd} autoFocus>
                  End the interview
                </button>
                <button
                  type="button"
                  className={styles.endCancelButton}
                  onClick={() => setIsConfirmingEnd(false)}
                >
                  Continue the interview
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.endButton}
              onClick={() => setIsConfirmingEnd(true)}
            >
              End interview
            </button>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useId, useRef, useState } from "react";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { CodePanel } from "./code-panel";
import { InterviewStreamView } from "./interview-stream-view";
import { PAAR_BLOCK_COUNT, PaarPanel } from "./paar-panel";
import { ResizeHandle } from "./resize-handle";
import styles from "./interview-screen.module.css";

export interface InterviewScreenProps {
  snapshot: ExperienceEvidenceSnapshot;
  onBack: () => void;
  /** 테스트에서 스트림 응답을 대체하는 통로입니다. */
  fetchImpl?: typeof fetch;
}

/** 코드 패널의 기본 폭과 한계입니다. 값은 디자인 원본 `InterviewScreen`과 같습니다. */
const CODE_PANEL = { initial: 300, min: 200, max: 520 } as const;
const PAAR_PANEL = { initial: 280, min: 220, max: 480 } as const;
/** 대화 열이 이보다 좁아지도록 양옆을 넓히지 않습니다. 질문을 읽는 것이 이 화면의 목적입니다. */
const MIN_CHAT_WIDTH_PX = 280;
/** `resize-handle.module.css`의 손잡이 폭입니다. 남은 폭을 계산할 때 함께 빼야 합니다. */
const HANDLE_WIDTH_PX = 4;

/**
 * 인터뷰 화면 본체입니다. #98부터 왼쪽 코드 근거, 가운데 대화, 오른쪽 PAAR의 3열 워크스페이스입니다.
 * "코드를 보고 → 왜 그렇게 했는지 설명하고 → 경험으로 정리한다"는 관계를 공간 배치로 드러냅니다.
 * 배치를 질문 아래 한 열에서 3열로 바꾼 경위는 `llm-wiki/wiki/2026-09-14-인터뷰-3열-워크스페이스.md`에
 * 있고, 그 문서가 `2026-08-25-인터뷰-화면-근거패널-배치.md`의 결정 1을 대체합니다.
 *
 * 가운데 열은 이슈 #60이 실측으로 확정한 `InterviewStreamView`를 그대로 둡니다. 렌더링 방식,
 * 자동 스크롤, 낭독 경계를 다시 정하지 않습니다. 열 높이를 채우도록 로그의 높이 규칙만 바꿨습니다.
 *
 * **`snapshot`을 반드시 넘깁니다.** 넘기지 않으면 `InterviewStreamView`가 테스트용 스트림을 `GET`으로
 * 받고, 그 스트림의 고정 질문이 사용자가 고른 경험의 질문인 것처럼 근거와 나란히 표시됩니다. 어떤
 * 저장소를 골라도 같은 질문이 나오므로 AI가 실제 Repository 근거로 질문한다는 원칙이 깨집니다.
 * PR #65 리뷰 P1이 이 지점이었습니다. 회귀는 이 화면의 테스트가 요청 본문을 직접 확인해 막습니다.
 *
 * Loading과 Error를 이 화면이 새로 만들지 않습니다. 첫 내용이 오기 전 안내와 오류별 안내·다시
 * 시도는 `InterviewStreamView`가 이미 담당합니다. 같은 상태를 두 곳에서 그리면 어긋납니다.
 */
export function InterviewScreen({ snapshot, onBack, fetchImpl }: InterviewScreenProps) {
  const title =
    snapshot.representativeCommit.title ??
    `Representative commit ${snapshot.candidateSha.slice(0, 7)}`;

  // 대화가 실제로 사라지는 자리는 여기입니다. `onBack`이 후보 목록의 확정 상태를 비우고 이 화면을
  // 내리므로 대화의 유일본이 사라집니다. 인터뷰 종료는 입력만 닫고 대화를 남기므로, 두 조작의 확인
  // 문구가 알려야 하는 것도 다릅니다.
  const [isConfirmingBack, setIsConfirmingBack] = useState(false);
  const backConfirmId = `${useId()}-back-confirm`;

  const [showCodePanel, setShowCodePanel] = useState(true);
  const [showPaarPanel, setShowPaarPanel] = useState(true);
  const [codeWidth, setCodeWidth] = useState<number>(CODE_PANEL.initial);
  const [paarWidth, setPaarWidth] = useState<number>(PAAR_PANEL.initial);
  const workspaceRef = useRef<HTMLDivElement>(null);

  /**
   * 한 열을 넓히면 대화 열이 좁아집니다. 폭 한계만 보면 대화 열이 최소 폭 아래로 밀리므로 남은
   * 폭까지 함께 봅니다. 컨테이너 폭을 아직 못 재는 동안(첫 렌더, jsdom)은 폭 한계만 봅니다.
   */
  function clampPanelWidth(next: number, panel: { min: number; max: number }, otherPanelWidth: number) {
    const container = workspaceRef.current?.offsetWidth ?? 0;
    const handles =
      (showCodePanel ? HANDLE_WIDTH_PX : 0) + (showPaarPanel ? HANDLE_WIDTH_PX : 0);
    const room =
      container === 0
        ? panel.max
        : container - otherPanelWidth - handles - MIN_CHAT_WIDTH_PX;
    const max = Math.max(panel.min, Math.min(panel.max, room));
    return Math.min(Math.max(next, panel.min), max);
  }

  return (
    // 이 자리에 `aria-live`를 두지 않습니다. 안쪽 질문 텍스트가 프레임마다 자라나므로 스크린리더가
    // 자라나는 질문 전체를 반복해서 읽습니다. 낭독 대상은 `InterviewStreamView`의 상태 문단과 새
    // 메시지 안내입니다. PR #61 리뷰가 정정한 결정입니다.
    <div className={styles.screen}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <button
            className={styles.backButton}
            type="button"
            onClick={() => setIsConfirmingBack(true)}
          >
            ← Candidates
          </button>
          <span className={styles.headerDivider} aria-hidden="true" />
          <p className={styles.eyebrow}>Experience</p>
          <h2 className={styles.title}>{title}</h2>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.panelToggle}
            type="button"
            aria-pressed={showCodePanel}
            onClick={() => setShowCodePanel((shown) => !shown)}
          >
            Code
          </button>
          <button
            className={styles.panelToggle}
            type="button"
            aria-pressed={showPaarPanel}
            onClick={() => setShowPaarPanel((shown) => !shown)}
          >
            PAAR 0/{PAAR_BLOCK_COUNT}
          </button>
        </div>
      </header>

      {/*
        인터뷰 종료와 별개로 이 자리에서도 확인을 받습니다. 종료 조작에만 확인을 두면 사용자가 이
        버튼으로 확인을 지나칠 수 있고, 제출한 답변과 작성 중인 답변이 함께 사라집니다.

        종료했는지에 따라 묻지 않게 하려면 이 화면이 훅의 종료 상태를 알아야 하고, 그러려면 훅을
        `InterviewStreamView` 밖으로 끌어올려야 합니다. 종료한 뒤 한 번 더 묻는 값을 치르고 훅의
        자리를 그대로 둡니다.
      */}
      {isConfirmingBack ? (
        <div className={styles.backConfirm} role="group" aria-labelledby={backConfirmId}>
          <p id={backConfirmId} className={styles.backConfirmText}>
            Going back to the candidate list clears this conversation for good, along with any answer
            you&apos;re still writing.
          </p>
          <div className={styles.backActions}>
            <button className={styles.backConfirmButton} type="button" onClick={onBack} autoFocus>
              Back to candidates
            </button>
            <button
              className={styles.backCancelButton}
              type="button"
              onClick={() => setIsConfirmingBack(false)}
            >
              Continue the interview
            </button>
          </div>
        </div>
      ) : null}

      <div className={styles.workspace} ref={workspaceRef}>
        {showCodePanel ? (
          <>
            <div className={styles.codeColumn} style={{ width: `${codeWidth}px` }}>
              <CodePanel snapshot={snapshot} />
            </div>
            <ResizeHandle
              label="Resize the code panel"
              width={codeWidth}
              min={CODE_PANEL.min}
              max={CODE_PANEL.max}
              onResize={(deltaX) =>
                setCodeWidth((width) =>
                  clampPanelWidth(width + deltaX, CODE_PANEL, showPaarPanel ? paarWidth : 0)
                )
              }
            />
          </>
        ) : null}

        <div className={styles.chatColumn}>
          <InterviewStreamView snapshot={snapshot} fetchImpl={fetchImpl} />
        </div>

        {showPaarPanel ? (
          <>
            {/* 오른쪽 열이라 오른쪽으로 끌면 좁아집니다. 부호를 여기서 뒤집습니다. */}
            <ResizeHandle
              label="Resize the PAAR panel"
              width={paarWidth}
              min={PAAR_PANEL.min}
              max={PAAR_PANEL.max}
              onResize={(deltaX) =>
                setPaarWidth((width) =>
                  clampPanelWidth(width - deltaX, PAAR_PANEL, showCodePanel ? codeWidth : 0)
                )
              }
            />
            <div className={styles.paarColumn} style={{ width: `${paarWidth}px` }}>
              <PaarPanel />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

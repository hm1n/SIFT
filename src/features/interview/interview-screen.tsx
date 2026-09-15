"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import { CodePanel } from "./code-panel";
import { InterviewStreamView } from "./interview-stream-view";
import { PAAR_BLOCK_COUNT, PaarPanel } from "./paar-panel";
import { ResizeHandle } from "./resize-handle";
import { filledBlockCount, type BlockEdits } from "@/features/experience-block/block-edits";
import { BLOCK_LABELS } from "@/features/experience-block/block-labels";
import type { BlockKind, DisplaySentence } from "@/features/experience-block/types";
import { useExperienceInterview } from "@/features/experience-block/use-experience-interview";
import styles from "./interview-screen.module.css";

export interface InterviewScreenProps {
  snapshot: ExperienceEvidenceSnapshot;
  onBack: () => void;
  /** 테스트에서 스트림 응답을 대체하는 통로입니다. */
  fetchImpl?: typeof fetch;
}

/** 손잡이가 낼 수 있는 폭의 한계입니다. 컨테이너와의 관계는 `fitPanelWidths`가 봅니다. */
const clampPanelWidth = (next: number, panel: { min: number; max: number }) =>
  Math.min(Math.max(next, panel.min), panel.max);

/** 코드 패널의 기본 폭과 한계입니다. 값은 디자인 원본 `InterviewScreen`과 같습니다. */
const CODE_PANEL = { initial: 300, min: 200, max: 520 } as const;
const PAAR_PANEL = { initial: 280, min: 220, max: 480 } as const;
/** 대화 열이 이보다 좁아지도록 양옆을 넓히지 않습니다. 질문을 읽는 것이 이 화면의 목적입니다. */
const MIN_CHAT_WIDTH_PX = 280;
/** `resize-handle.module.css`의 손잡이 폭입니다. 남은 폭을 계산할 때 함께 빼야 합니다. */
const HANDLE_WIDTH_PX = 4;
/**
 * 세 열의 최소 폭과 손잡이를 합친 값입니다. 이보다 좁으면 세 열을 나란히 둘 수 없어 탭으로 바꿉니다.
 * 화면 폭이 아니라 워크스페이스 폭으로 판정합니다. 왼쪽 사이드바 폭만큼 어긋나기 때문입니다.
 */
const TAB_MODE_WIDTH_PX =
  CODE_PANEL.min + PAAR_PANEL.min + MIN_CHAT_WIDTH_PX + HANDLE_WIDTH_PX * 2;

type WorkspaceColumn = "code" | "interview" | "paar";

/**
 * 렌더에 쓸 두 패널 폭입니다. 상태로 든 폭을 그대로 쓰지 않고 지금 컨테이너 폭에 맞춥니다.
 *
 * 손잡이를 움직일 때만 맞추면 첫 렌더와 컨테이너 축소와 패널 재개방이 그 경로를 지나지 않습니다.
 * 탭 모드 판정은 세 열의 **최소** 폭 합(708px)인데 렌더는 **기본** 폭(300+280+손잡이 8)을 쓰므로,
 * 그 사이 구간에서 세 열이 켜진 채 대화 열이 132px까지 밀립니다. `MIN_CHAT_WIDTH_PX` 계약을
 * 깨는 자리였습니다(PR #120 리뷰).
 *
 * 최소 폭을 먼저 떼어 주고 남는 만큼만 기본 폭 쪽으로 되돌립니다. 두 폭을 각각 비율로 줄이면
 * 최소 폭에 걸린 쪽이 못 줄인 몫을 다른 쪽이 메우지 않아 합이 예산을 넘습니다.
 */
export function fitPanelWidths(
  container: number,
  widths: { code: number; paar: number },
  shown: { code: boolean; paar: boolean }
): { code: number; paar: number } {
  // 아직 재지 못했으면(첫 페인트, `ResizeObserver`가 없는 jsdom) 맞출 기준이 없습니다.
  if (container === 0) return widths;

  const handles = (shown.code ? HANDLE_WIDTH_PX : 0) + (shown.paar ? HANDLE_WIDTH_PX : 0);
  const budget = container - MIN_CHAT_WIDTH_PX - handles;
  const minSum = (shown.code ? CODE_PANEL.min : 0) + (shown.paar ? PAAR_PANEL.min : 0);
  const wantSum =
    (shown.code ? widths.code - CODE_PANEL.min : 0) + (shown.paar ? widths.paar - PAAR_PANEL.min : 0);
  if (wantSum <= 0 || minSum + wantSum <= budget) return widths;

  const factor = Math.max(0, Math.min(1, (budget - minSum) / wantSum));
  return {
    code: shown.code
      ? CODE_PANEL.min + Math.floor((widths.code - CODE_PANEL.min) * factor)
      : widths.code,
    paar: shown.paar
      ? PAAR_PANEL.min + Math.floor((widths.paar - PAAR_PANEL.min) * factor)
      : widths.paar,
  };
}

/**
 * 워크스페이스의 실제 폭입니다. 아직 재지 못했으면 0입니다. `ResizeObserver`가 없는 환경(테스트
 * 기본값)에서는 0으로 남고, 그때는 세 열 배치를 그립니다.
 */
function useWorkspaceWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * 인터뷰 화면 본체입니다. #98부터 왼쪽 코드 근거, 가운데 대화, 오른쪽 PAAR의 3열 워크스페이스입니다.
 * "코드를 보고 → 왜 그렇게 했는지 설명하고 → 경험으로 정리한다"는 관계를 공간 배치로 드러냅니다.
 * 배치를 질문 아래 한 열에서 3열로 바꾼 경위는 `llm-wiki/wiki/2026-09-14-인터뷰-3열-워크스페이스.md`에
 * 있고, 그 문서가 `2026-08-25-인터뷰-화면-근거패널-배치.md`의 결정 1을 대체합니다.
 *
 * 가운데 열은 이슈 #60이 실측으로 확정한 `InterviewStreamView`를 그대로 둡니다. 렌더링 방식,
 * 자동 스크롤, 낭독 경계를 다시 정하지 않습니다. 열 높이를 채우도록 로그의 높이 규칙만 바꿨습니다.
 *
 * **`snapshot`을 반드시 넘깁니다.** 넘기지 않으면 스트림 훅이 테스트용 스트림을 `GET`으로
 * 받고, 그 스트림의 고정 질문이 사용자가 고른 경험의 질문인 것처럼 근거와 나란히 표시됩니다. 어떤
 * 저장소를 골라도 같은 질문이 나오므로 AI가 실제 Repository 근거로 질문한다는 원칙이 깨집니다.
 * PR #65 리뷰 P1이 이 지점이었습니다. 회귀는 이 화면의 테스트가 요청 본문을 직접 확인해 막습니다.
 *
 * Loading과 Error를 이 화면이 새로 만들지 않습니다. 첫 내용이 오기 전 안내와 오류별 안내·다시
 * 시도는 `InterviewStreamView`가 이미 담당합니다. 같은 상태를 두 곳에서 그리면 어긋납니다.
 */
export function InterviewScreen({ snapshot, onBack, fetchImpl }: InterviewScreenProps) {
  /*
   * 스트림 훅은 이 화면이 듭니다.
   *
   * 종료 조작이 오른쪽 PAAR 패널 아래에 있고 종료 상태를 읽는 것은 가운데 대화 열입니다. 두 열은
   * 형제라 한쪽이 훅을 들면 다른 쪽이 볼 수 없습니다. 공통 부모인 여기서 들고 양쪽에 나눠 줍니다.
   */
  const stream = useExperienceInterview({ snapshot, fetchImpl });

  /*
   * 종료 뒤 사용자가 고친 블록 문장입니다. 패널 안이 아니라 여기 두는 이유는 헤더 토글과 좁은 폭
   * 탭이 같은 `n/4` 개수를 그리기 때문입니다. 편집 상태가 패널 안에만 있으면 사용자가 블록을 지웠을
   * 때 패널 머리글과 헤더 토글의 숫자가 갈립니다.
   *
   * 저장 계층이 없어 이 값은 이 화면을 떠나면 사라집니다. 사라진다는 사실은 뒤로가기 확인 문구가
   * 알립니다.
   */
  const [blockEdits, setBlockEdits] = useState<BlockEdits>({});
  const editBlock = (block: BlockKind, sentences: readonly DisplaySentence[]) =>
    setBlockEdits((edits) => ({ ...edits, [block]: sentences }));
  const filledBlocks = filledBlockCount(stream.blockState, blockEdits);

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
  const workspaceWidth = useWorkspaceWidth(workspaceRef);
  const isTabMode = workspaceWidth > 0 && workspaceWidth < TAB_MODE_WIDTH_PX;
  const [activeColumn, setActiveColumn] = useState<WorkspaceColumn>("interview");

  /**
   * 탭 모드에서도 세 열을 모두 DOM에 남기고 보이지 않는 열만 감춥니다. 대화 열을 떼면 스트림이
   * 끊기고 대화 이력이 사라집니다. 감출 때 `display: none`을 쓰지 않는 이유도 같은 자리에
   * 있습니다. 높이가 0이 되면 로그의 자동 스크롤이 하단을 잡지 못한 채 다시 보이게 됩니다.
   */
  const columnClass = (column: WorkspaceColumn) =>
    isTabMode && activeColumn !== column ? `${styles.column} ${styles.columnHidden}` : styles.column;

  /**
   * 렌더에 쓰는 폭입니다. 상태로 든 폭은 손잡이가 마지막으로 낸 값이고, 컨테이너가 좁아지면
   * 그 값을 그대로 쓸 수 없습니다. 대화 열의 최소 폭을 지키는 판단은 여기 한 곳에서 합니다.
   */
  const fitted = fitPanelWidths(
    workspaceWidth,
    { code: codeWidth, paar: paarWidth },
    { code: showCodePanel, paar: showPaarPanel }
  );

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
        {isTabMode ? null : (
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
              PAAR {filledBlocks}/{PAAR_BLOCK_COUNT}
            </button>
          </div>
        )}
      </header>

      {/*
        인터뷰 종료와 별개로 이 자리에서도 확인을 받습니다. 종료 조작에만 확인을 두면 사용자가 이
        버튼으로 확인을 지나칠 수 있고, 제출한 답변과 작성 중인 답변이 함께 사라집니다.

        종료한 뒤에도 그대로 묻습니다. 종료는 입력만 닫고 대화를 남기지만 이 버튼은 그 대화까지
        지우기 때문입니다. 사라지는 것이 남아 있는 한 확인을 걷지 않습니다.
      */}
      {isConfirmingBack ? (
        <div className={styles.backConfirm} role="group" aria-labelledby={backConfirmId}>
          <p id={backConfirmId} className={styles.backConfirmText}>
            Going back to the candidate list clears this conversation for good, along with any answer
            you&apos;re still writing, the PAAR blocks, and any edits you made to them. Reloading the
            page clears them too. Nothing here is saved.
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

      {/*
        좁은 폭에서는 세 열을 나란히 둘 수 없어 탭으로 바꿉니다. 탭 상태는 이 화면의 로컬 state이고
        서버나 URL에 남기지 않습니다. 폭이 다시 넓어지면 세 열 배치로 돌아갑니다.
      */}
      {isTabMode ? (
        <div className={styles.tabBar} role="group" aria-label="Workspace view">
          <button
            className={styles.tab}
            type="button"
            aria-pressed={activeColumn === "code"}
            onClick={() => setActiveColumn("code")}
          >
            Code
          </button>
          <button
            className={styles.tab}
            type="button"
            aria-pressed={activeColumn === "interview"}
            onClick={() => setActiveColumn("interview")}
          >
            Interview
          </button>
          <button
            className={styles.tab}
            type="button"
            aria-pressed={activeColumn === "paar"}
            onClick={() => setActiveColumn("paar")}
          >
            PAAR {filledBlocks}/{PAAR_BLOCK_COUNT}
          </button>
        </div>
      ) : null}

      <div className={`${styles.workspace} ${isTabMode ? styles.tabMode : ""}`} ref={workspaceRef}>
        {isTabMode || showCodePanel ? (
          <>
            <div
              className={`${styles.codeColumn} ${columnClass("code")}`}
              style={{ width: `${fitted.code}px` }}
            >
              <CodePanel snapshot={snapshot} />
            </div>
            {isTabMode ? null : (
              <ResizeHandle
                label="Resize the code panel"
                width={fitted.code}
                min={CODE_PANEL.min}
                max={CODE_PANEL.max}
                // 보이는 폭에서 이어 끕니다. 상태로 든 값에서 끌면 좁아진 화면에서 손이 튑니다.
                onResize={(deltaX) => setCodeWidth(clampPanelWidth(fitted.code + deltaX, CODE_PANEL))}
              />
            )}
          </>
        ) : null}

        <div className={`${styles.chatColumn} ${columnClass("interview")}`}>
          {/*
            더 물을 질문이 없으면 블록 이름을 넘기지 않습니다. 그때 `currentTarget`은 마지막으로
            물었던 블록에 그대로 멈춰 있어, 아직 그 블록을 채우는 중이라고 잘못 읽힙니다.
          */}
          <InterviewStreamView
            stream={stream}
            currentBlockLabel={
              stream.isReadyToFinish ? undefined : BLOCK_LABELS[stream.currentTarget.targetBlock]
            }
          />
        </div>

        {isTabMode || showPaarPanel ? (
          <>
            {/* 오른쪽 열이라 오른쪽으로 끌면 좁아집니다. 부호를 여기서 뒤집습니다. */}
            {isTabMode ? null : (
              <ResizeHandle
                label="Resize the PAAR panel"
                width={fitted.paar}
                min={PAAR_PANEL.min}
                max={PAAR_PANEL.max}
                onResize={(deltaX) => setPaarWidth(clampPanelWidth(fitted.paar - deltaX, PAAR_PANEL))}
              />
            )}
            <div
              className={`${styles.paarColumn} ${columnClass("paar")}`}
              style={{ width: `${fitted.paar}px` }}
            >
              <PaarPanel stream={stream} edits={blockEdits} onEditBlock={editBlock} />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

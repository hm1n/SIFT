import { LANDING_COPY } from "@/copy/landing";
import styles from "./landing-product-preview.module.css";

const { preview } = LANDING_COPY;

/** diff 줄 앞에 붙는 기호입니다. 색만으로 가르지 않도록 기호와 줄 번호를 함께 둡니다. */
const DIFF_MARK = { added: "+", removed: "−", context: " " } as const;

/** PAAR 진행 표시입니다. 완료·진행 중·시작 전을 기호로도 가릅니다. */
const PAAR_MARK = { complete: "✓", "in-progress": "●", empty: "○" } as const;

/**
 * 랜딩이 보여 주는 제품 화면입니다. 레퍼런스 `App.tsx`의 `LandingProductPreview`(1853줄)를 옮겼습니다.
 *
 * 스크린샷 이미지가 아니라 DOM입니다. 레퍼런스 스펙이 "실제 인터페이스를 추상 목업으로 대체하지
 * 말라"고 정했고, 이미지로 두면 해상도마다 따로 만들어야 하며 글자가 흐려집니다.
 *
 * 보조기술에는 한 장의 그림으로 보입니다. 컨테이너가 `role="img"`이고 이름은 `preview.alt`입니다.
 * 안쪽 예시 대화와 예시 코드는 제품 문구가 아니라 장면의 일부라, 읽어 주면 실제 인터뷰 내용으로
 * 오해할 수 있습니다.
 *
 * 상호작용 요소를 넣지 않습니다. 버튼처럼 보이는 것도 전부 `span`입니다. 누를 수 있어 보이지만
 * 아무 일도 일어나지 않는 자리를 만들지 않기 위해서입니다. 랜딩에서 누를 수 있는 것은 로그인
 * 진입점뿐입니다.
 */
export function LandingProductPreview() {
  return (
    <div className={styles.scroller}>
      <div className={styles.canvas} role="img" aria-label={preview.alt}>
        <div className={styles.window} aria-hidden="true">
          <div className={styles.chrome}>
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.dot} />
            <span className={styles.windowTitle}>{preview.windowTitle}</span>
          </div>

          <div className={styles.subHeader}>
            <div className={styles.subHeaderLeft}>
              <span className={styles.back}>{preview.header.back}</span>
              <span className={styles.divider}>|</span>
              <span className={styles.experienceLabel}>{preview.header.experienceLabel}</span>
              <span className={styles.experienceTitle}>{preview.header.experienceTitle}</span>
            </div>
            <div className={styles.subHeaderRight}>
              <span className={styles.chip}>{preview.header.codeChip}</span>
              <span className={styles.chip}>{preview.header.paarChip}</span>
            </div>
          </div>

          <div className={styles.body}>
            <CodeColumn />
            <ChatColumn />
            <PaarColumn />
          </div>
        </div>
      </div>
    </div>
  );
}

function CodeColumn() {
  const { code } = preview;
  return (
    <div className={styles.codeColumn}>
      <div className={styles.columnHeader}>
        <span className={styles.columnLabel}>{code.panelLabel}</span>
        <div className={styles.modeToggle}>
          <span className={styles.mode} data-active="">{code.diffMode}</span>
          <span className={styles.mode}>{code.fileMode}</span>
        </div>
      </div>
      <div className={styles.filesBar}>
        <span className={styles.filesLabel}>{code.filesLabel}</span>
        <span className={styles.filesCount}>{code.filesCount}</span>
      </div>
      <div className={styles.fileTree}>
        {code.tree.map((group) => (
          <div key={group.directory}>
            <div className={styles.directoryRow}>
              <span className={styles.caret}>▾</span>
              <span className={styles.directoryName}>{group.directory}</span>
            </div>
            {group.files.map((file) => (
              <div key={file.name} className={styles.fileRow} data-selected={"selected" in file ? "" : undefined}>
                <span className={styles.fileBullet}>●</span>
                <span className={styles.fileName}>{file.name}</span>
                {"added" in file ? (
                  <>
                    <span className={styles.added}>{file.added}</span>
                    <span className={styles.removed}>{file.removed}</span>
                  </>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className={styles.selectedFile}>
        <span className={styles.selectedFileLabel}>{code.selectedFileLabel}</span>
        <span className={styles.selectedFilePath}>{code.selectedFilePath}</span>
      </div>
      <div className={styles.diff}>
        {code.diff.map((line, index) => (
          <div key={index} className={styles.diffLine} data-kind={line.kind}>
            <span className={styles.diffLineNumber}>{line.line}</span>
            <span className={styles.diffMark}>{DIFF_MARK[line.kind]}</span>
            <span className={styles.diffText}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChatColumn() {
  const { chat } = preview;
  return (
    <div className={styles.chatColumn}>
      <div className={styles.messages}>
        {chat.messages.map((message, index) => (
          <div key={index} className={styles.message}>
            <span className={styles.role} data-role={message.role}>
              {message.role === "agent" ? chat.agent : chat.you}
            </span>
            <div className={styles.messageBody}>
              {"stage" in message ? (
                <div className={styles.messageMeta}>
                  <span className={styles.stage}>{message.stage}</span>
                  {"evidence" in message ? <span className={styles.evidenceChip}>{message.evidence}</span> : null}
                </div>
              ) : null}
              <p className={styles.messageText}>{message.text}</p>
            </div>
            <span className={styles.time}>{message.time}</span>
          </div>
        ))}
      </div>
      <div className={styles.composerArea}>
        <div className={styles.composer}>
          <div className={styles.composerPlaceholder}>{chat.composerPlaceholder}</div>
          <div className={styles.composerFooter}>
            <span className={styles.composerStage}>{chat.composerStage}</span>
            <div className={styles.composerActions}>
              <span className={styles.composerShortcut}>{chat.composerShortcut}</span>
              <span className={styles.composerSubmit}>{chat.composerSubmit}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PaarColumn() {
  const { paar } = preview;
  return (
    <div className={styles.paarColumn}>
      <div className={styles.paarHeader}>
        <div className={styles.paarHeaderTop}>
          <span className={styles.columnLabel}>{paar.panelLabel}</span>
          <span className={styles.paarProgress}>{paar.progress}</span>
        </div>
        <div className={styles.markers}>
          {paar.markers.map((marker, index) => (
            <div key={index} className={styles.marker} data-state={marker.state}>
              <span className={styles.markerMark}>{PAAR_MARK[marker.state]}</span>
              <span className={styles.markerLetter}>{marker.letter}</span>
            </div>
          ))}
        </div>
      </div>
      <div className={styles.paarCards}>
        {paar.cards.map((card) => (
          <div key={card.label} className={styles.card} data-state={card.state}>
            <div className={styles.cardHeader}>
              <span className={styles.cardMark}>{PAAR_MARK[card.state]}</span>
              <span className={styles.cardLabel}>{card.label}</span>
              {"note" in card ? <span className={styles.cardNote}>{card.note}</span> : null}
            </div>
            <p className={styles.cardText}>{card.text}</p>
            {"verified" in card ? (
              <div className={styles.cardVerified}>
                <span className={styles.cardVerifiedLabel}>{paar.verifiedLabel}</span>
                <span className={styles.cardVerifiedValue}>{paar.verifiedValue}</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

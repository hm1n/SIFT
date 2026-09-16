import type { ReactNode } from "react";
import { APP_SHELL_COPY } from "@/copy/shell";
import styles from "./app-shell.module.css";

export interface ShellRepository {
  owner: string;
  name: string;
  /** 공개 여부입니다. 목록 조회가 붙기 전에는 알 수 없어 선택 사항입니다. */
  visibility?: "public" | "private";
  language?: string | null;
}

export interface AppShellProps {
  /**
   * 지금 보고 있는 Repository입니다. 아직 고르기 전이면 `null`입니다.
   *
   * 고르기 전에도 셸을 그립니다. 저장된 인터뷰 목록이 사이드바에 있고, 그 목록은 어떤 Repository를
   * 고르기 전에도 골라 이어갈 수 있어야 하기 때문입니다(이슈 #115).
   */
  repository: ShellRepository | null;
  /** 생략하면 Repository 변경 버튼을 그리지 않습니다. 고를 Repository가 없는 화면에서 씁니다. */
  onChangeRepository?: () => void;
  /**
   * 사이드바 Interviews 영역의 내용입니다. 저장된 인터뷰 목록이 들어갑니다. 목록을 셸이 직접 그리지
   * 않는 이유는 목록이 저장 계층의 값과 삭제 조작을 다루는 기능 쪽 화면이기 때문입니다.
   */
  interviews?: ReactNode;
  /** 새 경험을 찾으러 Repository 선택으로 갑니다. 생략하면 그 버튼을 그리지 않습니다. */
  onFindNewExperience?: () => void;
  children: ReactNode;
}

/**
 * 로그인 뒤 화면이 공유하는 셸입니다. 왼쪽 사이드바에 지금 보고 있는 Repository와 저장된 인터뷰
 * 목록을 두고 오른쪽에 화면을 그립니다. 디자인 파일 `App.tsx`의 `AppShell`을 옮겼습니다.
 *
 * Repository를 고르지 않은 화면에서도 사이드바의 높이가 같게 빈 자리를 채웁니다. 자리를 비워 두면
 * 선택 화면과 분석 화면을 오갈 때 아래의 경계선과 목록이 위아래로 흔들립니다(디자인 원본 주석).
 */
export function AppShell({ repository, onChangeRepository, interviews, onFindNewExperience, children }: AppShellProps) {
  const meta = repository
    ? [repository.visibility?.toUpperCase(), repository.language ?? undefined].filter(Boolean).join(" · ")
    : "";
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label={APP_SHELL_COPY.workspace}>
        <section className={styles.repository} aria-label={APP_SHELL_COPY.repositorySection}>
          <span className={styles.sectionLabel}>{APP_SHELL_COPY.repositorySection}</span>
          <div className={styles.repositoryInfo}>
            {repository ? (
              <>
                <p className={styles.repositoryName}>{repository.name}</p>
                <p className={styles.repositoryMeta}>{repository.owner} / {repository.name}</p>
                {meta ? <p className={styles.repositoryMeta}>{meta}</p> : null}
              </>
            ) : (
              <p className={styles.noRepository}>{APP_SHELL_COPY.noRepository}</p>
            )}
          </div>
          {onChangeRepository ? (
            <button type="button" className={styles.changeRepository} onClick={onChangeRepository}>
              {APP_SHELL_COPY.changeRepository}
            </button>
          ) : null}
        </section>
        <section className={styles.interviews} aria-label={APP_SHELL_COPY.interviewsSection}>
          {interviews ?? (
            <>
              <span className={styles.sectionLabel}>{APP_SHELL_COPY.interviewsSection}</span>
              <p className={styles.emptyInterviews}>{APP_SHELL_COPY.noInterviews}</p>
            </>
          )}
        </section>
        {onFindNewExperience ? (
          <div className={styles.sidebarFooter}>
            <button type="button" className={styles.findNew} onClick={onFindNewExperience}>
              <span className={styles.plus} aria-hidden="true">+</span> {APP_SHELL_COPY.findNewExperience}
            </button>
          </div>
        ) : null}
      </aside>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

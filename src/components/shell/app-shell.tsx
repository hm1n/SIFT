import type { ReactNode } from "react";
import styles from "./app-shell.module.css";

export interface ShellRepository {
  owner: string;
  name: string;
  /** 공개 여부입니다. 목록 조회가 붙기 전에는 알 수 없어 선택 사항입니다. */
  visibility?: "public" | "private";
  language?: string | null;
}

export interface AppShellProps {
  repository: ShellRepository;
  onChangeRepository: () => void;
  children: ReactNode;
}

/**
 * 로그인 뒤 화면이 공유하는 셸입니다. 왼쪽 사이드바에 현재 Repository와 Change repository 액션을 두고 오른쪽에 화면을 그립니다.
 * 디자인 파일 `App.tsx`의 `AppShell`을 옮겼습니다. Interviews 영역은 세션 저장이 없어 빈 상태 문구만 둡니다.
 * 실제 배치는 Repository 선택 화면이 생기는 #96 이후 화면 이슈가 합니다.
 */
export function AppShell({ repository, onChangeRepository, children }: AppShellProps) {
  const meta = [repository.visibility?.toUpperCase(), repository.language ?? undefined].filter(Boolean).join(" · ");
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Workspace">
        <section className={styles.repository} aria-labelledby="shell-repository-label">
          <span className={styles.sectionLabel} id="shell-repository-label">Repository</span>
          <div className={styles.repositoryInfo}>
            <p className={styles.repositoryName}>{repository.name}</p>
            <p className={styles.repositoryMeta}>{repository.owner} / {repository.name}</p>
            {meta ? <p className={styles.repositoryMeta}>{meta}</p> : null}
          </div>
          <button type="button" className={styles.changeRepository} onClick={onChangeRepository}>
            ← Change repository
          </button>
        </section>
        <section className={styles.interviews} aria-labelledby="shell-interviews-label">
          <span className={styles.sectionLabel} id="shell-interviews-label">Interviews</span>
          <p className={styles.emptyInterviews}>No interviews yet. Select an experience candidate to begin.</p>
        </section>
      </aside>
      <div className={styles.content}>{children}</div>
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/shell/button";
import { StatusScreen } from "@/components/shell/status-screen";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import { GitHubFetchError, type GitHubFetchErrorKind } from "@/lib/github/errors";
import type { RepositorySummary } from "@/lib/github/types";
import { parseContributionItems } from "./contribution-items";
import { fetchRepositoriesFromApi } from "./repository-client";
import { formatUpdatedLabel } from "./updated-label";
import styles from "./repository-select-screen.module.css";

/** textarea가 자동으로 늘어나는 상한입니다. 디자인 `RepoSelectScreen`의 값입니다. */
const CONTRIBUTION_MAX_HEIGHT = 160;

type ListState =
  | { status: "loading" }
  | { status: "error"; kind: GitHubFetchErrorKind }
  | { status: "ready"; repositories: RepositorySummary[] };

/**
 * 목록 조회 실패 안내입니다. 제목은 디자인의 `Unable to load repositories.`로 고정하고 sub만 원인별로 갈립니다.
 * 인증 취소는 Try again으로 풀리지 않으므로 로그인 화면의 ERROR / AUTH 형식으로 다시 로그인을 안내합니다.
 */
const ERROR_SUB: Record<Exclude<GitHubFetchErrorKind, "auth_revoked">, string> = {
  rate_limit: "GitHub rate limit reached. Wait a moment and try again.",
  network: "We couldn't reach the server. Check your connection and try again.",
  repo_not_found: "GitHub returned an error.",
  server_error: "GitHub returned an error.",
  partial_failure: "GitHub returned an error.",
};

export interface RepositorySelectScreenProps {
  onAnalyze: (repository: RepositorySummary, contributionItems: string[]) => void;
  /** 테스트에서 목록 조회를 대체하는 통로입니다. */
  fetchRepositories?: () => Promise<RepositorySummary[]>;
  /** `UPDATED nD AGO` 계산 기준 시각입니다. 테스트가 고정합니다. */
  now?: () => number;
}

/**
 * 로그인 뒤 첫 화면입니다. 디자인 파일 `App.tsx`의 `RepoSelectScreen`을 옮겼고, LOADING REPOSITORIES, NO REPOSITORIES,
 * ERROR / GITHUB는 같은 파일 1393~1395행대로 `StatusScreen`으로 그립니다. 사이드바 셸 배치는 #96 이후입니다.
 *
 * 기여 항목은 `contribution-context.md`대로 목록 카드 아래 별도 섹션이고 선택 사항입니다. 항목 경계는 줄바꿈입니다.
 * 검색은 이미 받은 목록을 owner와 name으로 클라이언트에서 거릅니다. 목록 조회는 마운트 시 한 번이고 Try again이 다시 부릅니다.
 */
export function RepositorySelectScreen({ onAnalyze, fetchRepositories = fetchRepositoriesFromApi, now = Date.now }: RepositorySelectScreenProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [contribution, setContribution] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 방향키로 라디오 그룹을 오갈 때 다음 행에 실제 DOM 포커스를 옮기는 데 씁니다. 콜백 ref가 매 렌더 커밋마다
  // 자기 인덱스 자리를 스스로 채우고, 행이 사라지면 React가 같은 콜백을 null로 불러 스스로 비웁니다.
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const copyId = useId();

  useEffect(() => {
    let stale = false;
    fetchRepositories().then(
      (repositories) => {
        if (!stale) setList({ status: "ready", repositories });
      },
      (error: unknown) => {
        if (!stale) setList({ status: "error", kind: error instanceof GitHubFetchError ? error.kind : "server_error" });
      }
    );
    return () => {
      stale = true;
    };
  }, [fetchRepositories, attempt]);

  // 디자인대로 3행에서 시작해 내용에 맞춰 160px까지 늘어납니다. jsdom은 scrollHeight가 0이라 테스트에서는 효과가 없습니다.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, CONTRIBUTION_MAX_HEIGHT)}px`;
  }, [contribution, list.status]);

  async function reauthenticate() {
    await fetch(SESSION_PATH, { method: "DELETE" }).catch(() => undefined);
    router.refresh();
  }

  if (list.status === "loading") {
    return <StatusScreen kind="loading" code="Loading Repositories" label="Fetching repositories from GitHub..." sub="" />;
  }

  if (list.status === "error") {
    if (list.kind === "auth_revoked") {
      return (
        <StatusScreen
          kind="error"
          code="ERROR / AUTH"
          label="Unable to connect to GitHub."
          sub="Your GitHub session is no longer valid. Log in again to continue."
          action={{ label: "Log in again", onClick: () => void reauthenticate() }}
        />
      );
    }
    return (
      <StatusScreen
        kind="error"
        code="ERROR / GITHUB"
        label="Unable to load repositories."
        sub={ERROR_SUB[list.kind]}
        action={{
          label: "Try again",
          onClick: () => {
            setList({ status: "loading" });
            setAttempt((count) => count + 1);
          },
        }}
      />
    );
  }

  const { repositories } = list;
  if (repositories.length === 0) {
    return (
      <StatusScreen
        kind="empty"
        code="No Repositories"
        label="No repositories available for analysis."
        sub="Make sure your GitHub account has at least one repository."
      />
    );
  }

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = normalizedQuery === ""
    ? repositories
    : repositories.filter((repository) =>
        repository.name.toLowerCase().includes(normalizedQuery) || repository.owner.toLowerCase().includes(normalizedQuery)
      );
  const selected = repositories.find((repository) => repository.id === selectedId) ?? null;
  const currentTime = now();
  const selectedFilteredIndex = filtered.findIndex((repository) => repository.id === selectedId);

  /**
   * 표준 라디오 그룹 키보드 패턴입니다. 방향키가 선택과 DOM 포커스를 함께 다음 행으로 옮기고 양 끝에서 순환합니다.
   * 선택이 없으면 첫 행만 tab 순서에 남기고(roving tabindex), 나머지는 tabIndex -1로 건너뜁니다.
   */
  function moveSelection(fromIndex: number, delta: number) {
    if (filtered.length === 0) return;
    const nextIndex = (fromIndex + delta + filtered.length) % filtered.length;
    setSelectedId(filtered[nextIndex].id);
    rowRefs.current[nextIndex]?.focus();
  }

  function handleRadioKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveSelection(index, 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveSelection(index, -1);
    }
  }

  function isRowTabbable(index: number) {
    return selectedFilteredIndex === -1 ? index === 0 : index === selectedFilteredIndex;
  }

  return (
    <div className={styles.screen}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Select Repository</p>
        <h1 className={styles.title}>Choose a repository to analyze.</h1>
      </header>

      <div className={styles.body}>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby={`${labelId}-repositories`}>
            <div className={styles.cardHeader}>
              <span className={styles.label} id={`${labelId}-repositories`}>Repositories</span>
              <span className={styles.count}>{repositories.length}</span>
            </div>
            <div className={styles.searchRow}>
              <input
                type="search"
                className={styles.search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search repositories..."
                aria-label="Search repositories"
                autoComplete="off"
              />
            </div>
            {filtered.length === 0 ? (
              <p className={styles.noMatch}>No repositories match your search.</p>
            ) : (
              <div role="radiogroup" aria-label="Repositories">
                {filtered.map((repository, index) => {
                  const isSelected = repository.id === selectedId;
                  const updated = formatUpdatedLabel(repository.pushedAt, currentTime);
                  return (
                    <div key={repository.id} className={index < filtered.length - 1 ? styles.rowWithDivider : undefined}>
                      <button
                        ref={(element) => { rowRefs.current[index] = element; }}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        tabIndex={isRowTabbable(index) ? 0 : -1}
                        className={`${styles.row} ${isSelected ? styles.rowSelected : ""}`}
                        onClick={() => setSelectedId(repository.id)}
                        onKeyDown={(event) => handleRadioKeyDown(event, index)}
                      >
                        <span className={`${styles.radio} ${isSelected ? styles.radioSelected : ""}`} aria-hidden="true" />
                        <span className={styles.rowMain}>
                          <span className={styles.rowName}>
                            <span className={styles.rowOwner}>{repository.owner} / </span>
                            {repository.name}
                          </span>
                          <span className={styles.rowMeta}>
                            {repository.language ? <span>{repository.language}</span> : null}
                            {repository.language && repository.visibility === "private" ? <span className={styles.dot}> · </span> : null}
                            {repository.visibility === "private" ? <span>PRIVATE</span> : null}
                          </span>
                        </span>
                        {updated ? <span className={styles.rowUpdated}>{updated}</span> : null}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className={styles.contribution} aria-labelledby={labelId}>
            <div className={styles.contributionHeader}>
              <span className={styles.label} id={labelId}>Your Contribution</span>
              <span className={styles.optional}>Optional</span>
            </div>
            <p className={styles.contributionCopy} id={copyId}>프로젝트에서 주로 기여한 내용을 알려주세요.</p>
            <div className={styles.textareaFrame}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={contribution}
                onChange={(event) => setContribution(event.target.value)}
                placeholder="실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다."
                rows={3}
                aria-labelledby={labelId}
                aria-describedby={copyId}
              />
            </div>
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.selection}>{selected ? `${selected.owner} / ${selected.name}` : "No repository selected"}</span>
        <Button
          variant="primary"
          disabled={selected === null}
          onClick={() => selected && onAnalyze(selected, parseContributionItems(contribution))}
        >
          Analyze <span className={styles.arrow} aria-hidden="true">→</span>
        </Button>
      </footer>
    </div>
  );
}

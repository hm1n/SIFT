"use client";

import { useRouter } from "next/navigation";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/shell/button";
import { StatusScreen } from "@/components/shell/status-screen";
import { REPOSITORY_FETCH_ERROR_SUB, REPOSITORY_SELECT_COPY } from "@/copy/repository";
import { SESSION_PATH } from "@/lib/github/auth-paths";
import { GitHubFetchError, type GitHubFetchErrorKind } from "@/lib/github/errors";
import type { RepositorySummary } from "@/lib/github/types";
import { fetchAnalysisUsage, type AnalysisUsage } from "@/features/usage-limit/usage-client";
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

export interface RepositorySelectScreenProps {
  onAnalyze: (repository: RepositorySummary, contributionItems: string[]) => void;
  /** 테스트에서 목록 조회를 대체하는 통로입니다. */
  fetchRepositories?: () => Promise<RepositorySummary[]>;
  /** `UPDATED nD AGO` 계산 기준 시각입니다. 테스트가 고정합니다. */
  now?: () => number;
  /** 테스트에서 오늘 쓴 분석 횟수 조회를 대체하는 통로입니다. */
  fetchUsage?: () => Promise<AnalysisUsage | null>;
}

/**
 * 로그인 뒤 첫 화면입니다. 디자인 파일 `App.tsx`의 `RepoSelectScreen`을 옮겼고, LOADING REPOSITORIES, NO REPOSITORIES,
 * ERROR / GITHUB는 같은 파일 1393~1395행대로 `StatusScreen`으로 그립니다. 사이드바 셸 배치는 #96 이후입니다.
 *
 * 기여 항목은 `contribution-context.md`대로 목록 카드 아래 별도 섹션이고 선택 사항입니다. 항목 경계는 줄바꿈입니다.
 * 검색은 이미 받은 목록을 owner와 name으로 클라이언트에서 거릅니다. 목록 조회는 마운트 시 한 번이고 Try again이 다시 부릅니다.
 */
export function RepositorySelectScreen({ onAnalyze, fetchRepositories = fetchRepositoriesFromApi, now = Date.now, fetchUsage = fetchAnalysisUsage }: RepositorySelectScreenProps) {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [contribution, setContribution] = useState("");
  /**
   * 오늘 쓴 분석 횟수입니다(이슈 #142). 아직 읽지 못했거나 읽는 데 실패하면 `null`입니다.
   *
   * 두 경우를 가르지 않습니다. 안내를 그리지 않고 분석도 막지 않는 동작이 같습니다. 읽지 못한 것을
   * 오류 화면으로 올리지도 않습니다. 상한은 Stage A 라우트가 집행하므로, 이 값을 못 읽었다고
   * 분석을 막으면 아직 횟수가 남은 사용자까지 막습니다.
   */
  const [usage, setUsage] = useState<AnalysisUsage | null>(null);
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

  // 목록과 따로 읽습니다. 한 요청에 묶으면 횟수를 읽지 못한 것만으로 목록까지 오류 화면이 됩니다.
  useEffect(() => {
    let stale = false;
    fetchUsage().then((value) => {
      if (!stale) setUsage(value);
    });
    return () => {
      stale = true;
    };
  }, [fetchUsage]);

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
    return <StatusScreen kind="loading" code="Loading Repositories" label={REPOSITORY_SELECT_COPY.loadingLabel} sub="" />;
  }

  if (list.status === "error") {
    if (list.kind === "auth_revoked") {
      return (
        <StatusScreen
          kind="error"
          code="ERROR / AUTH"
          label={REPOSITORY_SELECT_COPY.authErrorLabel}
          sub={REPOSITORY_SELECT_COPY.authErrorSub}
          action={{ label: REPOSITORY_SELECT_COPY.logInAgain, onClick: () => void reauthenticate() }}
        />
      );
    }
    return (
      <StatusScreen
        kind="error"
        code="ERROR / GITHUB"
        label={REPOSITORY_SELECT_COPY.fetchErrorLabel}
        sub={REPOSITORY_FETCH_ERROR_SUB[list.kind]}
        action={{
          label: REPOSITORY_SELECT_COPY.tryAgain,
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
        label={REPOSITORY_SELECT_COPY.emptyLabel}
        sub={REPOSITORY_SELECT_COPY.emptySub}
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
  /**
   * 상한에 닿았는지입니다. 횟수를 읽지 못했으면 닿지 않은 것으로 봅니다(이슈 #142).
   *
   * 읽지 못한 경우를 막힌 것으로 보면 조회가 한 번 실패했다는 이유로 아직 횟수가 남은 사용자가
   * 분석을 시작하지 못합니다. 반대로 열어 두면 남지 않은 사용자가 한 번 헛걸음하고 Stage A 라우트의
   * 429를 받습니다. 틀렸을 때 잃는 것이 적은 쪽을 고릅니다.
   */
  const limitReached = usage !== null && usage.used >= usage.limit;
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
        <p className={styles.eyebrow}>{REPOSITORY_SELECT_COPY.eyebrow}</p>
        <h1 className={styles.title}>{REPOSITORY_SELECT_COPY.title}</h1>
      </header>

      <div className={styles.body}>
        <div className={styles.column}>
          <section className={styles.card} aria-labelledby={`${labelId}-repositories`}>
            <div className={styles.cardHeader}>
              <span className={styles.label} id={`${labelId}-repositories`}>{REPOSITORY_SELECT_COPY.repositoriesLabel}</span>
              <span className={styles.count}>{repositories.length}</span>
            </div>
            <div className={styles.searchRow}>
              <input
                type="search"
                className={styles.search}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={REPOSITORY_SELECT_COPY.searchPlaceholder}
                aria-label={REPOSITORY_SELECT_COPY.searchLabel}
                autoComplete="off"
              />
            </div>
            {filtered.length === 0 ? (
              <p className={styles.noMatch}>{REPOSITORY_SELECT_COPY.noMatch}</p>
            ) : (
              <div role="radiogroup" aria-label={REPOSITORY_SELECT_COPY.repositoriesLabel}>
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
                            {repository.visibility === "private" ? <span>{REPOSITORY_SELECT_COPY.privateBadge}</span> : null}
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
              <span className={styles.label} id={labelId}>{REPOSITORY_SELECT_COPY.contributionLabel}</span>
              <span className={styles.optional}>{REPOSITORY_SELECT_COPY.optionalBadge}</span>
            </div>
            <p className={styles.contributionCopy} id={copyId}>{REPOSITORY_SELECT_COPY.contributionHelp}</p>
            <div className={styles.textareaFrame}>
              <textarea
                ref={textareaRef}
                className={styles.textarea}
                value={contribution}
                onChange={(event) => setContribution(event.target.value)}
                placeholder={REPOSITORY_SELECT_COPY.contributionPlaceholder}
                rows={3}
                aria-labelledby={labelId}
                aria-describedby={copyId}
              />
            </div>
          </section>
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.footerStatus}>
          <span className={styles.selection}>{selected ? `${selected.owner} / ${selected.name}` : REPOSITORY_SELECT_COPY.noSelection}</span>
          {usage ? (
            <span className={limitReached ? styles.usageExceeded : styles.usage}>
              {limitReached
                ? REPOSITORY_SELECT_COPY.analysisLimitReached
                : REPOSITORY_SELECT_COPY.analysisUsage(usage.used, usage.limit)}
            </span>
          ) : null}
        </div>
        <Button
          variant="primary"
          disabled={selected === null || limitReached}
          onClick={() => selected && !limitReached && onAnalyze(selected, parseContributionItems(contribution))}
        >
          {REPOSITORY_SELECT_COPY.analyze} <span className={styles.arrow} aria-hidden="true">→</span>
        </Button>
      </footer>
    </div>
  );
}

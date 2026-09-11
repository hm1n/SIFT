"use client";

import { useState } from "react";
import { RepositoryAnalysisView } from "@/features/repository-analysis/repository-analysis-view";
import type { RepositoryRef, RepositorySummary } from "@/lib/github/types";
import { RepositorySelectScreen } from "./repository-select-screen";
import styles from "./repository-flow.module.css";

interface Selection {
  repository: RepositoryRef;
  summary: RepositorySummary;
  contributionItems: readonly string[];
}

/**
 * 로그인 뒤 화면 전환입니다. 선택이 없으면 Repository 선택 화면, 선택하면 그 Repository의 분석 화면을 그립니다.
 * `Change repository`류의 되돌아가기는 선택을 비워 목록을 다시 조회합니다. 분석 화면의 사이드바 셸 배치와
 * `summary`의 visibility·language 전달은 #96이 합니다.
 */
export function RepositoryFlow() {
  const [selection, setSelection] = useState<Selection | null>(null);

  if (selection === null) {
    return (
      <RepositorySelectScreen
        onAnalyze={(summary, contributionItems) =>
          setSelection({ repository: { owner: summary.owner, repo: summary.name }, summary, contributionItems })
        }
      />
    );
  }

  return (
    <div className={styles.analysis}>
      <RepositoryAnalysisView
        repository={selection.repository}
        contributionItems={selection.contributionItems}
        onSelectRepository={() => setSelection(null)}
      />
    </div>
  );
}

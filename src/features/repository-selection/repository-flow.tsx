"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell/app-shell";
import { RepositoryAnalysisView } from "@/features/repository-analysis/repository-analysis-view";
import type { RepositorySummary } from "@/lib/github/types";
import { RepositorySelectScreen } from "./repository-select-screen";

interface Selection {
  summary: RepositorySummary;
  contributionItems: readonly string[];
}

/**
 * 로그인 뒤 화면 전환입니다. 선택이 없으면 Repository 선택 화면, 선택하면 그 Repository의 분석 화면을 그립니다.
 * `Change repository`류의 되돌아가기는 선택을 비워 목록을 다시 조회합니다. 분석 화면은 #96부터 `AppShell`로
 * 감싸고, 선택 화면이 조회한 `summary`의 visibility·language를 그대로 `AppShell`과 분석 화면 헤더에 전달합니다.
 */
export function RepositoryFlow() {
  const [selection, setSelection] = useState<Selection | null>(null);

  if (selection === null) {
    return (
      <RepositorySelectScreen
        onAnalyze={(summary, contributionItems) => setSelection({ summary, contributionItems })}
      />
    );
  }

  const { summary, contributionItems } = selection;
  const backToSelection = () => setSelection(null);

  return (
    <AppShell
      repository={{ owner: summary.owner, name: summary.name, visibility: summary.visibility, language: summary.language }}
      onChangeRepository={backToSelection}
    >
      <RepositoryAnalysisView
        repository={summary}
        contributionItems={contributionItems}
        onSelectRepository={backToSelection}
      />
    </AppShell>
  );
}

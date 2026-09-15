"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { deleteSavedInterview, fetchSavedInterviews } from "./client";
import type { SavedInterviewListState } from "./saved-interview-list";

/**
 * 사이드바 목록이 쓰는 상태입니다(이슈 #115). 조회와 삭제와 다시 시도를 한곳에 둡니다.
 *
 * 목록을 화면마다 따로 들고 있지 않고 셸을 그리는 흐름 컴포넌트가 하나만 들고 내려보냅니다. 화면마다
 * 조회하면 저장소 선택과 분석과 인터뷰를 오갈 때마다 같은 목록을 다시 받습니다.
 */
export interface SavedInterviews {
  readonly state: SavedInterviewListState;
  /** 목록을 다시 조회합니다. 조회 실패 안내의 다시 시도와, 인터뷰를 새로 만든 뒤에 씁니다. */
  readonly reload: () => void;
  /** 인터뷰 하나를 지웁니다. 실패하면 목록을 다시 조회해 지워지지 않았다는 것을 그대로 보입니다. */
  readonly remove: (interviewId: string) => void;
}

export function useSavedInterviews(fetchImpl?: typeof fetch): SavedInterviews {
  const [state, setState] = useState<SavedInterviewListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const fetchRef = useRef(fetchImpl);
  // 렌더 중에 ref를 고치지 않습니다. 아래 조회 효과보다 먼저 선언해 같은 커밋에서 최신 값이 됩니다.
  useEffect(() => {
    fetchRef.current = fetchImpl;
  });

  useEffect(() => {
    let stale = false;
    fetchSavedInterviews(fetchRef.current).then(
      (interviews) => {
        if (!stale) setState({ status: "ready", interviews });
      },
      () => {
        if (!stale) setState({ status: "error" });
      }
    );
    return () => {
      stale = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((count) => count + 1);
  }, []);

  /**
   * 화면에서 먼저 지우고 요청을 보냅니다. 응답을 기다린 뒤에 지우면 누른 뒤에도 그 인터뷰가 목록에
   * 남아 있어 한 번 더 누르게 됩니다. 실패하면 다시 조회해서 서버에 남아 있는 그대로를 보입니다.
   */
  const remove = useCallback((interviewId: string) => {
    setState((previous) =>
      previous.status === "ready"
        ? { status: "ready", interviews: previous.interviews.filter((item) => item.id !== interviewId) }
        : previous
    );
    deleteSavedInterview(interviewId, fetchRef.current).catch(() => {
      setState({ status: "loading" });
      setAttempt((count) => count + 1);
    });
  }, []);

  return { state, reload, remove };
}

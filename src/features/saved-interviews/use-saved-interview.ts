"use client";

import { useEffect, useRef, useState } from "react";
import { fetchSavedInterview, SavedInterviewFetchError, type SavedInterviewFetchErrorKind } from "./client";
import type { StoredInterviewPayload } from "./payload";

/**
 * 저장된 인터뷰 하나를 불러옵니다(이슈 #115). 이어가기 진입에서 씁니다.
 *
 * `attempt`가 바뀔 때마다 다시 불러옵니다. 다시 시도와, 다른 탭이 먼저 저장했을 때의 "최신 내용
 * 불러오기"가 같은 통로를 씁니다. 두 경우 모두 하는 일이 "지금 저장된 것을 다시 읽는 것"으로 같습니다.
 */
export type SavedInterviewState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly kind: SavedInterviewFetchErrorKind }
  | { readonly status: "ready"; readonly interview: StoredInterviewPayload };

const LOADING: SavedInterviewState = { status: "loading" };

export function useSavedInterview(
  interviewId: string | null,
  attempt = 0,
  fetchImpl?: typeof fetch
): SavedInterviewState {
  /**
   * 어느 요청의 결과인지를 함께 들고 있습니다. 결과가 지금 보려는 인터뷰의 것이 아니면 읽는 중으로
   * 봅니다. 요청이 바뀔 때마다 "읽는 중"을 다시 넣지 않아도 되고, 앞 인터뷰의 내용이 새 인터뷰의
   * 자리에 잠깐 비치는 일도 없습니다.
   */
  const [result, setResult] = useState<{ key: string; state: SavedInterviewState } | null>(null);
  const fetchRef = useRef(fetchImpl);
  useEffect(() => {
    fetchRef.current = fetchImpl;
  });

  const key = `${interviewId ?? ""}:${attempt}`;

  useEffect(() => {
    if (interviewId === null) return;
    let stale = false;
    fetchSavedInterview(interviewId, fetchRef.current).then(
      (interview) => {
        if (!stale) setResult({ key, state: { status: "ready", interview } });
      },
      (error: unknown) => {
        if (stale) return;
        setResult({
          key,
          state: {
            status: "error",
            kind: error instanceof SavedInterviewFetchError ? error.kind : "server_error",
          },
        });
      }
    );
    return () => {
      stale = true;
    };
  }, [interviewId, key]);

  return result?.key === key ? result.state : LOADING;
}

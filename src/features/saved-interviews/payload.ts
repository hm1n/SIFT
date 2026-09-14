import type { InterviewListItem, StoredInterview } from "@/lib/db/store";

/**
 * 저장 계층의 값을 응답 본문 모양으로 옮깁니다.
 *
 * 시각을 `Date`가 아니라 ISO 문자열로 내보냅니다. JSON에는 날짜 타입이 없어 `Date`를 그대로 실으면
 * 어차피 문자열이 되는데, 타입만 `Date`로 남으면 받는 쪽이 `getTime()`을 부르다 깨집니다.
 *
 * 목록에 `updatedAt`을 싣고 `openedAt`은 싣지 않습니다. 화면이 보여 주는 "마지막으로 이어간 시각"은
 * `updatedAt`이고, `openedAt`은 90일 정리의 기준이라 화면이 쓰지 않습니다.
 */
export interface InterviewListItemPayload {
  readonly id: string;
  readonly repoOwner: string;
  readonly repoName: string;
  readonly title: string;
  readonly status: InterviewListItem["status"];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StoredInterviewPayload extends InterviewListItemPayload {
  readonly analysisId: string;
  readonly candidateKey: string;
  readonly evidence: unknown;
  readonly history: StoredInterview["history"];
  readonly blockState: StoredInterview["blockState"];
  readonly blockVersion: number;
  /** 재질문 예산을 정하는 값입니다. 이것이 없으면 복원한 인터뷰가 이미 답하지 못한 요소를 다시 묻습니다. */
  readonly progress: StoredInterview["progress"];
}

export function toInterviewListItemPayload(item: InterviewListItem): InterviewListItemPayload {
  return {
    id: item.id,
    repoOwner: item.repoOwner,
    repoName: item.repoName,
    title: item.title,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toStoredInterviewPayload(interview: StoredInterview): StoredInterviewPayload {
  return {
    ...toInterviewListItemPayload(interview),
    analysisId: interview.analysisId,
    candidateKey: interview.candidateKey,
    evidence: interview.evidence,
    history: interview.history,
    blockState: interview.blockState,
    blockVersion: interview.blockVersion,
    progress: interview.progress,
  };
}

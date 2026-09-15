"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import {
  buildLastOutcome,
  INTERVIEW_MAX_TURNS,
  type InterviewHistoryMessage,
} from "@/features/interview/history";
import {
  READY_TO_FINISH_PROMPT,
  useInterviewStream,
  type InterviewQuestionOutcome,
  type InterviewQuestionTarget,
  type InterviewStreamState,
} from "@/features/interview/use-interview-stream";
import { completeSavedInterview } from "@/features/saved-interviews/client";
import type { BlockUpdateSaveStatus, SavedTurnStatus } from "@/features/saved-interviews/save-status";
import { BlockUpdateFetchError, fetchBlockUpdate, fetchSaveOnly, type BlockUpdateFetchErrorKind } from "./client";
import type { InterviewProgress } from "./progress";
import { emptyInterviewProgress, recordAsked, recordResponse, selectNextTarget } from "./progress";
import type { ExperienceBlockSaveTarget } from "./request";
import {
  BLOCK_KINDS,
  emptyExperienceBlockState,
  type BlockKind,
  type ExperienceBlockState,
  type TargetResponse,
} from "./types";

/**
 * 이슈 #90 "턴 진행과 블록 전환, 열 턴 자동 종료"의 훅입니다. 설계는
 * `llm-wiki/wiki/2026-09-11-PAAR-경험블록-설계-개정.md`이고, 블록 패널은 그리지 않습니다(하위
 * 이슈 D의 범위). 이 훅은 화면이 쓸 수 있는 상태까지만 만듭니다.
 *
 * `useInterviewStream`을 감싸서 씁니다. 질문 스트리밍·재시도·이력 절단·종료 잠금은 그 훅이 이미
 * 실측으로 확정한 그대로 두고, 이 훅은 답변마다 블록 갱신을 호출해 다음 질문의 대상(블록·요소)을
 * 정하는 층만 더합니다. `onBeforeQuestion`이 그 접합점입니다(설계 Approach 4, "답변 제출부터
 * 질문 요청까지를 하나의 취소 가능한 작업으로 묶는다").
 */

const FIRST_TARGET: NonNullable<InterviewQuestionTarget> = { targetBlock: "problem", targetElement: "a" };

export type ExperienceInterviewEndReason = "user" | "turn_limit";

/** 경험 블록 갱신 엔드포인트입니다. 호출부가 모두 같은 값을 쓰므로 기본값을 여기 둡니다. */
export const DEFAULT_EXPERIENCE_BLOCK_UPDATE_URL = "/api/interview/experience-block";
/** 저장된 인터뷰를 이어갈 때 받는 값입니다. `GET /api/interviews/[id]`의 응답에서 그대로 옵니다. */
export interface RestoredInterview {
  readonly history: readonly InterviewHistoryMessage[];
  readonly blockState: ExperienceBlockState;
  readonly progress: InterviewProgress;
  /**
   * 저장된 인터뷰의 상태입니다. `completed`면 대화를 읽기 전용으로 열고 질문을 요청하지 않습니다.
   *
   * 이 값이 없으면 끝낸 인터뷰를 다시 열었을 때 훅이 다음 질문을 고르고 요청합니다. 사용자가 끝낸
   * 대화가 다시 자라나고, 목록의 끝남 표시와 화면이 어긋납니다.
   */
  readonly status?: "in_progress" | "completed";
}

/**
 * 이어갈 인터뷰의 첫 질문 대상과, 그 질문을 보낸 것으로 친 진행 상태를 함께 정합니다.
 *
 * 대상 계산을 첫 렌더에서 한 번만 합니다. 이어가기는 "저장된 상태에서 다음에 물을 것"을 고르는
 * 일이고, 그 판단은 저장된 값이 바뀌지 않는 한 달라지지 않습니다.
 *
 * `done`은 저장된 상태만으로 더 물을 것이 없는 경우입니다. 이때는 질문을 요청하지 않고 완료 안내를
 * 보입니다. 요청하면 모델이 이미 충분한 블록을 한 번 더 묻습니다.
 */
function initialAsk(restore: RestoredInterview | undefined): {
  readonly target: NonNullable<InterviewQuestionTarget> | null;
  readonly progress: InterviewProgress;
  readonly turnsUsed: number;
} {
  if (restore === undefined) {
    return {
      target: FIRST_TARGET,
      progress: recordAsked(emptyInterviewProgress(), FIRST_TARGET.targetBlock, FIRST_TARGET.targetElement),
      turnsUsed: 0,
    };
  }
  // 저장된 대화는 질문과 답변이 짝을 이루므로 답변 수가 곧 지금까지의 턴 수입니다.
  const turnsUsed = restore.history.filter((message) => message.role === "answer").length;
  // 끝난 인터뷰는 다음에 물을 것을 고르지 않습니다. 다시 열어도 읽기만 합니다.
  if (restore.status === "completed") return { target: null, progress: restore.progress, turnsUsed };
  // `lastTarget`을 넘기지 않습니다. 직전 질문이 어느 블록을 겨냥했는지는 저장하는 값에 없고,
  // 진행 상태의 `askedCount`로 짐작하는 것은 상태를 직접 나타내지 않는 대리 지표입니다. 그래서
  // 이어가기는 같은 블록을 이어가는 것을 우선하지 않고, 아직 다루지 않은 블록을 먼저 묻습니다.
  const next = selectNextTarget({
    evaluation: restore.blockState.evaluation,
    progress: restore.progress,
    turnsUsed,
    maxTurns: INTERVIEW_MAX_TURNS,
    isEnded: false,
  });
  if (next.kind === "done") return { target: null, progress: restore.progress, turnsUsed };
  return {
    target: { targetBlock: next.block, targetElement: next.element },
    progress: recordAsked(restore.progress, next.block, next.element),
    turnsUsed,
  };
}

export interface UseExperienceInterviewOptions {
  /** 질문 스트림 엔드포인트입니다. 생략하면 `useInterviewStream`의 기본값을 씁니다. */
  questionUrl?: string;
  blockUpdateUrl?: string;
  snapshot: ExperienceEvidenceSnapshot;
  /**
   * 이 인터뷰가 저장될 줄입니다. 없으면 저장하지 않고 대화는 그대로 진행합니다(이슈 #115). 경험을
   * 확정할 때 만든 줄의 식별자를 넘깁니다.
   */
  interviewId?: string | null;
  /**
   * 인터뷰를 끝난 것으로 표시하는 요청입니다. 테스트가 대체합니다. 실패해도 대화에는 영향이 없고
   * 저장된 상태만 진행 중으로 남습니다.
   */
  completeInterview?: (interviewId: string) => Promise<void>;
  /**
   * 인터뷰가 끝났다고 서버에 알린 뒤 불립니다. 화면이 이 인터뷰의 요약으로 돌아가는 데 씁니다.
   *
   * 요청이 실패해도 부릅니다. 끝낸 것은 사용자의 조작이고 이미 일어난 일이라, 서버에 기록하지
   * 못했다고 해서 화면이 끝나지 않은 것처럼 남아 있으면 안 됩니다.
   */
  onCompleted?: () => void;
  /**
   * 저장된 인터뷰를 이어갈 때 그 인터뷰의 상태입니다. 없으면 빈 상태에서 시작합니다.
   *
   * 셋을 함께 받습니다. 대화만 받으면 블록이 비어 첫 질문부터 다시 묻고, 진행 상태를 빼면 이미
   * 답하지 못한 요소를 예산만큼 다시 묻습니다.
   */
  restore?: RestoredInterview;
  fetchImpl?: typeof fetch;
  retryDelaysMs?: readonly number[];
  sleep?: (ms: number) => Promise<void>;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface UseExperienceInterviewState extends InterviewStreamState {
  /** 검증된 블록 상태입니다. 블록 패널(하위 이슈 D)이 이 값을 그립니다. */
  blockState: ExperienceBlockState;
  /** 지금까지 확정된 턴 수입니다. 질문 하나와 그 답변이 한 턴입니다. */
  turnsUsed: number;
  maxTurns: number;
  /**
   * 유효한 질문 후보가 없어 완료 안내와 종료 버튼을 보일 시점인지입니다(설계 6-2절 6번). 이 값만으로
   * 종료하지 않습니다. 종료는 사용자가 `endInterview`를 불러야만 일어납니다.
   */
  isReadyToFinish: boolean;
  /** 종료 사유입니다. 종료 전에는 `null`입니다. */
  endReason: ExperienceInterviewEndReason | null;
  /**
   * 지금 화면에 있는 질문이 겨냥한 블록과 요소입니다. 첫 질문 전에도 `FIRST_TARGET`으로 정해져
   * 있어 `null`이 되지 않습니다.
   *
   * 블록 패널이 "수집 중" 카드를 가리는 데 쓰고, 답변 입력 아래의 현재 블록 안내도 이 값을
   * 읽습니다. 화면이 진행 상태를 따로 추적하면 질문이 겨냥한 블록과 어긋난 값을 그릴 수 있어,
   * 대상을 실제로 정하는 이 훅이 그대로 내보냅니다.
   */
  currentTarget: NonNullable<InterviewQuestionTarget>;
  /**
   * 블록 갱신을 호출하는 중인지입니다. 현재 답변의 갱신과 미반영 재처리를 가리지 않습니다. 둘 다
   * 같은 직렬 큐를 거치므로 한 번에 하나만 참입니다.
   *
   * 블록 패널의 "수집 중" 표시와 재처리 버튼의 중복 호출 방지에 함께 씁니다.
   */
  isBlockUpdating: boolean;
  /**
   * 지금 갱신 중인 블록입니다. 호출 중이 아니면 `null`입니다.
   *
   * `isBlockUpdating`만으로는 어느 블록인지 알 수 없어 화면이 `currentTarget`이라고 짐작해야 했고,
   * 미반영 재처리에서는 그 짐작이 틀립니다. 재처리는 예전 턴의 대상을 갱신하는데 `currentTarget`은
   * 이미 다음 블록으로 넘어가 있어, 관계없는 카드가 "수집 중"으로 보였습니다(PR #121 리뷰 1라운드).
   * 대상을 실제로 정하는 이 훅이 그대로 내보냅니다.
   */
  updatingBlock: BlockKind | null;
  /** 블록 갱신이 실패해 반영되지 않은 턴의 ID입니다. 없으면 `null`입니다. */
  unreflectedTurnId: string | null;
  /**
   * 마지막 블록 갱신이 실패한 이유입니다. 실패한 적이 없거나 그 뒤에 성공했으면 `null`입니다.
   *
   * 화면이 "반영되지 않았습니다"만 적으면 무엇을 해야 하는지 알 수 없습니다. 2026-09-15에 `.env`의
   * 키 이름이 어긋나 블록 갱신이 매번 인증 실패로 끝났는데, 화면에는 반영되지 않았다는 말만 떠서
   * 설정 문제라는 것이 드러나기까지 대화가 통째로 사라졌습니다. 분류는 그대로 올려 보내고 문구는
   * 화면이 정합니다.
   */
  unreflectedReason: BlockUpdateFetchErrorKind | null;
  /**
   * 마지막으로 시도한 저장의 결과입니다. 저장을 시도한 적이 없으면 `null`입니다. 저장 대상이 없어
   * 저장하지 않은 턴은 이 값을 바꾸지 않습니다. 안 그러면 앞 턴의 실패 안내가 조용히 지워집니다.
   */
  saveStatus: SavedTurnStatus | null;
  /** 아직 저장되지 않은 턴 수입니다. 0이면 화면의 대화가 전부 저장돼 있습니다. */
  unsavedTurnCount: number;
  /**
   * 밀린 턴을 다시 저장합니다. "마지막 답변이 저장되지 않았습니다" 안내의 버튼이 부릅니다.
   *
   * 반영까지 밀린 턴은 블록 갱신을 다시 걸어 반영과 저장을 함께 하고, 반영은 됐는데 저장만 밀린 턴은
   * 모델을 부르지 않는 저장 전용 요청으로 이어 붙입니다.
   */
  retrySave: () => void;
  /**
   * 미반영 턴들이 겨냥했던 블록입니다. 블록 패널이 어느 카드에 오류를 그릴지 정하는 데 씁니다.
   * `unreflectedTurnId`가 가장 오래된 턴 하나만 알려 주는 것과 달리 미반영 턴 전체를 담습니다.
   */
  unreflectedBlocks: readonly BlockKind[];
  /** 미반영 턴의 블록 갱신을 다시 시도합니다. 미반영 턴이 없으면 아무 일도 하지 않습니다. */
  retryUnreflectedBlockUpdate: () => void;
}

export function useExperienceInterview({
  questionUrl,
  blockUpdateUrl = DEFAULT_EXPERIENCE_BLOCK_UPDATE_URL,
  snapshot,
  interviewId = null,
  restore,
  completeInterview = completeSavedInterview,
  onCompleted,
  fetchImpl,
  retryDelaysMs,
  sleep,
  scheduleFrame,
  cancelFrame,
}: UseExperienceInterviewOptions): UseExperienceInterviewState {
  // 첫 렌더에서 한 번만 정합니다. 이 훅이 시작한 뒤로는 대화와 블록의 주인이 이 훅입니다.
  const [initial] = useState(() => initialAsk(restore));

  const [blockState, setBlockState] = useState<ExperienceBlockState>(
    () => restore?.blockState ?? emptyExperienceBlockState()
  );
  const blockStateRef = useRef(blockState);
  const setBlockStateBoth = useCallback((next: ExperienceBlockState) => {
    blockStateRef.current = next;
    setBlockState(next);
  }, []);

  const progressRef = useRef(initial.progress);

  const [turnsUsed, setTurnsUsed] = useState(initial.turnsUsed);
  const turnsUsedRef = useRef(initial.turnsUsed);

  // 저장된 상태만으로 더 물을 것이 없으면 이어가자마자 완료 대기입니다.
  const [isReadyToFinish, setIsReadyToFinish] = useState(initial.target === null);
  // 끝난 인터뷰를 다시 연 것도 이미 끝난 것입니다. 사용자가 끝냈던 것이므로 사유도 그대로 둡니다.
  const [endReason, setEndReason] = useState<ExperienceInterviewEndReason | null>(
    restore?.status === "completed" ? "user" : null
  );
  const [unreflectedTurnId, setUnreflectedTurnId] = useState<string | null>(null);
  const [unreflectedBlocks, setUnreflectedBlocks] = useState<readonly BlockKind[]>([]);
  const [unreflectedReason, setUnreflectedReason] = useState<BlockUpdateFetchErrorKind | null>(null);

  const [saveStatus, setSaveStatus] = useState<SavedTurnStatus | null>(null);
  const [unsavedTurnCount, setUnsavedTurnCount] = useState(0);
  /**
   * 저장된 블록 버전입니다. 저장에 성공할 때만 오릅니다. 이 값이 저장된 값과 다르면 다른 탭이 먼저
   * 저장한 것이므로 서버가 아무것도 쓰지 않습니다.
   */
  const savedBlockVersionRef = useRef(restore?.blockState.version ?? 0);
  /**
   * 아직 저장되지 않은 턴의 ID입니다. 다음 저장이 성공할 때 이 턴들을 함께 이어 붙입니다. 저장이
   * 한 번 밀려도 대화의 중간이 비지 않게 하는 장치입니다(이슈 #115 Approach).
   */
  const pendingTurnIdsRef = useRef<Set<string>>(new Set());

  // 지금까지의 턴 전체입니다. 블록 갱신 호출이 매번 다시 싣습니다(설계 5절).
  const turnsRef = useRef<BlockUpdateTurn[]>([]);
  // 이어가기로 받은 대화의 턴 수만큼 건너뛰고 셉니다. 0에서 시작하면 새 턴이 저장된 턴과 같은
  // 식별자를 받아, 밀린 턴을 저장할 때 엉뚱한 턴이 딸려 갑니다.
  const turnSeqRef = useRef(initial.turnsUsed);
  // 방금 답한 질문이 겨냥했던 대상입니다. 첫 질문은 `initialTarget`과 같은 값으로 시작합니다.
  const answeredTargetRef = useRef<NonNullable<InterviewQuestionTarget>>(initial.target ?? FIRST_TARGET);
  /**
   * `answeredTargetRef`를 화면이 읽을 수 있게 옮긴 값입니다. ref는 바뀌어도 렌더를 일으키지 않아
   * 블록 패널이 대상 전환을 놓칩니다. 갱신하는 곳이 한 곳뿐이라 두 값이 갈릴 여지는 없습니다.
   */
  const [currentTarget, setCurrentTarget] = useState<NonNullable<InterviewQuestionTarget>>(FIRST_TARGET);
  /** 블록 갱신 호출이 진행 중인지입니다. `activeRef`와 같은 사실을 화면 쪽으로 옮긴 것입니다. */
  const [isBlockUpdating, setIsBlockUpdating] = useState(false);
  const [updatingBlock, setUpdatingBlock] = useState<BlockKind | null>(null);
  /**
   * 방금 답한 질문을 보낸 시점의, 그 대상 요소 `askedCount`입니다(CodeRabbit PR #117). 첫 질문은
   * `progressRef`의 초깃값이 이미 `recordAsked`를 한 번 거친 값이라 1입니다. `recordResponse`가
   * "지금"의 `askedCount`가 아니라 이 값을 기준으로 `firstUnknownAskedCount`를 계산해야, 재처리로
   * 응답이 늦게 도착해도 그 사이 다른 질문이 올린 최신 `askedCount`를 자기 것으로 잘못 기록하지
   * 않습니다.
   */
  const answeredAskedCountRef = useRef(
    initial.target === null
      ? 0
      : initial.progress[initial.target.targetBlock].elements[initial.target.targetElement].askedCount
  );
  type PendingTurn = {
    turn: BlockUpdateTurn;
    target: NonNullable<InterviewQuestionTarget>;
    askedCountAtQuestion: number;
  };
  /**
   * 미반영 턴마다 재처리에 필요한 요청 맥락을 들고 있습니다. 턴 ID로 키를 둬 어느 턴이든 성공하면
   * 그 턴 자신의 항목만 지웁니다. 단일 슬롯이던 이전 구현은 어느 턴이 성공하든 슬롯을 통째로
   * 지워, t1 실패 뒤 t2만 성공해도 t1의 실패 기록과 재시도 대상이 사라졌습니다(구현검토
   * 2026-09-11 P1-2, R3).
   */
  const unreflectedRef = useRef<Map<string, PendingTurn>>(new Map());
  /** 지금 실제로 블록 갱신 네트워크 호출 중인 턴입니다. 완료(성공·실패 모두)되면 비웁니다. */
  const activeRef = useRef<PendingTurn | null>(null);
  const activeAbortRef = useRef<AbortController | null>(null);
  /**
   * `applyTurn` 호출을 전부 이 큐에 이어 붙여 한 번에 하나씩만 실행합니다. "현재 답변"(`onBeforeQuestion`)의
   * 블록 갱신과 "미반영 재처리"(`retryAllUnreflected`)의 블록 갱신은 서로 다른 시점에 독립적으로
   * 들어올 수 있는데, 예전에는 새 호출이 시작될 때마다 직전 호출을 무조건 abort했습니다. 그래서
   * 재처리가 시작되며 마침 진행 중이던 현재 답변의 호출을 끊으면, 그 답변은 abort 경로로 빠져
   * 미반영으로도 등록되지 못한 채 사라졌습니다(추가 재검증 2026-09-12, S3). 두 호출을 동시에
   * 실행하지 않고 항상 순서대로 기다리게 하면 애초에 서로를 끊을 일이 없어 이 경합 자체가
   * 사라집니다.
   */
  const applyQueueRef = useRef<Promise<void>>(Promise.resolve());
  /**
   * 큐에 들어가 있거나 실행 중인 턴입니다. 같은 턴을 두 번 등록하지 않으려고 둡니다.
   *
   * 직렬 큐는 동시 실행만 막습니다. 이미 들어간 중복 항목을 지우지는 않으므로 둘 다 실행되어 같은
   * 블록 갱신 요청이 두 번 나갑니다. `isBlockUpdating`으로는 막지 못합니다. 그 값은 큐에 넣는
   * 시점이 아니라 `runApplyTurn`이 자기 차례를 잡았을 때 참이 되기 때문입니다.
   *
   * 중복이 들어오는 경로는 둘입니다. 재처리 버튼 연타와, 재처리가 큐에 있는 동안의 종료입니다.
   * 종료 버튼은 `isBlockUpdating`으로 잠기지 않는데 `endInterview`도 `retryAllUnreflected`를
   * 부릅니다(PR #121 리뷰 2라운드, backlog 3번).
   *
   * 앞선 호출이 끝나면 지웁니다. 실패한 턴을 나중에 다시 재처리하는 길은 막지 않습니다.
   *
   * 값이 `Set`이 아니라 등록마다 새로 만드는 표식인 이유는 `endInterview` 때문입니다. 종료는 진행
   * 중이던 호출을 끊고 그 턴을 곧바로 다시 등록하는데, 끊긴 호출이 나중에 정리될 때 자기가 넣은
   * 항목이 아니라 새로 등록된 항목을 지우면 중복 판정에 구멍이 생깁니다. 자기 표식일 때만 지웁니다.
   */
  const queuedTurnsRef = useRef<Map<string, symbol>>(new Map());
  /**
   * 언마운트됐는지입니다. 이 훅이 사라진 뒤에도 `applyTurn`이나 `onBeforeQuestion`의 이어지는
   * 작업이 상태를 계속 바꾸는 것을 막습니다(구현검토 2026-09-11 P1-3, R5). `useInterviewStream`
   * 쪽의 이어지는 질문 요청은 그 훅 자신의 언마운트 가드가 막습니다.
   */
  const unmountedRef = useRef(false);
  useEffect(() => {
    // Strict Mode는 개발에서 effect를 setup → cleanup → setup으로 두 번 실행합니다. setup에서
    // 되돌리지 않으면 첫 cleanup이 남긴 `true`가 그대로 살아 있어, 마운트된 훅이 스스로를
    // 언마운트됐다고 판단합니다. 그러면 첫 답변부터 블록 갱신 요청을 아예 보내지 않습니다.
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      activeAbortRef.current?.abort();
    };
  }, []);

  /** `unreflectedRef`가 바뀐 뒤 노출용 상태를 맞춥니다. 가장 오래된(먼저 실패한) 턴을 보여 줍니다. */
  const syncUnreflectedTurnId = useCallback(() => {
    // `Map`이 넣은 순서를 지키므로 첫 항목이 먼저 실패한 턴입니다.
    const pending = [...unreflectedRef.current.values()];
    setUnreflectedTurnId(pending.length === 0 ? null : pending[0].turn.turnId);
    // 미반영 턴이 여럿이면 겨냥한 블록도 여럿입니다. 화면이 어느 카드에 오류를 그릴지 정하려면
    // 가장 오래된 턴 하나가 아니라 전부를 알아야 합니다.
    setUnreflectedBlocks(
      BLOCK_KINDS.filter((block) => pending.some((item) => item.target.targetBlock === block))
    );
  }, []);

  const optionsRef = useRef({ questionUrl, blockUpdateUrl, snapshot, interviewId, completeInterview, onCompleted, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame });
  useEffect(() => {
    optionsRef.current = { questionUrl, blockUpdateUrl, snapshot, interviewId, completeInterview, onCompleted, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame };
  });

  /** 한 번만 보냅니다. 사용자 종료와 열 턴 자동 종료가 겹쳐도 같은 표시를 두 번 쓰지 않습니다. */
  const completedRef = useRef(restore?.status === "completed");
  /**
   * 인터뷰를 끝난 것으로 표시합니다. 저장하지 않는 인터뷰에는 표시할 줄이 없으므로 아무 일도 하지
   * 않습니다. 실패는 삼킵니다. 종료 자체는 이미 화면에서 일어났고 사용자가 다시 할 수 있는 일이
   * 없습니다. 목록에 진행 중으로 남는 것이 이 실패의 전부입니다.
   *
   * **밀린 저장이 끝나기를 먼저 기다립니다**(PR #127 리뷰). 기다리지 않으면 완료 표시가 먼저 닿고,
   * 흐름이 그 응답을 받아 요약 화면으로 옮기면서 이 화면을 내립니다. 화면이 내려가면 언마운트가
   * 진행 중이던 저장을 끊으므로 마지막 답변이 저장되지 않은 채 끝난 인터뷰가 됩니다. 요약 화면도
   * 빠진 내용을 그립니다.
   *
   * 기다리는 것은 완료 표시와 화면 이동뿐입니다. 종료 자체(입력을 닫는 것)는 호출부가 이미 마쳤고,
   * 그 순서는 열 턴 자동 종료가 멈추지 않도록 PR #117에서 정한 것입니다. 저장이 끝내 실패해도
   * 완료로 표시하고 이동합니다. 사용자가 그만하겠다고 말한 조작을 저장 실패로 막지 않습니다.
   */
  const markCompleted = useCallback((pendingSaves?: Promise<unknown>) => {
    const id = optionsRef.current.interviewId;
    if (id === null || id === undefined || completedRef.current) return;
    completedRef.current = true;
    void (async () => {
      await pendingSaves?.catch(() => undefined);
      await optionsRef.current.completeInterview(id).catch(() => undefined);
      if (!unmountedRef.current) optionsRef.current.onCompleted?.();
    })();
  }, []);

  /**
   * 이번 요청에 실을 저장 대상입니다. 인터뷰 줄이 없으면 `undefined`이고, 그러면 서버가 저장하지
   * 않습니다.
   *
   * `progress`는 이번 답변을 반영하기 **전**의 값입니다. 반영에 필요한 반응은 모델 출력에서 서버가
   * 계산하므로 여기서는 알 수 없고, 서버가 받아서 반영합니다.
   */
  const buildSaveTarget = useCallback(
    (turnId: string, askedCountAtQuestion: number): ExperienceBlockSaveTarget | undefined => {
      const id = optionsRef.current.interviewId;
      if (id === null || id === undefined) return undefined;
      return {
        interviewId: id,
        expectedBlockVersion: savedBlockVersionRef.current,
        pendingTurnIds: [...pendingTurnIdsRef.current].filter((pending) => pending !== turnId),
        progress: progressRef.current,
        askedCountAtQuestion,
      };
    },
    []
  );

  /**
   * 저장 결과를 상태에 반영합니다. 성공하면 함께 보낸 밀린 턴까지 저장된 것이므로 그 표시를 지우고,
   * 실패하면 이번 턴을 밀린 턴으로 남깁니다.
   *
   * 인터뷰 줄이 아직 없어 저장하지 않은 턴도 밀린 턴으로 남깁니다. 확정할 때 만드는 인터뷰 줄은
   * 요청 하나를 기다려야 생기는데, 그 사이에 답변한 턴을 세지 않으면 줄이 생긴 뒤에도 그 턴만
   * 영영 저장되지 않습니다.
   *
   * 요청이 실패한 경우에도 이번 턴을 밀린 턴으로 남깁니다. 서버가 이미 저장한 뒤에 응답만 잃었다면
   * 다음 저장이 같은 턴을 한 번 더 보내지만, 그때는 저장된 블록 버전이 이미 올라 있어 조건부 갱신이
   * 걸러 냅니다. 대화가 겹쳐 저장되는 대신 `version_conflict`가 되어 화면이 다시 불러오기를 묻습니다.
   */
  const recordSaveResult = useCallback((turnId: string, sent: ExperienceBlockSaveTarget | undefined, status: BlockUpdateSaveStatus, savedVersion: number | null) => {
    if (status === "saved" && sent !== undefined) {
      if (savedVersion !== null) savedBlockVersionRef.current = savedVersion;
      for (const id of [...(sent.pendingTurnIds ?? []), turnId]) pendingTurnIdsRef.current.delete(id);
    } else {
      pendingTurnIdsRef.current.add(turnId);
    }
    // 저장 대상이 없어 저장하지 않은 것은 실패가 아닙니다. 안내 문구를 바꾸지 않습니다.
    if (status !== "skipped") setSaveStatus(status);
    setUnsavedTurnCount(pendingTurnIdsRef.current.size);
  }, []);

  /**
   * `answerTurnId`의 답변에 대한 블록 갱신을 실제로 실행합니다. 성공하면 상태와 진행을 갱신하고
   * 그 턴의 미반영 표시만 지웁니다(다른 턴이 여전히 미반영이면 그대로 남습니다). 실패하면 이전
   * 상태를 유지하고 그 턴을 미반영으로 표시합니다(설계 9절). 어느 쪽이든 던지지 않습니다. 호출부가
   * 그대로 다음 단계로 진행할 수 있어야 하기 때문입니다.
   *
   * 반드시 `applyQueueRef`를 통해서만 불려 한 번에 하나씩만 실행됩니다. 그래서 이 함수가 시작하는
   * 시점에는 다른 `runApplyTurn` 호출이 진행 중일 수 없고, abort는 오직 `endInterview`나 언마운트
   * 같은 명시적인 취소에서만 옵니다(다른 `applyTurn` 호출이 이 호출을 끊는 경우는 없습니다).
   *
   * 큐에서 자기 차례가 왔을 때 이미 언마운트돼 있으면 네트워크 호출 자체를 시작하지 않고 곧장
   * 미반영으로 남깁니다. 그래야 언마운트 뒤 큐에 남은 항목이 화면을 떠난 뒤에도 계속 네트워크
   * 요청을 내보내는 일이 없습니다(추가 재검증 2026-09-12, S4).
   */
  const runApplyTurn = useCallback(
    async (
      turn: BlockUpdateTurn,
      target: NonNullable<InterviewQuestionTarget>,
      askedCountAtQuestion: number
    ): Promise<{ readonly ok: boolean; readonly targetResponse: TargetResponse | null }> => {
      if (unmountedRef.current) {
        unreflectedRef.current.set(turn.turnId, { turn, target, askedCountAtQuestion });
        syncUnreflectedTurnId();
        return { ok: false, targetResponse: null };
      }
      const current = optionsRef.current;
      const controller = new AbortController();
      activeAbortRef.current = controller;
      activeRef.current = { turn, target, askedCountAtQuestion };
      setIsBlockUpdating(true);
      setUpdatingBlock(target.targetBlock);
      const save = buildSaveTarget(turn.turnId, askedCountAtQuestion);
      try {
        const result = await fetchBlockUpdate({
          url: current.blockUpdateUrl,
          snapshot: current.snapshot,
          history: turnsRef.current,
          state: blockStateRef.current,
          targetBlock: target.targetBlock,
          targetElement: target.targetElement,
          answerTurnId: turn.turnId,
          save,
          fetchImpl: current.fetchImpl,
          signal: controller.signal,
        });
        if (unmountedRef.current) return { ok: false, targetResponse: null };
        recordSaveResult(turn.turnId, save, result.save, result.state.version);
        setBlockStateBoth(result.state);
        progressRef.current = recordResponse(
          progressRef.current,
          target.targetBlock,
          target.targetElement,
          result.targetResponse,
          askedCountAtQuestion
        );
        unreflectedRef.current.delete(turn.turnId);
        syncUnreflectedTurnId();
        // 성공했으므로 앞선 실패의 이유를 지웁니다. 남겨 두면 이미 풀린 문제를 계속 알립니다.
        setUnreflectedReason(null);
        return { ok: true, targetResponse: result.targetResponse };
      } catch (error) {
        // 블록 갱신이 실패했으면 저장도 이뤄지지 않았습니다. 이번 턴을 밀린 턴으로 남겨 다음 저장이
        // 함께 보내게 합니다. 끊긴 호출(`AbortError`)도 같습니다.
        recordSaveResult(turn.turnId, save, "failed", null);
        if (error instanceof DOMException && error.name === "AbortError") return { ok: false, targetResponse: null };
        // 실패한 이유를 화면까지 올립니다. 분류를 모르는 오류는 서버 문제로 뭉뚱그리지 않고 `null`로
        // 둡니다. 화면이 일반 문구를 쓰는 편이, 틀린 원인을 단정하는 것보다 낫습니다.
        setUnreflectedReason(error instanceof BlockUpdateFetchError ? error.kind : null);
        // 갱신 실패만으로 같은 블록에 고정하지 않습니다. progress는 건드리지 않고 다음 단계에서
        // 이전 평가 그대로 이동 정책을 적용합니다.
        unreflectedRef.current.set(turn.turnId, { turn, target, askedCountAtQuestion });
        syncUnreflectedTurnId();
        return { ok: false, targetResponse: null };
      } finally {
        activeRef.current = null;
        activeAbortRef.current = null;
        setIsBlockUpdating(false);
        setUpdatingBlock(null);
      }
    },
    [buildSaveTarget, recordSaveResult, setBlockStateBoth, syncUnreflectedTurnId]
  );

  /**
   * `runApplyTurn`을 직렬 큐에 올립니다. "현재 답변"의 블록 갱신(`onBeforeQuestion`)과 "미반영
   * 재처리"(`retryAllUnreflected`)를 포함해 이 훅의 모든 블록 갱신 호출은 반드시 이 함수를 거쳐야
   * 동시 실행이 없다는 보장이 성립합니다.
   */
  const applyTurn = useCallback(
    (
      turn: BlockUpdateTurn,
      target: NonNullable<InterviewQuestionTarget>,
      askedCountAtQuestion: number
    ): Promise<{ readonly ok: boolean; readonly targetResponse: TargetResponse | null }> => {
      // 이미 등록된 턴은 다시 넣지 않습니다. 앞선 호출의 결과가 이 턴의 결과이므로 새 호출을 만들
      // 이유가 없습니다. 돌려주는 값은 재처리 경로에서만 쓰이지 않고 버려집니다.
      if (queuedTurnsRef.current.has(turn.turnId)) {
        return Promise.resolve({ ok: false, targetResponse: null });
      }
      const token = Symbol(turn.turnId);
      queuedTurnsRef.current.set(turn.turnId, token);
      const result = applyQueueRef.current.then(() => runApplyTurn(turn, target, askedCountAtQuestion));
      applyQueueRef.current = result
        .then(
          () => undefined,
          () => undefined
        )
        .then(() => {
          if (queuedTurnsRef.current.get(turn.turnId) === token) queuedTurnsRef.current.delete(turn.turnId);
        });
      return result;
    },
    [runApplyTurn]
  );

  /**
   * 미반영 턴을 전부 다시 시도합니다. 모두 같은 큐(`applyQueueRef`)를 거치므로 여기서 동시에
   * 걸어도 실제 실행은 걸린 순서대로 하나씩 이뤄지고, 각 재처리가 직전 재처리로 갱신된 최신
   * 상태를 보고 판단합니다. 사용자 종료·열 턴 자동 종료가 공유하는 정리 경로입니다(구현검토
   * 2026-09-11 P1-2).
   */
  const retryAllUnreflected = useCallback(async () => {
    const pending = [...unreflectedRef.current.values()];
    await Promise.all(pending.map((item) => applyTurn(item.turn, item.target, item.askedCountAtQuestion)));
  }, [applyTurn]);

  /**
   * `useInterviewStream`의 접합점입니다. 답변 하나가 확정될 때마다 불려, 블록 갱신 → 다음 대상
   * 선택까지 마친 뒤 다음 질문의 대상을 돌려줍니다. `"stop"`·`"ready_to_finish"`이면 그 훅이
   * 알아서 처리합니다(질문·답변 교대 계약을 지키는 것은 호출부 책임입니다, 구현검토 2026-09-11
   * P1-4 재검증).
   */
  /**
   * 반영은 끝났는데 저장만 밀린 턴을 다시 저장합니다. 모델을 부르지 않고 블록 상태도 그대로 둡니다.
   *
   * 반영까지 밀린 턴(`unreflectedRef`)은 여기서 보내지 않습니다. 그 턴은 블록 갱신을 다시 걸 때 그
   * 요청이 저장까지 함께 하므로, 여기서도 보내면 같은 질문과 답변이 저장된 대화에 두 번 들어갑니다.
   */
  const runRetrySave = useCallback(async () => {
    const current = optionsRef.current;
    const interviewId = current.interviewId;
    if (interviewId === null || interviewId === undefined) return;
    const known = new Set(turnsRef.current.map((turn) => turn.turnId));
    const ids = [...pendingTurnIdsRef.current].filter(
      (turnId) => known.has(turnId) && !unreflectedRef.current.has(turnId)
    );
    if (ids.length === 0) return;
    const savedVersion = blockStateRef.current.version;
    try {
      const status = await fetchSaveOnly({
        url: current.blockUpdateUrl,
        snapshot: current.snapshot,
        history: turnsRef.current,
        state: blockStateRef.current,
        save: {
          interviewId,
          expectedBlockVersion: savedBlockVersionRef.current,
          pendingTurnIds: ids,
          // 반영이 이미 끝난 값입니다. 서버는 이 값을 그대로 저장합니다.
          progress: progressRef.current,
        },
        fetchImpl: current.fetchImpl,
      });
      if (unmountedRef.current) return;
      if (status === "saved") {
        savedBlockVersionRef.current = savedVersion;
        for (const turnId of ids) pendingTurnIdsRef.current.delete(turnId);
      }
      if (status !== "skipped") setSaveStatus(status);
      setUnsavedTurnCount(pendingTurnIdsRef.current.size);
    } catch {
      if (!unmountedRef.current) setSaveStatus("failed");
    }
  }, []);

  /**
   * 종료 전에 밀린 것을 모두 밀어 넣습니다. 반영이 밀린 턴을 먼저 다시 걸고(그 요청이 저장까지
   * 합니다), 그다음에 저장만 밀린 턴을 모델 없이 이어 붙입니다.
   *
   * 어느 쪽이 실패해도 던지지 않습니다. 이 값을 기다리는 쪽은 완료 표시이고, 저장 실패가 종료를
   * 막지 않아야 합니다(이슈 #115 Constraint).
   */
  const flushPendingSaves = useCallback(async () => {
    await retryAllUnreflected().catch(() => undefined);
    await runRetrySave().catch(() => undefined);
  }, [retryAllUnreflected, runRetrySave]);

  const onBeforeQuestion = useCallback(
    async ({ history }: { history: readonly InterviewHistoryMessage[] }): Promise<InterviewQuestionOutcome> => {
      const question = history.length >= 2 ? history[history.length - 2].text : "";
      const answer = history[history.length - 1].text;
      // 완료 대기 안내(`READY_TO_FINISH_PROMPT`)에 대한 보충 답변입니다. 이 안내는 모델이 만든
      // 질문이 아니라 이 훅이 질문·답변 교대 계약을 지키려고 끼워 넣은 고정 문구이므로(설계 6-1절
      // "안내 메시지는 턴에 포함하지 않는다"), 이 답변은 턴으로 세지 않습니다. 세면 안내가 반복될
      // 때마다 턴 상한이 앞당겨져 실제 질문 횟수와 사용 턴 수가 어긋납니다(추가 재검증 2026-09-12).
      const isSupplementaryAnswer = question === READY_TO_FINISH_PROMPT;
      const turnId = `t${++turnSeqRef.current}`;
      const turn: BlockUpdateTurn = { turnId, question, answer };
      turnsRef.current = [...turnsRef.current, turn];

      const outcome = await applyTurn(turn, answeredTargetRef.current, answeredAskedCountRef.current);
      // 대기하는 동안 언마운트됐으면 다음 대상 계산도, 그에 딸린 상태 갱신도 하지 않습니다(구현검토
      // 2026-09-11 P1-3, R5). 호출부(`useInterviewStream`)의 이어지는 질문 요청은 그쪽 자신의
      // 언마운트 가드가 막습니다.
      if (unmountedRef.current) return { kind: "stop" };
      // targetBlock 밖 블록의 미해소 충돌도 함께 알립니다(다음 질문이 어느 블록을 겨냥하든, 그
      // 충돌은 사용자 진술과 근거가 어긋난 지점이라는 사실 자체가 바뀌지 않으므로).
      const lastOutcome = buildLastOutcome(outcome, blockStateRef.current.conflicts);

      const nextTurnsUsed = isSupplementaryAnswer ? turnsUsedRef.current : turnsUsedRef.current + 1;
      if (!isSupplementaryAnswer) {
        turnsUsedRef.current = nextTurnsUsed;
        setTurnsUsed(nextTurnsUsed);
      }

      // 열 턴 자동 종료입니다. 모델의 sufficient 판정에는 종료 권한이 없고, 상한 도달만 자동
      // 종료를 일으킵니다(설계 3절 Approach 3). 상한 도달은 완료 대기 안내 없이 그대로 멈춥니다.
      // 보충 답변은 턴이 아니므로 이 판정에도 들어가지 않습니다.
      if (!isSupplementaryAnswer && nextTurnsUsed >= INTERVIEW_MAX_TURNS) {
        setEndReason("turn_limit");
        return { kind: "stop" };
      }

      const next = selectNextTarget({
        evaluation: blockStateRef.current.evaluation,
        progress: progressRef.current,
        turnsUsed: nextTurnsUsed,
        maxTurns: INTERVIEW_MAX_TURNS,
        isEnded: false,
        lastTarget: { block: answeredTargetRef.current.targetBlock, element: answeredTargetRef.current.targetElement },
      });
      if (next.kind === "done") {
        setIsReadyToFinish(true);
        return { kind: "ready_to_finish" };
      }

      // 완료 대기 상태에서 받은 보충 답변(설계 6-3절)이 다시 물을 거리를 만들 수 있습니다. 값이
      // 이미 false여도 다시 불러 안전합니다.
      setIsReadyToFinish(false);
      progressRef.current = recordAsked(progressRef.current, next.block, next.element);
      const target: NonNullable<InterviewQuestionTarget> = { targetBlock: next.block, targetElement: next.element };
      answeredTargetRef.current = target;
      setCurrentTarget(target);
      answeredAskedCountRef.current = progressRef.current[next.block].elements[next.element].askedCount;
      return { kind: "ask", target, lastOutcome };
    },
    [applyTurn]
  );

  const inner = useInterviewStream({
    url: questionUrl,
    snapshot,
    fetchImpl,
    retryDelaysMs,
    sleep,
    scheduleFrame,
    cancelFrame,
    initialTarget: initial.target,
    initialMessages: restore?.history,
    initiallyEnded: restore?.status === "completed",
    // 더 물을 것이 없는 상태로 이어가면 질문을 요청하지 않습니다.
    autoStart: initial.target !== null,
    onBeforeQuestion,
  });

  // 상한 도달로 정한 종료 사유를 실제 종료로 잇습니다. 훅 스스로 `endInterview`를 부르는 유일한
  // 자리입니다. 사용자 종료는 아래 `endInterview` 래퍼가 직접 부릅니다.
  //
  // 종료와 정리 완료를 구분합니다(설계 9절). 정리 재시도가 끝나기를 기다린 뒤 종료하면, 정리
  // 재시도가 쓰는 `fetchBlockUpdate`에 timeout이 없어(취소는 언마운트·명시적 종료뿐입니다) 응답이
  // 계속 pending일 때 열 턴 자동 종료 자체가 멈춥니다(CodeRabbit PR #117). 먼저 끝내고 정리
  // 재시도는 백그라운드로 흘려보냅니다. 이전에는 `inner.endInterview()`를 아예 부르지 않아, 마지막
  // 턴의 블록 갱신이 실패한 채로 남아도 재처리 자체를 시도하지 않았습니다(구현검토 2026-09-11 P1-2,
  // R9). 재처리 자체는 이 순서에서도 그대로 일어납니다.
  //
  // `inner` 전체가 아니라 실제로 읽는 필드만 의존성에 둡니다. `inner`는 `useInterviewStream`이 매
  // 렌더 새로 만드는 객체라, 전체를 넣으면 이 효과가 매 렌더 다시 실행됩니다. `isEnded`와
  // `endInterview`는 그 훅 내부에서 각각 상태와 안정된 `useCallback`으로 나오므로 필요한 시점에만
  // 바뀝니다.
  useEffect(() => {
    if (endReason !== "turn_limit" || inner.isEnded) return;
    inner.endInterview();
    // 정리는 곧바로 시작하고, 완료 표시만 그 결과를 기다립니다(PR #127 리뷰).
    markCompleted(flushPendingSaves());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.isEnded, inner.endInterview, markCompleted, flushPendingSaves]);

  const retryUnreflectedBlockUpdate = useCallback(() => {
    void retryAllUnreflected();
  }, [retryAllUnreflected]);

  /**
   * 두 갈래를 한 번에 처리합니다. 화면의 버튼은 하나이고, 사용자가 "저장되지 않았다"고 본 것에는 두
   * 종류가 섞여 있습니다.
   *
   * 큐에 올리기 전에 반영 재시도를 먼저 기다립니다. 큐 안에서 기다리면 그 재시도가 같은 큐를 기다리게
   * 되어 서로 풀리지 않습니다.
   */
  const retrySave = useCallback(() => {
    void (async () => {
      await retryAllUnreflected();
      const result = applyQueueRef.current.then(() => runRetrySave());
      applyQueueRef.current = result.then(
        () => undefined,
        () => undefined
      );
      await result;
    })();
  }, [retryAllUnreflected, runRetrySave]);

  /**
   * 사용자 종료입니다. 진행 중이던 블록 갱신 호출을 끊어 화면 이탈이 이 작업 전체를 끊는다는
   * 계약을 지킵니다(설계 Approach 4). 끊긴 호출이 겨냥하던 턴은 abort 자체가 아니라 여기서
   * `activeRef`를 직접 읽어 미반영으로 등록합니다. `applyTurn`의 catch가 비동기로(다음
   * 마이크로태스크에) 도는 것과 달리 이 값은 동기로 최신이라, 등록을 놓치는 경합이 없습니다(구현검토
   * 2026-09-11 P1-2, R6). 종료와 정리 완료는 구분합니다(설계 9절): 미반영 턴이 있으면 그 자리에서
   * 한 번 더 반영을 시도하되, 이 호출은 턴으로 세지 않고 실패해도 종료 자체는 그대로 진행합니다.
   *
   * 이 abort로 끊긴 호출은 `runApplyTurn`의 catch에서 AbortError로 잡혀 조용히 끝나지만, 그
   * 완료를 기다리지 않고 바로 `retryAllUnreflected`를 걸어도 됩니다. 모든 호출이 같은
   * `applyQueueRef`를 거치므로 이 재시도는 끊긴 호출이 마저 정리될 때까지 큐 안에서 자연히
   * 대기했다가 실행됩니다.
   */
  // 위 효과와 같은 이유로 `inner.endInterview`만 둡니다.
  const endInterview = useCallback(() => {
    if (endReason === null) setEndReason("user");
    const interrupted = activeRef.current;
    activeAbortRef.current?.abort();
    if (interrupted !== null) {
      unreflectedRef.current.set(interrupted.turn.turnId, interrupted);
      // 끊은 호출은 더 이상 진행 중이 아니므로 중복 판정에서 뺍니다. 이 줄이 없으면 바로 아래의
      // 재처리가 중복으로 걸러져, 구현검토 P1-2(R6)가 요구한 "끊고 한 번 더 반영"이 사라집니다.
      queuedTurnsRef.current.delete(interrupted.turn.turnId);
      syncUnreflectedTurnId();
    }
    // 정리는 곧바로 시작합니다. 저장하지 않는 인터뷰에도 미반영 재처리는 그대로 일어나야 합니다
    // (구현검토 2026-09-11 P1-2, R9). 완료 표시만 그 결과를 기다립니다(PR #127 리뷰).
    markCompleted(flushPendingSaves());
    inner.endInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.endInterview, markCompleted, flushPendingSaves, syncUnreflectedTurnId]);

  return {
    ...inner,
    endInterview,
    blockState,
    turnsUsed,
    maxTurns: INTERVIEW_MAX_TURNS,
    isReadyToFinish,
    endReason,
    currentTarget,
    isBlockUpdating,
    updatingBlock,
    unreflectedTurnId,
    unreflectedBlocks,
    unreflectedReason,
    retryUnreflectedBlockUpdate,
    saveStatus,
    unsavedTurnCount,
    retrySave,
  };
}

export { BlockUpdateFetchError };

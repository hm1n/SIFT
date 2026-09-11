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
  useInterviewStream,
  type InterviewQuestionContinuation,
  type InterviewQuestionTarget,
  type InterviewStreamState,
} from "@/features/interview/use-interview-stream";
import { BlockUpdateFetchError, fetchBlockUpdate } from "./client";
import { emptyInterviewProgress, recordAsked, recordResponse, selectNextTarget } from "./progress";
import { emptyExperienceBlockState, type ExperienceBlockState, type TargetResponse } from "./types";

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

export interface UseExperienceInterviewOptions {
  questionUrl: string;
  blockUpdateUrl: string;
  snapshot: ExperienceEvidenceSnapshot;
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
  /** 블록 갱신이 실패해 반영되지 않은 턴의 ID입니다. 없으면 `null`입니다. */
  unreflectedTurnId: string | null;
  /** 미반영 턴의 블록 갱신을 다시 시도합니다. 미반영 턴이 없으면 아무 일도 하지 않습니다. */
  retryUnreflectedBlockUpdate: () => void;
}

export function useExperienceInterview({
  questionUrl,
  blockUpdateUrl,
  snapshot,
  fetchImpl,
  retryDelaysMs,
  sleep,
  scheduleFrame,
  cancelFrame,
}: UseExperienceInterviewOptions): UseExperienceInterviewState {
  const [blockState, setBlockState] = useState<ExperienceBlockState>(emptyExperienceBlockState());
  const blockStateRef = useRef(blockState);
  const setBlockStateBoth = useCallback((next: ExperienceBlockState) => {
    blockStateRef.current = next;
    setBlockState(next);
  }, []);

  const progressRef = useRef(recordAsked(emptyInterviewProgress(), FIRST_TARGET.targetBlock, FIRST_TARGET.targetElement));

  const [turnsUsed, setTurnsUsed] = useState(0);
  const turnsUsedRef = useRef(0);

  const [isReadyToFinish, setIsReadyToFinish] = useState(false);
  const [endReason, setEndReason] = useState<ExperienceInterviewEndReason | null>(null);
  const [unreflectedTurnId, setUnreflectedTurnId] = useState<string | null>(null);

  // 지금까지의 턴 전체입니다. 블록 갱신 호출이 매번 다시 싣습니다(설계 5절).
  const turnsRef = useRef<BlockUpdateTurn[]>([]);
  const turnSeqRef = useRef(0);
  // 방금 답한 질문이 겨냥했던 대상입니다. 첫 질문은 `initialTarget`과 같은 값으로 시작합니다.
  const answeredTargetRef = useRef<NonNullable<InterviewQuestionTarget>>(FIRST_TARGET);
  type PendingTurn = { turn: BlockUpdateTurn; target: NonNullable<InterviewQuestionTarget> };
  /**
   * 미반영 턴마다 재처리에 필요한 요청 맥락을 들고 있습니다. 턴 ID로 키를 둬 어느 턴이든 성공하면
   * 그 턴 자신의 항목만 지웁니다. 단일 슬롯이던 이전 구현은 어느 턴이 성공하든 슬롯을 통째로
   * 지워, t1 실패 뒤 t2만 성공해도 t1의 실패 기록과 재시도 대상이 사라졌습니다(구현검토
   * 2026-09-11 P1-2, R3).
   */
  const unreflectedRef = useRef<Map<string, PendingTurn>>(new Map());
  /**
   * 지금 실행 중인 블록 갱신 호출의 턴입니다. 완료(성공·실패 모두)되면 비웁니다. `callSeq`는 이
   * 항목을 남긴 `applyTurn` 호출 자신의 번호입니다. 같은 턴을 재시도하면 turnId가 같으므로,
   * turnId만으로 "이 항목이 내가 넣은 것"을 판정하면 아직 정리 중(catch/finally)인 이전 시도가
   * 방금 시작한 재시도의 항목을 지워 버릴 수 있습니다. 번호로 자기 항목인지 확인해야 이 경합을
   * 막습니다.
   */
  const inFlightRef = useRef<(PendingTurn & { readonly callSeq: number }) | null>(null);
  const callSeqRef = useRef(0);
  const blockUpdateAbortRef = useRef<AbortController | null>(null);
  /**
   * 언마운트됐는지입니다. 이 훅이 사라진 뒤에도 `applyTurn`이나 `onBeforeQuestion`의 이어지는
   * 작업이 상태를 계속 바꾸는 것을 막습니다(구현검토 2026-09-11 P1-3, R5). `useInterviewStream`
   * 쪽의 이어지는 질문 요청은 그 훅 자신의 언마운트 가드가 막습니다.
   */
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      blockUpdateAbortRef.current?.abort();
    };
  }, []);

  /** `unreflectedRef`가 바뀐 뒤 노출용 상태를 맞춥니다. 가장 오래된(먼저 실패한) 턴을 보여 줍니다. */
  const syncUnreflectedTurnId = useCallback(() => {
    const oldest = unreflectedRef.current.keys().next();
    setUnreflectedTurnId(oldest.done ? null : oldest.value);
  }, []);

  const optionsRef = useRef({ questionUrl, blockUpdateUrl, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame });
  useEffect(() => {
    optionsRef.current = { questionUrl, blockUpdateUrl, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame };
  });

  /**
   * `answerTurnId`의 답변에 대한 블록 갱신을 부릅니다. 성공하면 상태와 진행을 갱신하고 그 턴의
   * 미반영 표시만 지웁니다(다른 턴이 여전히 미반영이면 그대로 남습니다). 실패하면 이전 상태를
   * 유지하고 그 턴을 미반영으로 표시합니다(설계 9절). 어느 쪽이든 던지지 않습니다. 호출부가
   * 그대로 다음 단계로 진행할 수 있어야 하기 때문입니다.
   *
   * 이 호출이 최신 요청을 abort한 뒤 그 abort 때문에 스스로도 취소되면(다른 `applyTurn` 호출이
   * 겹쳐 들어온 경우) 아무 기록도 남기지 않고 조용히 돌아갑니다. 그 턴을 미반영으로 기록할지는
   * 취소한 쪽(주로 `endInterview`)이 `inFlightRef`를 보고 직접 판단합니다. 그래야 "종료가 끊은
   * 진행 중이던 호출"과 "이 함수 자신이 이전 호출을 끊은 것"을 헷갈리지 않습니다.
   *
   * 응답이 도착하면(성공이든 실패든) `callSeq`가 그 시점의 "가장 최근에 시작한 호출"과 같은지
   * 봅니다. 다르면 그 사이 다른 호출(주로 겹쳐 들어온 재처리)이 이미 새로 시작된 것이므로 이
   * 응답은 낡은 것으로 보고 아무것도 반영하지 않습니다. 응답 도착 순서가 요청 순서와 같다고
   * 보장할 수 없어(느린 재처리 응답이 그 뒤에 시작한 다음 턴의 응답보다 늦게 와도), 버전을 그냥
   * 덮어쓰면 최신 상태가 옛 상태로 되돌아갈 수 있습니다(구현검토 2026-09-11 P1-3, R4).
   */
  const applyTurn = useCallback(
    async (
      turn: BlockUpdateTurn,
      target: NonNullable<InterviewQuestionTarget>
    ): Promise<{ readonly ok: boolean; readonly targetResponse: TargetResponse | null }> => {
      const current = optionsRef.current;
      blockUpdateAbortRef.current?.abort();
      const controller = new AbortController();
      blockUpdateAbortRef.current = controller;
      const callSeq = ++callSeqRef.current;
      inFlightRef.current = { turn, target, callSeq };
      try {
        const result = await fetchBlockUpdate({
          url: current.blockUpdateUrl,
          snapshot: current.snapshot,
          history: turnsRef.current,
          state: blockStateRef.current,
          targetBlock: target.targetBlock,
          targetElement: target.targetElement,
          answerTurnId: turn.turnId,
          fetchImpl: current.fetchImpl,
          signal: controller.signal,
        });
        if (unmountedRef.current || callSeqRef.current !== callSeq) return { ok: false, targetResponse: null };
        setBlockStateBoth(result.state);
        progressRef.current = recordResponse(progressRef.current, target.targetBlock, target.targetElement, result.targetResponse);
        unreflectedRef.current.delete(turn.turnId);
        syncUnreflectedTurnId();
        return { ok: true, targetResponse: result.targetResponse };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return { ok: false, targetResponse: null };
        if (unmountedRef.current || callSeqRef.current !== callSeq) return { ok: false, targetResponse: null };
        // 갱신 실패만으로 같은 블록에 고정하지 않습니다. progress는 건드리지 않고 다음 단계에서
        // 이전 평가 그대로 이동 정책을 적용합니다.
        unreflectedRef.current.set(turn.turnId, { turn, target });
        syncUnreflectedTurnId();
        return { ok: false, targetResponse: null };
      } finally {
        if (inFlightRef.current?.callSeq === callSeq) inFlightRef.current = null;
      }
    },
    [setBlockStateBoth, syncUnreflectedTurnId]
  );

  /**
   * 미반영 턴을 전부(오래된 순서로) 다시 시도합니다. 순서대로 기다려 가며 부르므로 각 재처리가
   * 직전 재처리로 갱신된 최신 상태를 보고 판단합니다. 사용자 종료·열 턴 자동 종료가 공유하는
   * 정리 경로입니다(구현검토 2026-09-11 P1-2).
   */
  const retryAllUnreflected = useCallback(async () => {
    for (const pending of [...unreflectedRef.current.values()]) {
      await applyTurn(pending.turn, pending.target);
    }
  }, [applyTurn]);

  /**
   * `useInterviewStream`의 접합점입니다. 답변 하나가 확정될 때마다 불려, 블록 갱신 → 다음 대상
   * 선택까지 마친 뒤 다음 질문의 대상을 돌려줍니다. `null`이면 질문을 요청하지 않습니다.
   */
  const onBeforeQuestion = useCallback(
    async ({ history }: { history: readonly InterviewHistoryMessage[] }): Promise<InterviewQuestionContinuation | null> => {
      const question = history.length >= 2 ? history[history.length - 2].text : "";
      const answer = history[history.length - 1].text;
      const turnId = `t${++turnSeqRef.current}`;
      const turn: BlockUpdateTurn = { turnId, question, answer };
      turnsRef.current = [...turnsRef.current, turn];

      const outcome = await applyTurn(turn, answeredTargetRef.current);
      // 대기하는 동안 언마운트됐으면 다음 대상 계산도, 그에 딸린 상태 갱신도 하지 않습니다(구현검토
      // 2026-09-11 P1-3, R5). 호출부(`useInterviewStream`)의 이어지는 질문 요청은 그쪽 자신의
      // 언마운트 가드가 막습니다.
      if (unmountedRef.current) return null;
      // targetBlock 밖 블록의 미해소 충돌도 함께 알립니다(다음 질문이 어느 블록을 겨냥하든, 그
      // 충돌은 사용자 진술과 근거가 어긋난 지점이라는 사실 자체가 바뀌지 않으므로).
      const lastOutcome = buildLastOutcome(outcome, blockStateRef.current.conflicts);

      const nextTurnsUsed = turnsUsedRef.current + 1;
      turnsUsedRef.current = nextTurnsUsed;
      setTurnsUsed(nextTurnsUsed);

      // 열 턴 자동 종료입니다. 모델의 sufficient 판정에는 종료 권한이 없고, 상한 도달만 자동
      // 종료를 일으킵니다(설계 3절 Approach 3).
      if (nextTurnsUsed >= INTERVIEW_MAX_TURNS) {
        setEndReason("turn_limit");
        return null;
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
        return null;
      }

      // 완료 대기 상태에서 받은 보충 답변(설계 6-3절)이 다시 물을 거리를 만들 수 있습니다. 값이
      // 이미 false여도 다시 불러 안전합니다.
      setIsReadyToFinish(false);
      progressRef.current = recordAsked(progressRef.current, next.block, next.element);
      const target: NonNullable<InterviewQuestionTarget> = { targetBlock: next.block, targetElement: next.element };
      answeredTargetRef.current = target;
      return { target, lastOutcome };
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
    initialTarget: FIRST_TARGET,
    onBeforeQuestion,
  });

  // 상한 도달로 정한 종료 사유를 실제 종료로 잇습니다. 훅 스스로 `endInterview`를 부르는 유일한
  // 자리입니다. 사용자 종료는 아래 `endInterview` 래퍼가 직접 부릅니다.
  //
  // 사용자 종료와 같은 정리 경로(`retryAllUnreflected`)를 거친 뒤에 끝냅니다. 이전에는
  // `inner.endInterview()`를 곧장 불러, 마지막 턴의 블록 갱신이 실패한 채로 남아도 재처리를
  // 시도하지 않고 그대로 종료했습니다(구현검토 2026-09-11 P1-2, R9).
  //
  // `inner` 전체가 아니라 실제로 읽는 필드만 의존성에 둡니다. `inner`는 `useInterviewStream`이 매
  // 렌더 새로 만드는 객체라, 전체를 넣으면 이 효과가 매 렌더 다시 실행됩니다. `isEnded`와
  // `endInterview`는 그 훅 내부에서 각각 상태와 안정된 `useCallback`으로 나오므로 필요한 시점에만
  // 바뀝니다.
  useEffect(() => {
    if (endReason !== "turn_limit" || inner.isEnded) return;
    void retryAllUnreflected().then(() => inner.endInterview());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.isEnded, inner.endInterview, retryAllUnreflected]);

  const retryUnreflectedBlockUpdate = useCallback(() => {
    void retryAllUnreflected();
  }, [retryAllUnreflected]);

  /**
   * 사용자 종료입니다. 진행 중이던 블록 갱신 호출을 끊어 화면 이탈이 이 작업 전체를 끊는다는
   * 계약을 지킵니다(설계 Approach 4). 끊긴 호출이 겨냥하던 턴은 abort 자체가 아니라 여기서
   * `inFlightRef`를 직접 읽어 미반영으로 등록합니다. `applyTurn`의 catch가 비동기로(다음
   * 마이크로태스크에) 도는 것과 달리 이 값은 동기로 최신이라, 등록을 놓치는 경합이 없습니다(구현검토
   * 2026-09-11 P1-2, R6). 종료와 정리 완료는 구분합니다(설계 9절): 미반영 턴이 있으면 그 자리에서
   * 한 번 더 반영을 시도하되, 이 호출은 턴으로 세지 않고 실패해도 종료 자체는 그대로 진행합니다.
   */
  // 위 효과와 같은 이유로 `inner.endInterview`만 둡니다.
  const endInterview = useCallback(() => {
    if (endReason === null) setEndReason("user");
    const interrupted = inFlightRef.current;
    blockUpdateAbortRef.current?.abort();
    if (interrupted !== null) {
      unreflectedRef.current.set(interrupted.turn.turnId, interrupted);
      syncUnreflectedTurnId();
    }
    void retryAllUnreflected();
    inner.endInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.endInterview, retryAllUnreflected, syncUnreflectedTurnId]);

  return {
    ...inner,
    endInterview,
    blockState,
    turnsUsed,
    maxTurns: INTERVIEW_MAX_TURNS,
    isReadyToFinish,
    endReason,
    unreflectedTurnId,
    retryUnreflectedBlockUpdate,
  };
}

export { BlockUpdateFetchError };

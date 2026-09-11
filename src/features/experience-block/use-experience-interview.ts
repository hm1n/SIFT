"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ExperienceEvidenceSnapshot } from "@/features/experience-candidates/types";
import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import { INTERVIEW_MAX_TURNS, type InterviewHistoryMessage } from "@/features/interview/history";
import {
  useInterviewStream,
  type InterviewQuestionTarget,
  type InterviewStreamState,
} from "@/features/interview/use-interview-stream";
import { BlockUpdateFetchError, fetchBlockUpdate } from "./client";
import { emptyInterviewProgress, recordAsked, recordResponse, selectNextTarget } from "./progress";
import { emptyExperienceBlockState, type ExperienceBlockState } from "./types";

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
  // 미반영 턴의 재처리에 필요한 요청 맥락을 들고 있습니다.
  const unreflectedRef = useRef<{ turn: BlockUpdateTurn; target: NonNullable<InterviewQuestionTarget> } | null>(null);
  const blockUpdateAbortRef = useRef<AbortController | null>(null);

  const optionsRef = useRef({ questionUrl, blockUpdateUrl, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame });
  useEffect(() => {
    optionsRef.current = { questionUrl, blockUpdateUrl, snapshot, fetchImpl, retryDelaysMs, sleep, scheduleFrame, cancelFrame };
  });

  /**
   * `answerTurnId`의 답변에 대한 블록 갱신을 부릅니다. 성공하면 상태와 진행을 갱신하고 미반영
   * 표시를 지웁니다. 실패하면 이전 상태를 유지하고 미반영으로 표시합니다(설계 9절). 어느 쪽이든
   * 던지지 않습니다. 호출부가 그대로 다음 단계로 진행할 수 있어야 하기 때문입니다.
   */
  const applyTurn = useCallback(
    async (turn: BlockUpdateTurn, target: NonNullable<InterviewQuestionTarget>): Promise<void> => {
      const current = optionsRef.current;
      blockUpdateAbortRef.current?.abort();
      const controller = new AbortController();
      blockUpdateAbortRef.current = controller;
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
        setBlockStateBoth(result.state);
        progressRef.current = recordResponse(progressRef.current, target.targetBlock, target.targetElement, result.targetResponse);
        unreflectedRef.current = null;
        setUnreflectedTurnId(null);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // 갱신 실패만으로 같은 블록에 고정하지 않습니다. progress는 건드리지 않고 다음 단계에서
        // 이전 평가 그대로 이동 정책을 적용합니다.
        unreflectedRef.current = { turn, target };
        setUnreflectedTurnId(turn.turnId);
      }
    },
    [setBlockStateBoth]
  );

  /**
   * `useInterviewStream`의 접합점입니다. 답변 하나가 확정될 때마다 불려, 블록 갱신 → 다음 대상
   * 선택까지 마친 뒤 다음 질문의 대상을 돌려줍니다. `null`이면 질문을 요청하지 않습니다.
   */
  const onBeforeQuestion = useCallback(
    async ({ history }: { history: readonly InterviewHistoryMessage[] }) => {
      const question = history.length >= 2 ? history[history.length - 2].text : "";
      const answer = history[history.length - 1].text;
      const turnId = `t${++turnSeqRef.current}`;
      const turn: BlockUpdateTurn = { turnId, question, answer };
      turnsRef.current = [...turnsRef.current, turn];

      await applyTurn(turn, answeredTargetRef.current);

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

      progressRef.current = recordAsked(progressRef.current, next.block, next.element);
      const target: NonNullable<InterviewQuestionTarget> = { targetBlock: next.block, targetElement: next.element };
      answeredTargetRef.current = target;
      return target;
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
  // `inner` 전체가 아니라 실제로 읽는 필드만 의존성에 둡니다. `inner`는 `useInterviewStream`이 매
  // 렌더 새로 만드는 객체라, 전체를 넣으면 이 효과가 매 렌더 다시 실행됩니다. `isEnded`와
  // `endInterview`는 그 훅 내부에서 각각 상태와 안정된 `useCallback`으로 나오므로 필요한 시점에만
  // 바뀝니다.
  useEffect(() => {
    if (endReason === "turn_limit" && !inner.isEnded) inner.endInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.isEnded, inner.endInterview]);

  const retryUnreflectedBlockUpdate = useCallback(() => {
    const pending = unreflectedRef.current;
    if (pending === null) return;
    void applyTurn(pending.turn, pending.target);
  }, [applyTurn]);

  /**
   * 사용자 종료입니다. 진행 중이던 블록 갱신 호출을 끊어 화면 이탈이 이 작업 전체를 끊는다는
   * 계약을 지킵니다(설계 Approach 4). 종료와 정리 완료는 구분합니다(설계 9절): 마지막 턴이
   * 미반영이면 그 자리에서 한 번 더 반영을 시도하되, 이 호출은 턴으로 세지 않고 실패해도 종료
   * 자체는 그대로 진행합니다.
   */
  // 위 효과와 같은 이유로 `inner.endInterview`만 둡니다.
  const endInterview = useCallback(() => {
    if (endReason === null) setEndReason("user");
    blockUpdateAbortRef.current?.abort();
    const pending = unreflectedRef.current;
    if (pending !== null) void applyTurn(pending.turn, pending.target);
    inner.endInterview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyTurn, endReason, inner.endInterview]);

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

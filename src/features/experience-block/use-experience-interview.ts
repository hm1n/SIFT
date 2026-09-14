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
  /**
   * 방금 답한 질문을 보낸 시점의, 그 대상 요소 `askedCount`입니다(CodeRabbit PR #117). 첫 질문은
   * `progressRef`의 초깃값이 이미 `recordAsked`를 한 번 거친 값이라 1입니다. `recordResponse`가
   * "지금"의 `askedCount`가 아니라 이 값을 기준으로 `firstUnknownAskedCount`를 계산해야, 재처리로
   * 응답이 늦게 도착해도 그 사이 다른 질문이 올린 최신 `askedCount`를 자기 것으로 잘못 기록하지
   * 않습니다.
   */
  const answeredAskedCountRef = useRef(1);
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
   * 언마운트됐는지입니다. 이 훅이 사라진 뒤에도 `applyTurn`이나 `onBeforeQuestion`의 이어지는
   * 작업이 상태를 계속 바꾸는 것을 막습니다(구현검토 2026-09-11 P1-3, R5). `useInterviewStream`
   * 쪽의 이어지는 질문 요청은 그 훅 자신의 언마운트 가드가 막습니다.
   */
  const unmountedRef = useRef(false);
  useEffect(() => {
    return () => {
      unmountedRef.current = true;
      activeAbortRef.current?.abort();
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
        if (unmountedRef.current) return { ok: false, targetResponse: null };
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
        return { ok: true, targetResponse: result.targetResponse };
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return { ok: false, targetResponse: null };
        // 갱신 실패만으로 같은 블록에 고정하지 않습니다. progress는 건드리지 않고 다음 단계에서
        // 이전 평가 그대로 이동 정책을 적용합니다.
        unreflectedRef.current.set(turn.turnId, { turn, target, askedCountAtQuestion });
        syncUnreflectedTurnId();
        return { ok: false, targetResponse: null };
      } finally {
        activeRef.current = null;
        activeAbortRef.current = null;
      }
    },
    [setBlockStateBoth, syncUnreflectedTurnId]
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
      const result = applyQueueRef.current.then(() => runApplyTurn(turn, target, askedCountAtQuestion));
      applyQueueRef.current = result.then(
        () => undefined,
        () => undefined
      );
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
    initialTarget: FIRST_TARGET,
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
    void retryAllUnreflected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endReason, inner.isEnded, inner.endInterview, retryAllUnreflected]);

  const retryUnreflectedBlockUpdate = useCallback(() => {
    void retryAllUnreflected();
  }, [retryAllUnreflected]);

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

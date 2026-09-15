import type { BlockUpdateTurn } from "@/features/interview/block-prompt";
import type { InterviewHistoryMessage } from "@/features/interview/history";

/**
 * 이번 요청에서 저장할 턴을 고릅니다.
 *
 * 서버가 받은 이력으로 저장된 대화를 덮어쓰지 않고 그 턴만 이어 붙입니다. 질문 생성 경로는 대화가
 * 길어지면 오래된 질문과 답변을 요청에서 빼므로, 받은 그대로 덮어쓰면 저장된 대화의 중간이 사라집니다.
 *
 * `turnIds`에는 이번 답변의 턴과, 앞선 턴에서 저장이 실패해 아직 저장되지 않은 턴이 함께 옵니다.
 * 클라이언트가 밀린 턴의 식별자만 들고 있다가 다음 요청에 함께 보냅니다. 본문을 다시 실어 보내지
 * 않아도 되는 것은 요청이 이미 인터뷰 전체 턴을 싣고 오기 때문입니다(`EXPERIENCE_BLOCK_HISTORY_MAX_TURNS`).
 *
 * 고른 턴은 이력에 실려 온 순서 그대로 돌려줍니다. 식별자 목록의 순서를 따르면 클라이언트가 순서를
 * 잘못 보낼 때 저장된 대화의 앞뒤가 뒤바뀝니다. 같은 식별자가 두 번 들어와도 한 번만 담습니다.
 */
export function turnsToSave(
  history: readonly BlockUpdateTurn[],
  turnIds: readonly string[]
): InterviewHistoryMessage[] {
  const wanted = new Set(turnIds);
  return history
    .filter((turn) => wanted.has(turn.turnId))
    .flatMap((turn) => [
      { role: "question", text: turn.question } as const,
      { role: "answer", text: turn.answer } as const,
    ]);
}

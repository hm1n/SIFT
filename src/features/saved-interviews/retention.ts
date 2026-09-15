/**
 * 저장된 인터뷰의 보관 기간입니다(이슈 #116).
 *
 * 한 곳에 두는 이유는 화면이 말하는 기간과 서버가 실제로 지우는 기간이 갈리면 안 되기 때문입니다.
 * 화면은 "n일 뒤 지워집니다"라고 알리고 정리 작업은 이 값으로 기준 시각을 만듭니다.
 *
 * 세는 기준은 **마지막으로 연 시각**(`opened_at`)입니다. 만든 시각이 아닙니다. 목록에서 골라 읽기만
 * 하고 답을 달지 않아도 사용자는 그 인터뷰를 쓰고 있으므로 정리 대상이 아니어야 합니다. 그래서 인터뷰를
 * 열 때마다 남은 기간이 다시 90일로 돌아갑니다.
 */
export const RETENTION_DAYS = 90;

/** 이 날수 이하로 남으면 화면이 경고 표시로 바꿉니다. 디자인 원본의 `DELETION_WARNING_DAYS`입니다. */
export const DELETION_WARNING_DAYS = 7;

const DAY_MS = 86_400_000;

/**
 * 자동 삭제까지 남은 날수입니다. 0 이하이면 이미 지워질 대상입니다.
 *
 * **경과 시간은 0 아래로 내려가지 않게 자릅니다.** `opened_at`은 데이터베이스 시계가 찍고 남은 날수는
 * 브라우저 시계로 셉니다. 두 시계가 조금만 어긋나 방금 연 인터뷰가 미래로 보이면 `Math.floor`가 `-1`이
 * 되어 91일 남았다고 말합니다. 실제로 그렇게 떴습니다. 정리 작업은 90일보다 오래 열지 않은 줄만 지우니
 * 보관 기간보다 큰 수는 어느 경우에도 사실이 아닙니다.
 *
 * 정리 작업이 하루에 한 번만 돌고 Vercel Hobby는 지정한 시각부터 한 시간 안의 아무 때나 부르므로,
 * 기한이 지난 인터뷰가 목록에 잠시 남아 있을 수 있습니다. 화면은 0 이하를 이미 지워진 것으로 보고
 * 그리지 않습니다. 지워질 것이 목록에 보이는 동안 사용자가 그것을 열면 `opened_at`이 갱신돼 살아남는
 * 것도 맞는 동작입니다.
 */
export function daysUntilDeletion(openedAt: string | Date, now: number = Date.now()): number {
  const opened = openedAt instanceof Date ? openedAt.getTime() : new Date(openedAt).getTime();
  if (Number.isNaN(opened)) return RETENTION_DAYS;
  const elapsed = Math.max(0, now - opened);
  return RETENTION_DAYS - Math.floor(elapsed / DAY_MS);
}

/** 정리 작업이 쓰는 기준 시각입니다. 이보다 오래 열지 않은 인터뷰를 지웁니다. */
export function retentionCutoff(now: number = Date.now()): Date {
  return new Date(now - RETENTION_DAYS * DAY_MS);
}

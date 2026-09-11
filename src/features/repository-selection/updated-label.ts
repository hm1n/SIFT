const DAY_MS = 86_400_000;

/**
 * 디자인의 `UPDATED nD AGO` / `UPDATED TODAY` 라벨입니다. 기준은 마지막 push 시각이고, 값이 없거나 해석할 수 없으면 라벨을 그리지 않습니다.
 * 시계가 뒤로 가 미래 시각이 오면 TODAY로 봅니다.
 */
export function formatUpdatedLabel(pushedAt: string | null, now: number): string | null {
  if (!pushedAt) return null;
  const time = Date.parse(pushedAt);
  if (Number.isNaN(time)) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  return days === 0 ? "UPDATED TODAY" : `UPDATED ${days}D AGO`;
}

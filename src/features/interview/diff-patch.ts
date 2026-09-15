/**
 * GitHub가 주는 unified diff patch 문자열을 줄 단위로 나눠 줄 번호와 종류를 붙입니다. 문자열을
 * 그대로 `<pre>`에 넣으면 줄 번호와 `+`/`-` 표시를 따로 그릴 수 없습니다.
 *
 * **절단된 patch가 정상 입력입니다.** Stage B와 스냅샷 예산이 patch를 자르므로 hunk 헤더 없이
 * 시작하거나 줄 가운데서 끊긴 입력이 들어옵니다. 파싱에 실패해 빈 화면을 그리지 않고, 아는 것만
 * 붙이고 모르는 줄 번호는 null로 둡니다. 절단 사실 자체는 `patchTruncated`가 알리는 몫이고
 * 파서가 추정하지 않습니다.
 */

export type DiffLineType = "add" | "del" | "context" | "meta";

export interface DiffLine {
  readonly type: DiffLineType;
  /** 변경 전 파일의 줄 번호입니다. 추가된 줄이거나 hunk 헤더를 아직 못 본 구간이면 null입니다. */
  readonly oldNumber: number | null;
  /** 변경 후 파일의 줄 번호입니다. 삭제된 줄이거나 hunk 헤더를 아직 못 본 구간이면 null입니다. */
  readonly newNumber: number | null;
  /** 앞머리 기호를 뗀 본문입니다. `meta`는 원문 그대로입니다. */
  readonly content: string;
}

/** `@@ -12,7 +12,9 @@ function foo()` 형태입니다. 줄 수는 생략될 수 있습니다. */
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string): readonly DiffLine[] {
  if (patch === "") return [];

  const raw = patch.split("\n");
  // 마지막 개행이 만든 빈 줄은 diff의 내용이 아닙니다. 본문의 빈 줄은 접두어 공백이 있어 남습니다.
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();

  const lines: DiffLine[] = [];
  let oldNumber: number | null = null;
  let newNumber: number | null = null;

  for (const line of raw) {
    const hunk = HUNK_HEADER.exec(line);
    if (hunk !== null) {
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      lines.push({ type: "meta", oldNumber: null, newNumber: null, content: line });
      continue;
    }

    // `\ No newline at end of file`입니다. 어느 쪽 파일의 줄도 아니라 번호를 올리지 않습니다.
    if (line.startsWith("\\")) {
      lines.push({ type: "meta", oldNumber: null, newNumber: null, content: line });
      continue;
    }

    if (line.startsWith("+")) {
      lines.push({ type: "add", oldNumber: null, newNumber, content: line.slice(1) });
      if (newNumber !== null) newNumber += 1;
      continue;
    }

    if (line.startsWith("-")) {
      lines.push({ type: "del", oldNumber, newNumber: null, content: line.slice(1) });
      if (oldNumber !== null) oldNumber += 1;
      continue;
    }

    // 문맥 줄은 공백으로 시작합니다. 공백이 없는 줄은 절단이 앞머리를 지운 경우로 보고 문맥으로
    // 다룹니다. 알 수 없다고 버리면 잘린 patch의 마지막 줄이 화면에서 사라집니다.
    lines.push({
      type: "context",
      oldNumber,
      newNumber,
      content: line.startsWith(" ") ? line.slice(1) : line,
    });
    if (oldNumber !== null) oldNumber += 1;
    if (newNumber !== null) newNumber += 1;
  }

  return lines;
}

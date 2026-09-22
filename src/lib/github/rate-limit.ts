/**
 * GitHub의 요청 한도 응답을 가립니다.
 *
 * 세 가지를 함께 봐야 합니다. 429는 1차(primary)입니다. 403에 `x-ratelimit-remaining: 0`이 있으면
 * 1차입니다. 403에 `Retry-After`가 있거나 본문 메시지에 `secondary rate limit` 또는
 * `abuse detection`이 있으면 2차(secondary)입니다. 하나라도 놓치면 한도에 걸린 정상 사용자가
 * 인증 문제로 오분류됩니다.
 *
 * `commits.ts`에서 이 파일로 옮겼습니다(이슈 #145). 회원 탈퇴의 grant 해제 호출도 같은 판별이
 * 필요한데, 그 경로에서는 404와 401의 뜻이 달라 `classifyErrorResponse`를 그대로 쓸 수 없습니다.
 * 판별을 양쪽에 따로 두면 GitHub이 문구나 헤더를 바꿀 때 한쪽만 고치게 됩니다.
 */

/**
 * 본문 메시지입니다. 읽지 못하면 빈 문자열입니다.
 *
 * `clone`을 거치는 이유는 호출한 쪽이 같은 응답의 본문을 다시 읽을 수 있기 때문입니다. 파싱 실패를
 * 오류로 올리지 않는 이유는 이 값이 분류를 돕는 보조 근거일 뿐이어서, 본문이 깨졌다는 사실이
 * 한도 초과 여부보다 중요하지 않기 때문입니다.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.clone().json();
    const message = (body as { message?: unknown } | null)?.message;
    return typeof message === "string" ? message : "";
  } catch {
    return "";
  }
}

export async function isGitHubRateLimited(response: Response): Promise<boolean> {
  if (response.status === 429) return true;
  if (response.status !== 403) return false;

  const remaining = response.headers.get("x-ratelimit-remaining");
  const retryAfter = response.headers.get("retry-after");
  if (remaining === "0" || retryAfter !== null) return true;

  // ponytail: 메시지 문자열 매칭은 GitHub가 문구를 바꾸면 깨지는 얕은 방법이지만, 공식 문서에 나온
  // 두 문구만 대응하는 지금 수준에서는 충분함. 오분류가 실제로 관찰되면 그때 패턴을 넓히면 됨.
  return /secondary rate limit|abuse detection/i.test(await readErrorMessage(response));
}

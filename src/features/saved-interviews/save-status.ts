/**
 * 턴 하나를 저장한 결과입니다(이슈 #115). 블록 갱신 응답의 `save`가 이 값이고, 클라이언트 훅이 그대로
 * 화면에 올립니다.
 *
 * 서버 쪽 계약이지만 화면도 같은 값을 읽으므로 route가 아니라 여기에 둡니다. route에 두면 브라우저에서
 * 도는 코드가 서버 route 모듈을 가리키게 됩니다.
 */
export type SavedTurnStatus = "saved" | "version_conflict" | "not_found" | "failed";

/**
 * `skipped`는 저장 대상을 받지 않아 저장하지 않았다는 뜻입니다. 경험을 확정하기 전이거나 인터뷰 줄을
 * 만들지 못한 경우입니다.
 *
 * `failed`는 저장 계층이 오류를 던진 경우입니다. 종류를 더 나누지 않는 이유는 화면이 할 일이 같기
 * 때문입니다. 저장하지 못했다고 알리고 대화는 그대로 잇습니다. `version_conflict`만 갈라 둡니다.
 * 다른 탭이 먼저 저장한 경우라 화면이 최신 내용을 다시 불러올지 물어야 합니다.
 */
export type BlockUpdateSaveStatus = "skipped" | SavedTurnStatus;

import { BLOCK_EMPTY_ENDED, BLOCK_EMPTY_PENDING, LOAD_LATEST, NO_INTERVIEWS } from "./shared";
/**
 * 저장 계층 요청이 화면에 닿기 전에 끊긴 경우입니다. `fetch`가 던지는 영어 원문을 쓰지 않습니다.
 * `repository-analysis-view.tsx`의 조회 실패 안내가 이 message를 그대로 그립니다.
 */
export const SAVED_INTERVIEW_REQUEST_COPY = {
  network: "저장 서버에 연결하지 못했습니다.",
  unreadableResponse: "저장 서버 응답을 읽지 못했습니다.",
} as const;

export const SAVED_INTERVIEW_LIST_COPY = {
  loading: "인터뷰를 불러오는 중…",
  error: "인터뷰를 불러오지 못했습니다.",
  retry: "다시 시도",
  empty: NO_INTERVIEWS,
  deleteConfirm: "이 인터뷰를 삭제할까요? 되돌릴 수 없습니다.",
  cancel: "취소",
  delete: "삭제",
  deleteLabel: (title: string) => `인터뷰 삭제: ${title}`,
} as const;

/**
 * 자동 삭제까지 남은 기간입니다(이슈 #116). 기한이 가까우면 화면이 경고색으로 바꿉니다.
 *
 * 남은 날수는 `일`로 셉니다. 수량을 영어로 세는 `pluralCount`를 쓰지 않는 자리입니다. 세는 단위가
 * mono로 그려지는 developer metadata가 아니라 본문이고, `일`은 조사가 바로 붙어 어순을 비틀지
 * 않아도 됩니다.
 */
export const DELETION_NOTICE_COPY = {
  /** 목록 배지의 설명입니다. 배지 자체는 `D-3` 같은 mono 표기라 영어로 남습니다. */
  badgeTitle: (days: number) => `${days}일 뒤에 자동으로 지워집니다`,
  expiringSoon: (days: number) => `이 인터뷰는 ${days}일 뒤에 자동으로 지워집니다.`,
  remaining: (days: number) => `자동 삭제까지 ${days}일 남았습니다. 인터뷰를 열면 기간이 다시 시작됩니다.`,
} as const;

export const SAVED_INTERVIEW_SCREEN_COPY = {
  /** mono 섹션 라벨입니다. 레퍼런스 `TRANSLATIONS.ko`가 이 항목만은 한국어로 둡니다. */
  paarHeading: "PAAR 경험",
  /** PAAR 블록이 비어 있을 때입니다. 끝난 인터뷰인지에 따라 사용자가 할 수 있는 일이 다릅니다. */
  blockEmptyEnded: BLOCK_EMPTY_ENDED,
  blockEmptyPending: BLOCK_EMPTY_PENDING,
  noCandidateAnalysis: "이 인터뷰에는 후보를 고를 때 사용한 분석이 저장되지 않았습니다.",
  noTopics: "이 인터뷰에는 기술 토픽이 없습니다.",
  commitNotIndexed: "불러온 커밋 목록에서 찾지 못했습니다.",
  evidenceUnreadable: "저장된 근거를 읽을 수 없습니다.",
  blocksUnreadable: "저장된 PAAR 블록을 읽을 수 없습니다.",
  edit: "편집",
  editLabel: (block: string) => `${block} 편집`,
  editorLabel: (block: string) => `${block} — 한 줄에 한 문장`,
  /** 고치기 전에 인용을 잃는다는 사실을 알립니다. 되돌릴 수 없어 바뀐 뒤에 알리면 늦습니다. */
  editorNote: (remainingBytes: string) =>
    `편집하면 Repository 인용이 사라지고, 이 문장들은 직접 작성한 내용으로 표시됩니다. ${remainingBytes}바이트 남았습니다.`,
  tooManyStatements: (max: number) => `문장은 한 줄에 하나씩, 최대 ${max}줄까지 써 주세요.`,
  blockTooLarge: (maxBytes: string) => `이 블록은 ${maxBytes}바이트까지 저장할 수 있습니다.`,
  saveFailed: "편집한 내용이 저장되지 않았습니다. 블록에는 위에 보이는 내용이 그대로 남아 있습니다.",
  saveConflict: "다른 곳에서 인터뷰가 바뀌어 편집한 내용을 저장하지 않았습니다. 최신 내용을 불러온 뒤 다시 편집해 주세요.",
  loadLatest: LOAD_LATEST,
  saving: "저장 중…",
  save: "저장",
  cancel: "취소",
  review: "인터뷰 다시 보기",
  resume: "인터뷰 계속하기",
  /** 같은 분석에서 고를 수 있는 다른 경험으로 갑니다(이슈 #116). */
  openAnalysis: "이 분석의 다른 경험",
} as const;

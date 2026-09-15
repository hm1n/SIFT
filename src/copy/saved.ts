import { BLOCK_EMPTY_ENDED, BLOCK_EMPTY_PENDING, LOAD_LATEST, NO_INTERVIEWS } from "./shared";
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
} as const;

export const SAVED_INTERVIEW_LIST_COPY = {
  loading: "인터뷰를 불러오는 중...",
  error: "인터뷰를 불러오지 못했습니다.",
  retry: "다시 시도",
  empty: "인터뷰가 없습니다. 경험 후보를 선택해 시작하세요.",
  deleteConfirm: "이 인터뷰를 삭제할까요? 되돌릴 수 없습니다.",
  cancel: "취소",
  delete: "삭제",
  deleteLabel: (title: string) => `인터뷰 삭제: ${title}`,
} as const;

export const SAVED_INTERVIEW_SCREEN_COPY = {
  /** mono 섹션 라벨입니다. 레퍼런스 `TRANSLATIONS.ko`가 이 항목만은 한국어로 둡니다. */
  paarHeading: "PAAR 경험",
  /** PAAR 블록이 비어 있을 때입니다. 끝난 인터뷰인지에 따라 사용자가 할 수 있는 일이 다릅니다. */
  blockEmptyEnded: "이 블록은 채우지 못한 채 인터뷰가 끝났습니다.",
  blockEmptyPending: "대화를 진행하면 AI가 이 블록을 채웁니다.",
  noCandidateAnalysis: "이 인터뷰에는 후보 분석이 함께 저장되지 않았습니다.",
  noTopics: "이 인터뷰에는 기술 토픽이 없습니다.",
  commitNotIndexed: "커밋 색인에서 찾지 못했습니다.",
  evidenceUnreadable: "저장된 근거를 읽을 수 없습니다.",
  blocksUnreadable: "저장된 PAAR 블록을 읽을 수 없습니다.",
  edit: "편집",
  editLabel: (block: string) => `${block} 편집`,
  editorLabel: (block: string) => `${block} — 한 줄에 한 문장`,
  /** 고치기 전에 인용을 잃는다는 사실을 알립니다. 되돌릴 수 없어 바뀐 뒤에 알리면 늦습니다. */
  editorNote: (remainingBytes: string) =>
    `편집하면 이 문장들에 붙은 Repository 인용이 사라집니다. 편집한 내용은 사용자 본인의 진술로 표시됩니다. ${remainingBytes}바이트 남았습니다.`,
  tooManyStatements: (max: number) => `${max}줄 이하로 써 주세요. 한 줄이 한 문장입니다.`,
  blockTooLarge: (maxBytes: string) => `이 블록이 서버 상한인 ${maxBytes}바이트를 넘었습니다.`,
  saveFailed: "편집한 내용이 저장되지 않았습니다. 블록에는 위에 보이는 내용이 그대로 남아 있습니다.",
  saveConflict: "다른 곳에서 이 인터뷰가 바뀌어 편집한 내용이 저장되지 않았습니다. 최신 내용을 불러온 뒤 다시 편집해 주세요.",
  loadLatest: "최신 내용 불러오기",
  saving: "저장 중…",
  save: "저장",
  cancel: "취소",
  review: "인터뷰 다시 보기",
  resume: "인터뷰 계속하기",
} as const;

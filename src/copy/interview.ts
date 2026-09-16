import {
  BLOCK_EMPTY_ENDED,
  SECTION_EXPERIENCE,
  BLOCK_EMPTY_PENDING,
  CONTINUE_INTERVIEW,
  LOAD_LATEST,
} from "./shared";
import type { BlockUpdateFetchErrorKind } from "@/features/experience-block/client";
import type { EvidenceFileStatus } from "@/features/interview/evidence-files";
import type {
  InterviewStreamErrorKind,
  InterviewStreamRequestErrorKind,
  InterviewStreamTransportErrorKind,
} from "@/features/interview/errors";
import type { EvidencePatchOmittedReason } from "@/features/experience-candidates/types";

/** 스트림 상태를 낭독하는 문단입니다. 상태 전이마다 이 문장이 바뀝니다. */
export const STREAM_STATUS_COPY = {
  idle: "아직 질문을 요청하지 않았습니다.",
  connecting: "질문을 불러오는 중입니다.",
  streaming: "질문을 받고 있습니다.",
  reconnecting: "연결이 끊어져 다시 연결하고 있습니다. 받은 내용은 그대로 남아 있습니다.",
  done: "질문이 모두 도착했습니다.",
  error: "질문을 받지 못했습니다.",
} as const;

/**
 * 종료는 스트림 상태가 아니지만 사용자가 낭독으로 알아야 하는 상태는 같은 문단 하나입니다.
 * 종료 뒤에는 스트림 상태가 무엇이든 이 문장이 그 자리를 덮습니다.
 */
export const ENDED_STATUS_TEXT = "인터뷰가 끝났습니다. 대화는 읽기 전용입니다.";

/** 스트림이 시작되기 전 서버가 거절한 경우입니다. 다시 시도해서 풀리는 것과 아닌 것을 구분해 알립니다. */
export const REQUEST_ERROR_GUIDANCE: Partial<Record<InterviewStreamRequestErrorKind, string>> = {
  unauthorized: "GitHub 로그인 세션이 필요합니다. 다시 로그인한 뒤 시도해 주세요.",
  invalid_request: "질문에 필요한 정보가 빠졌거나 올바르지 않습니다. 다시 시도해도 같으면 페이지를 새로 고쳐 주세요.",
  invalid_json: "보낸 내용을 읽을 수 없습니다. 다시 시도해도 같으면 페이지를 새로 고쳐 주세요.",
  body_too_large: "이 질문의 근거가 너무 커서 한 번에 보낼 수 없습니다. 다시 시도해도 해결되지 않습니다.",
  /**
   * `body_too_large`와 갈라 씁니다. 둘 다 다시 시도로 풀리지 않지만 사용자가 할 수 있는 일이
   * 다릅니다. 대화를 줄이는 조작을 두지 않았으므로 실제로 있는 조작인 종료와 새 인터뷰를 가리킵니다.
   */
  history_too_large:
    "대화가 너무 길어 다음 질문을 만들 수 없습니다. 다시 시도해도 해결되지 않습니다. 인터뷰를 완료한 뒤 후보 목록에서 새 인터뷰를 시작해 주세요.",
};

/** 생성 쪽 실패의 원인 문장입니다. 재시도가 무엇을 하는지는 `RETRY_HINT_COPY`가 붙입니다. */
export const GENERATION_ERROR_CAUSE: Partial<Record<InterviewStreamErrorKind, string>> = {
  llm_rate_limit: "AI 요청 한도에 도달했습니다.",
  llm_timeout: "AI가 제한 시간 안에 질문을 만들지 못했습니다.",
  llm_network: "AI에 연결하지 못했습니다.",
  llm_auth: "AI 연결 인증에 문제가 있습니다. 서버 설정 문제입니다.",
  llm_configuration: "AI 연결 설정에 문제가 있습니다.",
  /** 크기를 지목하지 않습니다. 이 분류가 실제로 뜻하는 것은 크기가 아니라 provider의 요청 거부입니다. */
  llm_request: "AI가 이 요청을 받아들이지 않았습니다.",
  llm_failure: "AI가 응답하지 않았습니다.",
  server_error: "서버 설정 문제로 요청을 처리하지 못했습니다.",
};

/**
 * 다시 시도가 무엇을 하는지 알립니다. 이어받을 수 없는 스트림에서는 다시 시도가 처음부터 새로
 * 만드는 것이라 "이미 받은 내용은 그대로 두었습니다"를 쓰면 안 됩니다.
 */
export const RETRY_HINT_COPY = {
  sameResult: "다시 시도해도 해결되지 않습니다.",
  resumable: "받은 내용은 그대로 남아 있습니다. 잠시 후 다시 시도해 주세요.",
  rebuild: "다시 시도하면 같은 근거로 질문을 처음부터 만듭니다. 지금까지 받은 내용은 사라집니다. 잠시 후 다시 시도해 주세요.",
} as const;

export const STREAM_ERROR_GUIDANCE_COPY = {
  connectFailed: "연결하지 못했습니다. 아직 도착한 내용이 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.",
  interruptedResumable: "자동으로 두 번 다시 연결했지만 모두 실패했습니다. 받은 내용은 그대로 남아 있고, 다시 시도하면 끊긴 지점부터 이어받습니다.",
  interruptedRebuild:
    "질문이 도착하는 중에 연결이 끊어졌습니다. 끊긴 지점부터 이어받을 수 없어 다시 시도하면 같은 근거로 질문을 처음부터 새로 만듭니다. 지금까지 받은 내용은 사라집니다.",
  generationEmpty: "질문이 한 조각도 도착하지 않았습니다. 다시 시도하면 같은 근거로 질문을 다시 만듭니다.",
  unknownCause: "질문을 만드는 중에 오류가 발생했습니다.",
} as const;

/** 대화 열이 그리는 문구입니다. mono 라벨(`Agent`, `You`, `PAAR`)은 영어로 남아 여기 없습니다. */
export const STREAM_VIEW_COPY = {
  streamLabel: "AI 질문",
  /** 제출 단축키 표기입니다. 기호라 번역 대상이 아닙니다. */
  submitShortcut: "⌘/Ctrl+↵",
  unsavedNotice: "마지막 답변이 저장되지 않았습니다.",
  retrySave: "다시 저장",
  staleNotice: "다른 탭에서 이 인터뷰가 변경됐습니다.",
  loadLatest: LOAD_LATEST,
  preparingFirst: "첫 질문을 준비하고 있습니다.",
  preparingNext: "다음 질문을 준비하고 있습니다.",
  viewNewMessages: "새 메시지 보기",
  unreadNotice: "새 내용이 도착했지만 자동 스크롤은 멈춰 있습니다. 맨 아래로 이동하면 다시 시작됩니다.",
  questionTooLong: "이 질문이 너무 길어 대화를 이어갈 수 없습니다.",
  questionTooLongGuidance: (limit: string) =>
    `이 질문은 한 메시지에 담을 수 있는 ${limit}바이트를 넘어 답변할 수 없습니다. 다시 시도하면 지금까지의 대화는 그대로 두고 이 질문만 새로 만듭니다.`,
  retry: "다시 시도",
  endedNotice: "답변 입력을 닫았습니다. 후보 목록으로 돌아가면 이 대화는 완전히 사라집니다.",
  answerLabel: "답변",
  answerPlaceholder: "질문에 답해 주세요. 코드 블록을 써도 됩니다.",
  answerTooLong: (bytes: string, limit: string) =>
    `답변은 한 메시지에 ${limit}바이트까지 쓸 수 있습니다. 지금은 ${bytes}바이트입니다. 줄바꿈과 코드 블록도 크기에 포함됩니다.`,
  answerReady: "답변을 보내면 지금까지의 대화를 바탕으로 다음 질문을 만듭니다.",
  answerWaiting: "질문을 모두 받으면 답변할 수 있습니다.",
  send: "전송",
  /** 이력에서 빠진 구간을 그 자리에 알립니다. 대화 밖에 두면 어느 대목이 빠졌는지 알 수 없습니다. */
  trimNotice: (pairs: string) =>
    `AI가 참고하는 대화에서 여기부터 ${pairs}를 제외했습니다. 화면에는 남아 있지만 AI는 더 이상 참고하지 않습니다. 첫 질문과 답변, 최근 대화는 계속 참고합니다.`,
} as const;

export const INTERVIEW_SCREEN_COPY = {
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  eyebrow: SECTION_EXPERIENCE,
  /** 코드 패널을 여닫는 버튼입니다. 워크스페이스와 탭 모드가 같은 글자를 씁니다. */
  codePanelToggle: "Code",
  back: "← 뒤로",
  interviewTab: "인터뷰",
  workspaceView: "워크스페이스 보기",
  resizeCodePanel: "코드 패널 폭 조절",
  resizePaarPanel: "PAAR 패널 폭 조절",
  representativeCommit: (shortSha: string) => `대표 커밋 ${shortSha}`,
  /** 저장되는 인터뷰는 나가도 사라지지 않으므로 "아무것도 저장되지 않는다"고 말하면 안 됩니다. */
  leaveSaved:
    "후보 목록으로 돌아가도 저장된 대화와 PAAR 블록은 왼쪽 Interviews에 남습니다. 나중에 다시 이어갈 수 있지만 지금 쓰던 답변은 사라집니다.",
  leaveUnsaved:
    "후보 목록으로 돌아가면 대화, 쓰던 답변, PAAR 블록이 모두 사라집니다. 페이지를 새로 고쳐도 복구할 수 없습니다.",
  unsavedTurns: (count: number) =>
    count === 1
      ? "이미 보낸 답변 1개가 아직 저장되지 않아 함께 사라집니다."
      : `이미 보낸 답변 ${count}개가 아직 저장되지 않아 함께 사라집니다.`,
  leaveConfirm: "후보 목록으로",
  stay: CONTINUE_INTERVIEW,
} as const;

/** PAAR 카드의 네 상태입니다. 상태 라벨과 빈 자리 문구를 함께 둡니다. */
export const PAAR_CARD_STATE_COPY = {
  pending: "시작 전",
  collecting: "수집 중",
  filled: "완료",
  unfilled: "미완료",
} as const;

/**
 * 카드가 비어 있을 때의 문구입니다. 무엇이 아직 안 일어났는지가 아니라 무엇을 하면 채워지는지를
 * 말합니다. 레퍼런스 `paar-interview-workspace.md`가 "대화에 답하면 오른쪽 PAAR이 채워진다"를
 * 화면의 목표로 정합니다.
 */
export const PAAR_CARD_EMPTY_COPY = {
  pending: BLOCK_EMPTY_PENDING,
  collecting: "AI가 마지막 답변을 반영하고 있습니다.",
  filled: "",
  unfilled: BLOCK_EMPTY_ENDED,
} as const;

/**
 * 답변이 블록에 반영되지 않은 이유입니다. 다시 시도하면 풀릴 일인지 아닌지를 가리는 것이 목적입니다.
 *
 * 문구를 넣은 계기는 2026-09-15의 사고입니다. `.env`의 키 이름이 어긋나 블록 갱신이 매번 인증 실패로
 * 끝났는데 화면에는 "반영되지 않았습니다"만 떠서, 설정 문제라는 것이 드러나기까지 인터뷰 두 개의
 * 대화가 통째로 사라졌습니다. 저장이 이 요청에 얹혀 가므로 반영 실패는 곧 저장 실패입니다.
 *
 * 분류를 다 적지 않습니다. 없는 분류에는 `PAAR_PANEL_COPY.updateUnfinished`가 나갑니다. 틀린 원인을
 * 단정하는 것보다 원인을 말하지 않는 편이 낫습니다.
 */
export const BLOCK_UPDATE_ERROR_CAUSE: Partial<Record<BlockUpdateFetchErrorKind, string>> = {
  network: "서버에 연결하지 못했습니다.",
  llm_network: "AI에 연결하지 못했습니다.",
  llm_timeout: "AI가 제한 시간 안에 답변을 반영하지 못했습니다.",
  llm_rate_limit: "AI 요청 한도에 도달했습니다.",
  llm_failure: "AI가 응답하지 않았습니다.",
  llm_request: "AI가 이 요청을 받아들이지 않았습니다.",
  // 설정 문제는 다시 시도해도 같은 결과입니다. 사용자가 아니라 서버가 고쳐야 한다고 분명히 적습니다.
  llm_auth: "AI 연결 인증에 문제가 있습니다. 서버 설정 문제입니다.",
  llm_configuration: "AI 연결 설정에 문제가 있습니다. 서버 설정 문제입니다.",
  unauthorized: "로그인 세션이 더 이상 유효하지 않습니다. 다시 로그인해 주세요.",
  // 모델 출력이 흔들린 경우입니다. 같은 답변으로 다시 시도하면 통과할 수 있습니다.
  block_update_rejected: "AI가 보낸 내용을 확인할 수 없습니다.",
  schema_validation: "AI가 보낸 내용의 형식을 확인할 수 없습니다.",
  json_parse: "AI가 보낸 내용을 읽지 못했습니다.",
  unknown_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unrelated_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unknown_file_path: "모델이 이 경험의 근거에 없는 파일을 인용했습니다.",
  history_too_large: "대화가 너무 길어 PAAR 블록에 반영할 수 없습니다.",
  claims_too_large: "이 PAAR 블록이 너무 커서 새 내용을 반영할 수 없습니다.",
  body_too_large: "보낼 내용이 너무 많아 답변을 반영할 수 없습니다.",
  server_error: "서버 설정 문제로 요청을 처리하지 못했습니다.",
};

export const PAAR_PANEL_COPY = {
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  heading: "PAAR",
  cardNotReflected: "이 블록을 겨냥한 답변이 아직 반영되지 않았습니다.",
  unreflected: "마지막 답변이 아직 반영되지 않았고, 그래서 저장도 되지 않았습니다.",
  updateUnfinished: "마지막 답변을 반영하지 못했습니다.",
  retrying: "다시 시도 중…",
  retry: "다시 시도",
  readyToFinish: "PAAR 블록을 모두 채웠습니다. 인터뷰를 마쳐도 좋습니다.",
  /** 끝내면 답변 입력이 닫힙니다. 저장되는 인터뷰만 나중에 블록을 고칠 수 있습니다. */
  endConfirmSaved:
    "인터뷰를 완료하면 답변 입력이 닫히고 대화를 읽기만 할 수 있습니다. 쓰던 답변은 사라집니다. 인터뷰는 왼쪽 Interviews에 남아 있고, 거기서 다시 열어 PAAR 블록을 고칠 수 있습니다.",
  endConfirmUnsaved:
    "인터뷰를 완료하면 답변 입력이 닫히고 대화를 읽기만 할 수 있습니다. 쓰던 답변은 사라집니다. 이 인터뷰는 저장되지 않으므로 PAAR 블록은 지금 상태로 남고 나중에 고칠 수 없습니다. 후보 목록으로 돌아가면 대화도 함께 사라지고 다시 이어갈 수 없습니다.",
  end: "인터뷰 완료",
  stay: CONTINUE_INTERVIEW,
} as const;

/** 파일 행의 한 글자 표시 옆에 시각적으로 숨겨 두는 상태 이름입니다. */
export const FILE_STATUS_LABEL: Record<EvidenceFileStatus, string> = {
  added: "추가됨",
  modified: "수정됨",
  deleted: "삭제됨",
};

/** patch 본문이 없는 이유입니다. 예산 소진과 GitHub 미제공은 사용자에게 뜻이 다릅니다. */
export const PATCH_OMITTED_COPY: Record<EvidencePatchOmittedReason, string> = {
  budget_exhausted: "근거가 너무 많아 이 파일의 diff를 포함하지 못했습니다.",
  not_provided: "GitHub이 이 파일의 patch를 제공하지 않았습니다.",
};

/** mono 섹션 라벨(`Code / Evidence`, `Files`, `Diff`, `File`, `Selected file`)은 영어로 남아 여기 없습니다. */
export const CODE_PANEL_COPY = {
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  heading: "Code / Evidence",
  diffMode: "Diff",
  fileMode: "File",
  filesLabel: "Files",
  selectedFile: "Selected file",
  noDiffBody: "No diff body",
  viewModeLabel: "보기 모드",
  fileModeUnavailable: "— 볼 수 없습니다. GitHub에서 받은 변경 내용에는 파일 전체가 없습니다.",
  expandFiles: "파일 목록 펼치기",
  collapseFiles: "파일 목록 접기",
  budgetTrimmed: (patchBytes: string) =>
    `AI가 한 번에 확인할 수 있는 분량에 맞춰 코드 변경 일부를 뺐습니다. 포함한 diff는 ${patchBytes} bytes입니다.`,
  unverifiableHeading: "Repository에서 확인할 수 없는 것",
  unverifiableIntro: "이 내용은 인터뷰에서 직접 설명해 주세요.",
  previousCommit: "이전 커밋",
  nextCommit: "다음 커밋",
  commitNotIndexed: "불러온 커밋 목록에서 찾지 못했습니다. 제목, 메시지, PR 정보를 확인할 수 없습니다.",
  noPatchBody: "이 커밋에는 이 파일의 diff 본문이 없습니다.",
  diffTruncated: "이 diff는 일부만 보여 줍니다. 파일의 전체 변경 내용이 아닙니다.",
} as const;

/** 사용자 주장과 저장소 관찰이 어긋난 상태입니다. 문장 안이 아니라 밖에 그립니다(설계 8절). */
export const CONFLICT_MARK = "근거와 어긋납니다 · 확인이 필요합니다";

/** 스트림 전송 자체가 실패했을 때입니다. 화면이 `error.message`로 그대로 그립니다. */
export const TRANSPORT_MESSAGE: Record<InterviewStreamTransportErrorKind, string> = {
  stream_connect_failed: "질문을 받을 연결을 만들지 못했습니다.",
  stream_interrupted: "질문이 도착하는 중에 연결이 끊어졌습니다.",
};

/**
 * 스트림은 이어졌는데 실려 온 내용을 해석하지 못한 경우입니다. 분류는 `stream_interrupted`로 같지만
 * 사용자에게 알리는 사실이 다릅니다. 연결이 끊어진 것이 아니라 도착한 내용이 깨진 것입니다.
 * 분류가 같으므로 뒤따르는 안내와 재시도 동작은 `TRANSPORT_MESSAGE` 쪽과 같습니다.
 */
export const STREAM_DATA_UNREADABLE_MESSAGE = "질문이 도착하는 중에 내용이 깨졌습니다.";

export const GENERATION_EMPTY_MESSAGE = "질문을 만들지 못했습니다.";

/**
 * 인터뷰가 종료 대기로 넘어갔을 때 질문 자리에 넣는 안내입니다. 모델이 만든 질문이 아니라 훅이
 * 고정 문구로 채우는 것이고, 화면은 이것을 다른 질문과 똑같이 그립니다(설계 6-2절 6번, 6-3절).
 *
 * 이름의 `PROMPT`는 모델에게 주는 지시가 아니라 질문 자리를 뜻합니다. 이 디렉터리는 AI 프롬프트를
 * 담지 않습니다. 이름을 바꾸지 않은 것은 `llm-wiki` 문서 6개가 이 이름으로 이 문구를 가리키기
 * 때문입니다.
 */
export const READY_TO_FINISH_PROMPT =
  "지금까지 답변으로 확인할 내용은 충분합니다. 더 남기고 싶은 내용이 있다면 이어서 답해 주세요. 없다면 종료를 눌러 마무리할 수 있습니다.";

/** 질문 요청 본문 검증과 스트림 라우트가 내려보내는 문구입니다. 화면이 그대로 그립니다. */
export const QUESTION_REQUEST_COPY = {
  invalidSnapshot: "질문에 쓸 Repository 근거를 확인할 수 없습니다.",
  invalidHistory: "대화 내용을 확인할 수 없습니다.",
  historyShape: "대화가 질문과 답변 순서로 이어지지 않습니다.",
  historyTooManyItems: (limit: number) => `대화 이력은 최대 ${limit}개 항목까지만 담을 수 있습니다.`,
  historyItemTooLarge: (limit: number) => `질문과 답변은 각각 최대 ${limit}바이트까지만 담을 수 있습니다.`,
  invalidScenario: "질문 생성 설정을 확인할 수 없습니다.",
  invalidLastEventId: "질문을 이어받을 위치를 확인할 수 없습니다.",
  noResume: "이 질문은 끊긴 지점부터 이어받을 수 없습니다. 처음부터 다시 만들어 주세요.",
  unauthorized: "GitHub 로그인 세션이 필요합니다.",
  serverMisconfigured: "서버 설정 문제로 질문 생성을 시작하지 못했습니다.",
  invalidJson: "보낸 내용을 읽을 수 없습니다.",
  /** 상한은 `MAX_INTERVIEW_STREAM_BODY_BYTES`입니다. 라우트가 KB로 바꿔 넘깁니다. */
  bodyTooLarge: (limitKb: number) => `요청 내용이 상한인 ${limitKb}KB를 넘었습니다.`,
  evidenceTooLarge: "질문 근거가 한 번의 요청에 담을 수 있는 크기를 넘었습니다.",
  targetPairRequired: "다음 질문에서 확인할 PAAR 항목 정보가 일부 빠졌습니다.",
  invalidTarget: "다음 질문에서 확인할 PAAR 항목이 올바르지 않습니다.",
  invalidLastOutcome: "직전 질문 결과를 확인할 수 없습니다.",
  generationFailed: "질문 생성에 실패했습니다.",
} as const;

/**
 * LLM 호출 실패를 옮긴 문구입니다. `${context}` 자리에는 받침으로 끝나는 한국어 명사가 들어갑니다
 * (`질문 생성`, `블록 갱신`). 문구가 `이`·`에` 조사를 붙이기 때문입니다.
 */
export const LLM_ERROR_COPY = {
  apiKeyMissing: "AI 연결에 필요한 API 키가 없습니다.",
  authFailed: "AI 인증에 실패했습니다.",
  rateLimit: "AI 요청 한도에 도달했습니다.",
  evidenceTooLarge: (context: string) =>
    `${context}에 필요한 근거가 AI에 한 번에 보낼 수 있는 크기를 넘습니다.`,
  modelMisconfigured: "사용할 AI 모델 설정이 올바르지 않습니다.",
  temporarilyUnavailable: "AI를 일시적으로 쓸 수 없습니다.",
  rejected: "AI가 요청을 거절했습니다.",
  unreachable: "AI에 연결하지 못했습니다.",
  timedOut: (context: string) => `${context}이 제한 시간 안에 끝나지 않았습니다.`,
  failed: (context: string) => `${context}에 실패했습니다.`,
  /** 구조화 출력이 스키마를 벗어난 경우입니다. 자유 텍스트 스트리밍인 첫 질문 생성에는 걸리지 않습니다. */
  schemaMismatch: (context: string) => `${context} 결과가 약속한 형식과 다릅니다.`,
} as const;

/** `mapInterviewLlmError`에 넘기는 작업 이름입니다. 조사가 붙으므로 받침으로 끝나야 합니다. */
export const LLM_ERROR_CONTEXT = {
  questionGeneration: "질문 생성",
  blockUpdate: "블록 갱신",
} as const;

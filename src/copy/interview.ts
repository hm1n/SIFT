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
  connecting: "질문 스트림에 연결하는 중입니다.",
  streaming: "질문이 도착하고 있습니다.",
  reconnecting: "연결이 끊어졌습니다. 이미 받은 내용은 그대로 두고 다시 연결하는 중입니다.",
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
  invalid_request: "요청 형식이 잘못되었습니다. 다시 시도해도 같은 결과면 페이지를 새로 고쳐 주세요.",
  invalid_json: "요청 형식이 잘못되었습니다. 다시 시도해도 같은 결과면 페이지를 새로 고쳐 주세요.",
  body_too_large: "이 질문의 근거가 한 번의 요청에 담을 수 있는 크기를 넘습니다. 다시 시도해도 같은 결과가 나옵니다.",
  /**
   * `body_too_large`와 갈라 씁니다. 둘 다 다시 시도로 풀리지 않지만 사용자가 할 수 있는 일이
   * 다릅니다. 대화를 줄이는 조작을 두지 않았으므로 실제로 있는 조작인 종료와 새 인터뷰를 가리킵니다.
   */
  history_too_large:
    "대화가 길어져 다음 질문을 만들 수 없습니다. 다시 시도해도 같은 결과가 나옵니다. 이 인터뷰를 끝내고 후보 목록에서 경험을 골라 새 인터뷰를 시작해 주세요.",
};

/** 생성 쪽 실패의 원인 문장입니다. 재시도가 무엇을 하는지는 `RETRY_HINT_COPY`가 붙입니다. */
export const GENERATION_ERROR_CAUSE: Partial<Record<InterviewStreamErrorKind, string>> = {
  llm_rate_limit: "질문 생성 서비스가 호출 한도에 걸렸습니다.",
  llm_timeout: "질문 생성이 제한 시간 안에 끝나지 않았습니다.",
  llm_network: "질문 생성 서비스에 연결하지 못했습니다.",
  llm_auth: "질문 생성 서비스 인증에 실패했습니다. 서버 설정 문제입니다.",
  llm_configuration: "질문 생성 서비스 설정이 잘못되었습니다.",
  /** 크기를 지목하지 않습니다. 이 분류가 실제로 뜻하는 것은 크기가 아니라 provider의 요청 거부입니다. */
  llm_request: "질문 생성 서비스가 요청을 받아들이지 않았습니다.",
  llm_failure: "질문 생성 서비스가 응답하지 않았습니다.",
  server_error: "서버 설정 문제로 요청을 처리하지 못했습니다.",
};

/**
 * 다시 시도가 무엇을 하는지 알립니다. 이어받을 수 없는 스트림에서는 다시 시도가 처음부터 새로
 * 만드는 것이라 "이미 받은 내용은 그대로 두었습니다"를 쓰면 안 됩니다.
 */
export const RETRY_HINT_COPY = {
  sameResult: "다시 시도해도 같은 결과가 나옵니다.",
  resumable: "이미 받은 내용은 그대로 두었습니다. 잠시 후 다시 시도해 주세요.",
  rebuild: "잠시 후 다시 시도해 주세요. 다시 시도하면 같은 근거로 질문을 처음부터 새로 만들고, 지금까지 받은 내용은 사라집니다.",
} as const;

export const STREAM_ERROR_GUIDANCE_COPY = {
  connectFailed: "연결하지 못했습니다. 아직 도착한 내용이 없습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.",
  interruptedResumable: "자동 재연결을 두 번 모두 실패했습니다. 이미 받은 내용은 그대로 두었고, 다시 시도하면 끊긴 지점부터 이어받습니다.",
  interruptedRebuild:
    "질문이 도착하는 중에 연결이 끊어졌습니다. 끊긴 지점부터 이어받을 수 없어 다시 시도하면 같은 근거로 질문을 처음부터 새로 만듭니다. 지금까지 받은 내용은 사라집니다.",
  generationEmpty: "질문이 한 조각도 도착하지 않았습니다. 다시 시도하면 같은 근거로 질문을 다시 만듭니다.",
  unknownCause: "질문을 만드는 중에 오류가 발생했습니다.",
} as const;

/** 대화 열이 그리는 문구입니다. mono 라벨(`Agent`, `You`, `PAAR`)은 영어로 남아 여기 없습니다. */
export const STREAM_VIEW_COPY = {
  streamLabel: "AI 질문 스트림",
  unsavedNotice: "마지막 답변이 저장되지 않았습니다.",
  retrySave: "다시 저장",
  staleNotice: "다른 탭에서 이 인터뷰가 변경됐습니다.",
  loadLatest: "최신 내용 불러오기",
  preparingFirst: "질문을 준비하고 있습니다.",
  preparingNext: "다음 질문을 준비하고 있습니다.",
  viewNewMessages: "새 메시지 보기",
  unreadNotice: "자동 스크롤이 멈춘 사이에 새 내용이 도착했습니다. 맨 아래로 내려가면 자동 스크롤이 다시 시작됩니다.",
  questionTooLong: "이 질문이 너무 길어 대화를 이어갈 수 없습니다.",
  questionTooLongGuidance: (limit: string) =>
    `이 질문이 메시지 하나의 상한인 ${limit}바이트를 넘어 답변할 수 없습니다. 다시 시도하면 지금까지의 대화는 그대로 두고 이 질문만 새로 만듭니다.`,
  retry: "다시 시도",
  endedNotice: "답변 입력을 닫았습니다. 후보 목록으로 돌아가면 이 대화는 완전히 사라집니다.",
  answerLabel: "답변",
  answerPlaceholder: "질문에 답하세요. 코드 블록을 써도 좋습니다.",
  answerTooLong: (bytes: string, limit: string) =>
    `답변이 메시지 하나의 크기 상한을 넘었습니다. 지금 ${bytes}바이트이고 상한은 ${limit}바이트입니다. 줄바꿈과 코드 블록도 크기에 포함됩니다.`,
  answerReady: "답변을 보내면 지금까지의 대화를 바탕으로 다음 질문을 만듭니다.",
  answerWaiting: "질문이 모두 도착하면 답변을 쓸 수 있습니다.",
  send: "전송",
  /** 이력에서 빠진 구간을 그 자리에 알립니다. 대화 밖에 두면 어느 대목이 빠졌는지 알 수 없습니다. */
  trimNotice: (pairs: string) =>
    `대화가 길어져 다음 질문과 함께 보내는 이력에서 여기부터 ${pairs}를 뺐습니다. 그 부분은 화면에 그대로 남지만 AI는 더 이상 보지 않습니다. 첫 질문과 답변, 그리고 최근 턴은 그대로 보냅니다.`,
} as const;

export const INTERVIEW_SCREEN_COPY = {
  back: "← 뒤로",
  interviewTab: "인터뷰",
  workspaceView: "워크스페이스 보기",
  resizeCodePanel: "코드 패널 폭 조절",
  resizePaarPanel: "PAAR 패널 폭 조절",
  representativeCommit: (shortSha: string) => `대표 커밋 ${shortSha}`,
  /** 저장되는 인터뷰는 나가도 사라지지 않으므로 "아무것도 저장되지 않는다"고 말하면 안 됩니다. */
  leaveSaved:
    "후보 목록으로 돌아가면 이 대화는 여기서 닫힙니다. 저장된 내용은 왼쪽 Interviews에 남아 나중에 다시 이어갈 수 있습니다. 쓰던 답변은 사라집니다.",
  leaveUnsaved:
    "후보 목록으로 돌아가면 이 대화가 완전히 사라집니다. 쓰던 답변과 PAAR 블록도 함께 사라집니다. 페이지를 새로 고쳐도 마찬가지입니다. 이 화면의 내용은 저장되지 않습니다.",
  unsavedTurns: (count: number) =>
    count === 1
      ? "이미 보낸 답변 1개가 아직 저장되지 않아 함께 사라집니다."
      : `이미 보낸 답변 ${count}개가 아직 저장되지 않아 함께 사라집니다.`,
  leaveConfirm: "후보 목록으로",
  stay: "인터뷰 계속하기",
} as const;

/** PAAR 카드의 네 상태입니다. 상태 라벨과 빈 자리 문구를 함께 둡니다. */
export const PAAR_CARD_STATE_COPY = {
  pending: "시작 전",
  collecting: "수집 중",
  filled: "채움",
  unfilled: "비어 있음",
} as const;

/**
 * 카드가 비어 있을 때의 문구입니다. 무엇이 아직 안 일어났는지가 아니라 무엇을 하면 채워지는지를
 * 말합니다. 레퍼런스 `paar-interview-workspace.md`가 "대화에 답하면 오른쪽 PAAR이 채워진다"를
 * 화면의 목표로 정합니다.
 */
export const PAAR_CARD_EMPTY_COPY = {
  pending: "대화를 진행하면 AI가 이 블록을 채웁니다.",
  collecting: "AI가 마지막 답변을 이 블록에 반영하고 있습니다.",
  filled: "",
  unfilled: "이 블록은 채우지 못한 채 인터뷰가 끝났습니다.",
} as const;

/**
 * 답변이 블록에 반영되지 않은 이유입니다. 다시 시도하면 풀릴 일인지 아닌지를 가리는 것이 목적입니다.
 * 분류를 다 적지 않습니다. 없는 분류에는 `PAAR_PANEL_COPY.updateUnfinished`가 나갑니다.
 */
export const BLOCK_UPDATE_ERROR_CAUSE: Partial<Record<BlockUpdateFetchErrorKind, string>> = {
  network: "서버에 연결하지 못했습니다.",
  llm_network: "블록 갱신 서비스에 연결하지 못했습니다.",
  llm_timeout: "갱신이 제한 시간 안에 끝나지 않았습니다.",
  llm_rate_limit: "블록 갱신 서비스가 호출 한도에 걸렸습니다.",
  llm_failure: "블록 갱신 서비스가 응답하지 않았습니다.",
  llm_request: "블록 갱신 서비스가 요청을 받아들이지 않았습니다.",
  // 설정 문제는 다시 시도해도 같은 결과입니다. 사용자가 아니라 서버가 고쳐야 한다고 분명히 적습니다.
  llm_auth: "블록 갱신 서비스 인증에 실패했습니다. 서버 설정 문제입니다.",
  llm_configuration: "블록 갱신 서비스 설정이 잘못되었습니다. 서버 설정 문제입니다.",
  unauthorized: "로그인 세션이 더 이상 유효하지 않습니다. 다시 로그인해 주세요.",
  // 모델 출력이 흔들린 경우입니다. 같은 답변으로 다시 시도하면 통과할 수 있습니다.
  block_update_rejected: "모델 출력이 검증을 통과하지 못했습니다.",
  schema_validation: "모델 출력이 검증을 통과하지 못했습니다.",
  json_parse: "모델 출력을 읽지 못했습니다.",
  unknown_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unrelated_sha: "모델이 이 경험의 근거에 없는 커밋을 인용했습니다.",
  unknown_file_path: "모델이 이 경험의 근거에 없는 파일을 인용했습니다.",
  history_too_large: "이 대화가 길어 한 번의 갱신 요청에 담을 수 없습니다.",
  claims_too_large: "이 경험의 블록이 커서 한 번의 갱신 요청에 담을 수 없습니다.",
  body_too_large: "요청이 커져 보낼 수 없습니다.",
  server_error: "서버 설정 문제로 요청을 처리하지 못했습니다.",
};

export const PAAR_PANEL_COPY = {
  cardNotReflected: "이 블록을 겨냥한 답변이 아직 반영되지 않았습니다.",
  unreflected: "마지막 답변이 아직 반영되지 않았고, 그래서 저장도 되지 않았습니다.",
  updateUnfinished: "블록 갱신이 끝나지 않았습니다.",
  retrying: "다시 시도 중…",
  retry: "다시 시도",
  readyToFinish: "더 물을 질문이 없습니다. 원하는 때에 인터뷰를 완료할 수 있습니다.",
  /** 끝내면 답변 입력이 닫힙니다. 저장되는 인터뷰만 나중에 블록을 고칠 수 있습니다. */
  endConfirmSaved:
    "인터뷰를 끝내면 답변 입력이 닫히고 대화는 읽기 전용이 됩니다. 쓰던 답변은 사라집니다. 인터뷰는 왼쪽 Interviews에 남아 있고, 거기서 다시 열어 PAAR 블록을 고칠 수 있습니다.",
  endConfirmUnsaved:
    "인터뷰를 끝내면 답변 입력이 닫히고 대화는 읽기 전용이 됩니다. 쓰던 답변은 사라집니다. 이 인터뷰는 저장되지 않으므로 PAAR 블록은 지금 상태로 남고 나중에 고칠 수 없습니다. 후보 목록으로 돌아가면 대화도 함께 사라지고 다시 이어갈 수 없습니다.",
  end: "인터뷰 완료",
  stay: "인터뷰 계속하기",
} as const;

/** 파일 행의 한 글자 표시 옆에 시각적으로 숨겨 두는 상태 이름입니다. */
export const FILE_STATUS_LABEL: Record<EvidenceFileStatus, string> = {
  added: "추가됨",
  modified: "수정됨",
  deleted: "삭제됨",
};

/** patch 본문이 없는 이유입니다. 예산 소진과 GitHub 미제공은 사용자에게 뜻이 다릅니다. */
export const PATCH_OMITTED_COPY: Record<EvidencePatchOmittedReason, string> = {
  budget_exhausted: "근거 입력 한도를 모두 써서 이 파일의 diff 본문을 싣지 못했습니다.",
  not_provided: "GitHub이 이 파일의 patch를 제공하지 않았습니다.",
};

/** mono 섹션 라벨(`Code / Evidence`, `Files`, `Diff`, `File`, `Selected file`)은 영어로 남아 여기 없습니다. */
export const CODE_PANEL_COPY = {
  viewModeLabel: "보기 모드",
  fileModeUnavailable: "— 쓸 수 없습니다. 근거 스냅샷에는 변경 patch만 실려 있고 파일 전체 원문은 없습니다.",
  expandFiles: "파일 목록 펼치기",
  collapseFiles: "파일 목록 접기",
  budgetTrimmed: (maxTokens: string, patchBytes: string) =>
    `근거 입력 한도 추정치 ${maxTokens} tokens에 맞추려고 코드 변경을 줄였습니다. 실제로 실은 patch는 ${patchBytes} bytes입니다.`,
  unverifiableHeading: "Repository에서 확인할 수 없는 것",
  unverifiableIntro: "아래 항목은 커밋과 diff로 확인할 수 없습니다. 인터뷰에서 사용자가 직접 설명해야 하는 지점입니다.",
  previousCommit: "이전 커밋",
  nextCommit: "다음 커밋",
  commitNotIndexed: "커밋 색인에서 찾지 못했습니다. 제목, 메시지, PR 정보를 확인할 수 없습니다.",
  noPatchBody: "이 커밋에는 이 파일의 diff 본문이 없습니다.",
  diffTruncated: "이 diff는 잘렸습니다. 보이는 내용이 이 파일의 변경 전체가 아닙니다.",
} as const;

/** 사용자 주장과 저장소 관찰이 어긋난 상태입니다. 문장 안이 아니라 밖에 그립니다(설계 8절). */
export const CONFLICT_MARK = "근거와 어긋납니다 · 확인이 필요합니다";

/** 스트림 전송 자체가 실패했을 때입니다. 화면이 `error.message`로 그대로 그립니다. */
export const TRANSPORT_MESSAGE: Record<InterviewStreamTransportErrorKind, string> = {
  stream_connect_failed: "질문 스트림을 열지 못했습니다.",
  stream_interrupted: "질문이 도착하는 중에 연결이 끊어졌습니다.",
};

export const GENERATION_EMPTY_MESSAGE = "질문을 만들지 못했습니다.";

/** 질문 요청 본문 검증과 스트림 라우트가 내려보내는 문구입니다. 화면이 그대로 그립니다. */
export const QUESTION_REQUEST_COPY = {
  invalidSnapshot: "근거 스냅샷 형식이 올바르지 않습니다.",
  invalidHistory: "대화 이력 형식이 올바르지 않습니다.",
  historyShape:
    "대화 이력은 질문으로 시작해 질문과 답변이 번갈아 나오고 답변으로 끝나야 하며 빈 항목이 없어야 합니다.",
  historyTooManyItems: (limit: number) => `대화 이력은 최대 ${limit}개 항목까지만 담을 수 있습니다.`,
  historyItemTooLarge: (limit: number) => `질문과 답변은 각각 최대 ${limit}바이트까지만 담을 수 있습니다.`,
  invalidScenario: "scenario 값이 올바르지 않습니다.",
  invalidLastEventId: "Last-Event-ID 값이 올바르지 않습니다.",
  noResume: "질문 생성 스트림은 이어받기를 지원하지 않습니다. Last-Event-ID 없이 다시 요청해 주세요.",
  unauthorized: "GitHub 로그인 세션이 필요합니다.",
  serverMisconfigured: "서버 설정 문제로 질문 생성을 시작하지 못했습니다.",
  invalidJson: "요청 본문은 JSON이어야 합니다.",
  evidenceTooLarge: "질문 근거가 한 번의 요청에 담을 수 있는 크기를 넘었습니다.",
  targetPairRequired: "대상 블록과 대상 요소는 함께 있거나 함께 없어야 합니다.",
  invalidTarget: "대상 블록이나 대상 요소가 올바르지 않습니다.",
  invalidLastOutcome: "직전 처리 결과 형식이 올바르지 않습니다.",
  generationFailed: "질문 생성에 실패했습니다.",
} as const;

/**
 * LLM 호출 실패를 옮긴 문구입니다. `${context}` 자리에는 받침으로 끝나는 한국어 명사가 들어갑니다
 * (`질문 생성`, `블록 갱신`). 문구가 `이`·`에` 조사를 붙이기 때문입니다.
 */
export const LLM_ERROR_COPY = {
  apiKeyMissing: "LLM API 키가 설정되지 않았습니다.",
  authFailed: "LLM 인증에 실패했습니다.",
  rateLimit: "LLM 호출 한도에 걸렸습니다.",
  evidenceTooLarge: "질문 근거가 LLM이 받을 수 있는 크기를 넘습니다.",
  modelMisconfigured: "LLM 모델 설정이 올바르지 않습니다.",
  temporarilyUnavailable: "질문 생성 서비스를 일시적으로 쓸 수 없습니다.",
  rejected: "LLM이 요청을 거절했습니다.",
  unreachable: "LLM에 연결하지 못했습니다.",
  timedOut: (context: string) => `${context}이 제한 시간 안에 끝나지 않았습니다.`,
  failed: (context: string) => `${context}에 실패했습니다.`,
} as const;

/** `mapInterviewLlmError`에 넘기는 작업 이름입니다. 조사가 붙으므로 받침으로 끝나야 합니다. */
export const LLM_ERROR_CONTEXT = {
  questionGeneration: "질문 생성",
  blockUpdate: "블록 갱신",
} as const;

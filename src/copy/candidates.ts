import {
  CHOOSE_ANOTHER_REPOSITORY,
  SECTION_EXPERIENCE,
  SECTION_REPOSITORY_EVIDENCE,
  SECTION_TECHNICAL_TOPICS,
  SECTION_WHY_WORTH_DISCUSSING,
} from "./shared";
import type { EvidenceSnapshotFailureReason, VerifiabilityStatus } from "@/features/experience-candidates/types";
import type { WorkUnitSignal } from "@/features/experience-candidates/work-unit-score";
import type { WorkUnitSelectionExclusionReason } from "@/features/experience-candidates/work-unit-selection";

/**
 * 근거 구분 태그입니다. 영어로 남깁니다. mono로 그리는 developer metadata이고, 레퍼런스
 * `TRANSLATIONS.ko`도 이 항목은 번역하지 않습니다.
 */
export const VERIFIABILITY_LABEL: Record<VerifiabilityStatus, string> = {
  verified: "Verified",
  unverifiable: "Unverifiable",
};

export const AI_SELECTION_LABEL = "AI-selected";

/** LLM이 작성한 evidence 문장 전체는 Repository 값이 아니라 해석이므로 확인 불가입니다. */
export const EVIDENCE_VERIFIABILITY_NOTICE = `${VERIFIABILITY_LABEL.unverifiable} · AI가 해석한 내용입니다`;

/** 화면에 이미 표시하는 항목 중 GitHub 응답 값이거나 서버 검증을 통과한 관계임을 알리는 문구입니다. */
export const REPOSITORY_VERIFIED_NOTICE = `${VERIFIABILITY_LABEL.verified} · 변경 파일, 코드 변경, PR 정보는 Repository에서 확인했습니다. 관련 커밋은 대표 커밋과 같은 PR에 속하는지만 확인했습니다`;

export const RELATED_COMMITS_VERIFICATION_NOTICE = `${AI_SELECTION_LABEL} · 대표 커밋과 같은 PR에 속하는지만 확인했습니다. 실제로 이 경험과 관련 있는지는 AI가 판단했습니다`;

/**
 * 확인 불가 고정 목록입니다. 인터뷰 단계에서 사용자가 스스로 설명해야 하는 지점을 미리 드러내려고
 * 상세 화면에 항상 표시합니다.
 */
export const REPOSITORY_UNVERIFIABLE_ITEMS: readonly string[] = [
  "성능이 얼마나 개선됐는지",
  "사용자에게 어떤 영향을 줬는지",
  "다른 방법과 어떻게 비교했는지",
  "함께 결정한 과정",
  "커밋 메시지에 적힌 수치, 비교, 의도가 실제로 맞았는지",
];

/** 신호를 사용자에게 보여 줄 문구입니다. 점수만 표시하면 왜 위로 올라왔는지 알 수 없습니다. */
export const WORK_UNIT_SIGNAL_COPY: Record<WorkUnitSignal, string> = {
  dependency_added: "새 의존성을 추가했습니다",
  infrastructure_added: "배포나 인프라 설정을 추가했습니다",
  file_rewritten_repeatedly: "같은 파일을 여러 번 크게 다시 썼습니다",
  revert_or_hotfix: "되돌리거나 긴급 수정한 커밋이 있습니다",
  large_refactor: "삭제한 코드가 많습니다",
  performance_or_refactor_prefix: "성능이나 리팩터링 커밋이 들어 있습니다",
  many_commits: "커밋이 많습니다",
  long_span: "여러 날에 걸쳐 작업했습니다",
  many_files: "변경한 파일이 많습니다",
};

/**
 * 묶음이 빠진 사유입니다. **제외 결과만 적습니다.** 화면이 이 문장 뒤에 선택 기준을 이어 붙이므로
 * 기준을 여기서도 말하면 같은 말이 두 번 나옵니다.
 */
export const WORK_UNIT_SELECTION_EXCLUSION_COPY: Record<WorkUnitSelectionExclusionReason, string> = {
  over_input_budget: "이 묶음은 선별에 들지 못했습니다.",
  over_byte_budget: "이 묶음 하나만으로 한 번에 보낼 수 있는 분량을 넘습니다.",
};

export const CANDIDATE_LIST_COPY = {
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  eyebrow: "Candidates",
  found: (count: string) => `${count} 발견`,
  insufficientLabel: "후보가 더 없는 이유: ",
  insufficientTail: "기준을 낮추거나 후보를 임의로 채우지 않습니다.",
  exclusionsHeading: "1차 선별에서 제외됨",
  judgedSummary: (judged: number, total: number) =>
    `Repository가 커서 전체 커밋 묶음 ${total}개 가운데 ${judged}개만 판단했습니다`,
  selectionRule: " 분석할 수 있는 분량 안에서 점수 순으로 골랐고, 점수가 같으면 더 최근 커밋을 우선했습니다.",
  heuristicNotice: " 점수는 자동으로 계산한 참고값이며, Repository에서 확인한 사실이 아닙니다.",
  overBudgetSummary: (count: string) => `한 번에 보낼 수 있는 분량을 넘어 제외한 ${count}`,
  unjudgedSummary: (count: string) => `모델이 판단하지 않은 ${count}`,
  unjudgedReason: "AI가 이 커밋 묶음들을 판단하지 않았습니다. 선별에서 제외한 것은 아닙니다.",
} as const;

export const CANDIDATE_DETAIL_COPY = {
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  eyebrow: SECTION_EXPERIENCE,
  whyHeading: SECTION_WHY_WORTH_DISCUSSING,
  topicsHeading: SECTION_TECHNICAL_TOPICS,
  evidenceHeading: SECTION_REPOSITORY_EVIDENCE,
  verifiedListHeading: "VERIFIED FROM REPOSITORY",
  /** 토픽이 빈 배열로 온 후보의 Empty 표시입니다. 스키마에 필드는 있고 고를 것이 없었다는 뜻입니다. */
  topicsEmpty: "이 후보의 diff와 커밋 메시지에서는 기술 토픽을 찾지 못했습니다.",
  commitNotIndexed: "대표 커밋을 불러온 커밋 목록에서 찾지 못했습니다.",
  showLess: "간단히 보기",
  viewAll: (count: string) => `전체 ${count} 보기 →`,
  backToList: "← 후보 목록으로",
  chooseAnotherRepository: CHOOSE_ANOTHER_REPOSITORY,
  startInterview: "인터뷰 시작",
  /**
   * 인터뷰를 시작하면 그 시점의 근거 스냅샷이 서버에 저장되고, 거기에는 커밋 메시지와 파일 경로와
   * 코드 변경 내용이 들어갑니다. 비공개 저장소라면 그 코드가 서버에 남습니다(이슈 #116 Goal 셋째
   * 항목).
   *
   * 이 자리에 두는 이유는 여기가 실제로 저장이 일어나는 시점이기 때문입니다. 로그인 화면에 두면
   * 저장이 일어나기 한참 전이라 읽고 잊습니다. 보관 기간을 함께 적어 "무기한 남는 것은 아니다"까지
   * 한 문장으로 말합니다.
   *
   * **줄이면 안 되는 것이 셋입니다.** 무엇이 저장되는지(커밋 메시지·파일 경로·코드 변경), 비공개
   * Repository의 코드도 포함된다는 것, 보관 기간입니다. 이 셋을 빼면 고지가 아니게 됩니다.
   * 다듬은 것은 `저장`이 세 번 나오던 반복과, 기간을 문장 뒤에 숨기던 어순뿐입니다.
   */
  storageNotice: (days: number) =>
    `인터뷰를 시작하면 이 근거를 서버에 저장합니다. 커밋 메시지와 파일 경로, 코드 변경 내용이 담기고 비공개 Repository의 코드도 포함됩니다. ${days}일 동안 열지 않으면 자동으로 지워집니다.`,
} as const;

/** 색인에서 커밋을 못 찾았을 때 제목 자리에 쓰는 대체 문구입니다. */
export const COMMIT_NOT_INDEXED_TITLE = (shortSha: string) => `목록에 없는 커밋 · ${shortSha}`;

/**
 * 근거 스냅샷을 만들지 못한 이유별 안내입니다. master-detail에서는 목록이 항상 상세와 함께 보이므로
 * "뒤로가기"가 화면 이동이 아니라 이 안내를 닫는 것뿐입니다. 문구도 그에 맞춥니다.
 */
export const EXPERIENCE_SELECTION_ERROR_COPY: Record<
  EvidenceSnapshotFailureReason,
  { readonly title: string; readonly message: string }
> = {
  representative_commit_not_indexed: {
    title: "이 경험으로는 인터뷰를 시작할 수 없습니다",
    message:
      "대표 커밋을 불러온 커밋 목록에서 찾지 못해 제목, 메시지, PR 정보, 변경 파일을 근거로 쓸 수 없습니다. 후보 목록에서 다른 경험을 선택해 주세요.",
  },
  no_repository_evidence: {
    title: "이 경험으로는 인터뷰를 시작할 수 없습니다",
    message:
      "대표 커밋과 관련 커밋 어디에도 변경 파일이 없어 물어볼 코드가 없습니다. 후보 목록에서 다른 경험을 선택해 주세요.",
  },
  evidence_input_too_large: {
    title: "이 경험의 근거가 한 번에 분석할 수 있는 분량을 넘습니다",
    message:
      "코드 변경을 빼고 커밋 메시지와 변경 파일 목록만으로도 한도를 넘습니다. 후보 목록에서 다른 경험을 선택해 주세요.",
  },
};

/**
 * 후보 생성 응답이 계약을 어겼을 때의 문구입니다. 라우트가 `error.message`로 내려보내고 분석 화면이
 * 그대로 그립니다.
 */
export const CANDIDATE_CONTRACT_COPY = {
  schemaMismatch: "AI가 보낸 경험 후보의 형식을 확인할 수 없습니다.",
  duplicateSha: "대표 커밋 SHA는 후보마다 서로 달라야 합니다.",
  reasonRequired: "후보가 없으면 그 이유도 함께 받아야 합니다.",
  unknownShas: (shas: string) => `입력에 없는 커밋 SHA가 들어 있습니다: ${shas}`,
  unrelatedShas: (shas: string) => `대표 커밋과 같은 PR에 속하지 않는 관련 SHA가 있습니다: ${shas}`,
  unknownPaths: (paths: string) => `Repository 근거에 없는 파일 경로를 인용했습니다: ${paths}`,
  validationFailed: "AI가 보낸 경험 후보를 확인하지 못했습니다.",
} as const;

/** 후보 생성 요청 자체가 실패했을 때입니다. */
export const CANDIDATE_REQUEST_COPY = {
  network: "후보 생성 서버에 연결하지 못했습니다.",
  unreadableResponse: "후보 생성 응답을 읽지 못했습니다.",
  unknown: "후보 생성 요청에 실패했습니다.",
  stageAInputTooLarge: "1차 선별에 보낼 내용이 너무 많습니다. 기여 내용이 길면 줄여 주세요.",
  stageAInvalidResponse: "1차 선별 결과를 확인할 수 없습니다.",
  stageAOverLimit: (limit: number) => `1차 선별에서 최대 ${limit}개보다 많은 후보가 왔습니다.`,
  stageBInvalidResponse: "최종 선별 결과를 확인할 수 없습니다.",
} as const;

/** 후보 생성 라우트가 직접 내려보내는 문구입니다. */
export const CANDIDATE_ROUTE_COPY = {
  unauthorized: "GitHub 로그인 세션이 필요합니다.",
  bodyTooLarge: "한 번에 보낼 수 있는 4.5MB를 넘었습니다.",
  invalidJson: "보낸 내용을 읽을 수 없습니다.",
  stageAInvalid: "1차 선별에 필요한 정보가 빠졌거나 올바르지 않습니다.",
  stageAContributionTooLong: "기여 내용이 너무 깁니다. 내용을 줄여 주세요.",
  stageAFailed: "1차 선별에 실패했습니다.",
  stageAUnfinished: (count: number) => `커밋 묶음 ${count}개는 세 번 확인했지만 판단을 마치지 못했습니다.`,
  stageBInvalid: "최종 선별에 필요한 정보가 빠졌거나 올바르지 않습니다.",
  stageBFailed: "최종 선별에 실패했습니다.",
  stageBTimeBudget: "최종 선별이 제한 시간 안에 끝나지 않았습니다.",
  stageASelectedNone: "1차 선별에서 경험 후보를 찾지 못했습니다.",
  /**
   * 하루 분석 횟수 상한에 닿았을 때입니다(이슈 #142). 초기화 기준이 한국 자정이라 해제 시점을
   * 문구 안에서 "내일"이라고만 말합니다. 응답은 `kind`와 `message`와 `retryable`만 싣습니다.
   * 정확한 시각을 싣던 `resetAt`은 어느 화면도 읽지 않아 걷어냈습니다.
   */
  dailyLimitExceeded: (limit: number) =>
    `오늘 분석할 수 있는 ${limit}번을 모두 썼습니다. 내일 다시 분석할 수 있습니다.`,
} as const;

/**
 * LLM 연결 설정이 어긋났을 때입니다. `llm-provider.ts`가 후보 생성, 블록 갱신, 질문 생성 셋 모두의
 * 모델을 만들므로 이 문구는 분석 화면과 인터뷰 화면 양쪽에 그려집니다. 환경변수 이름은 사용자가
 * 아니라 서버를 고치는 사람이 읽는 값이라 영어 그대로 둡니다.
 */
export const LLM_PROVIDER_COPY = {
  localModelMissing: (envName: string) =>
    `NEXT_PUBLIC_LLM_BASE_URL을 설정하면 ${envName}도 함께 설정해야 합니다.`,
} as const;

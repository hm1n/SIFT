import {
  CHANGE_REPOSITORY,
  CHOOSE_ANOTHER_REPOSITORY,
  CONTINUE_INTERVIEW,
  GITHUB_UNREACHABLE,
  NO_REPOSITORY_SELECTED,
} from "./shared";
import type { GitHubFetchErrorKind } from "@/lib/github/errors";

export const REPOSITORY_SELECT_COPY = {
  eyebrow: "Repository 선택",
  title: "분석할 Repository를 선택하세요.",
  searchPlaceholder: "Repository 이름 검색",
  searchLabel: "Repository 검색",
  noMatch: "검색 결과가 없습니다. 다른 검색어를 입력해 보세요.",
  contributionHelp: "프로젝트에서 어떤 일을 주로 맡았는지 알려주세요.",
  contributionPlaceholder: "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다.",
  noSelection: NO_REPOSITORY_SELECTED,
  analyze: "분석하기",
  /** 목록을 읽는 중입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
  loadingLabel: "GitHub에서 Repository 목록을 불러오는 중…",
  /** 목록이 비었을 때입니다. */
  emptyLabel: "불러온 Repository가 없습니다.",
  emptySub: "GitHub 계정에 Repository가 있는지 확인해 주세요.",
  /** 인증이 끊긴 경우입니다. 다시 시도로 풀리지 않아 다시 로그인을 안내합니다. */
  authErrorLabel: GITHUB_UNREACHABLE,
  authErrorSub: "GitHub 세션이 더 이상 유효하지 않습니다. 다시 로그인해 주세요.",
  logInAgain: "다시 로그인",
  /** 그 밖의 조회 실패입니다. 제목은 고정하고 sub만 원인별로 갈립니다. */
  fetchErrorLabel: "Repository 목록을 불러올 수 없습니다.",
  tryAgain: "다시 시도",
} as const;

export const REPOSITORY_FETCH_ERROR_SUB: Record<Exclude<GitHubFetchErrorKind, "auth_revoked">, string> = {
  rate_limit: "GitHub 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.",
  network: "서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
  repo_not_found: "Repository 정보를 찾지 못했습니다. 다시 불러와 주세요.",
  server_error: "GitHub 서버가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  partial_failure: "Repository 목록을 일부만 불러왔습니다. 다시 시도해 주세요.",
};

/**
 * 분석 중 체크리스트의 6단계입니다. 순서는 `route-client.ts`의 `fetchContributionsFromApi`가 실제로
 * 보고하는 순서와 같습니다. 단계 키를 바꾸면 `repository-analysis-view.tsx`의 매핑도 함께 고쳐야 합니다.
 */
export const ANALYSIS_CHECKLIST_COPY = {
  commits: "커밋 히스토리 불러오는 중",
  commit_details: "커밋 상세 불러오는 중",
  repository_metadata: "Repository 정보 불러오는 중",
  deriving: "선별 기준 계산 중",
  stage_a: "경험 후보 찾는 중",
  stage_b: "후보 확정 중",
} as const;

/**
 * 체크리스트 항목마다 시각적으로 숨겨 두는 상태 문구입니다. 기호는 `aria-hidden`이라 이 문구가 없으면
 * 스크린리더에 여섯 항목이 똑같이 나열됩니다(PR #105 Codex 리뷰 P1).
 */
export const CHECKLIST_STATUS_COPY = {
  done: "완료:",
  active: "진행 중:",
  pending: "대기:",
} as const;

/**
 * 저장된 분석을 찾는 동안과 찾지 못했을 때입니다(이슈 #116). `code`는 mono 상태 코드라 영어로 남습니다.
 *
 * 실패했을 때 새 분석을 자동으로 시작하지 않는 이유를 함께 적습니다. 이유를 빼면 "왜 아무 일도 안
 * 일어나지"가 되고, 사용자가 같은 버튼을 반복해 누릅니다.
 */
export const SAVED_ANALYSIS_LOOKUP_COPY = {
  loadingLabel: "저장된 분석을 찾는 중…",
  loadingSub: "전에 분석한 Repository라면 새로 분석하지 않고 저장된 결과를 엽니다.",
  missingLabel: "저장된 분석이 더 이상 없습니다.",
  missingSub: (days: number) =>
    `열지 않은 채 ${days}일이 지나 지워졌습니다. 이 Repository를 다시 분석할 수 있습니다.`,
  analyzeAgain: "이 Repository 분석하기",
  failedLabel: "저장된 분석이 있는지 확인하지 못했습니다.",
  failedSub: "이 프로젝트가 함께 쓰는 하루 AI 요청이 얼마 되지 않아 새 분석을 자동으로 시작하지 않았습니다.",
  tryAgain: "다시 시도",
} as const;

/**
 * 저장된 분석을 보고 있다는 알림입니다. 저장 시점을 문장 가운데 `<time>`으로 그리므로 앞뒤를 나눠
 * 둡니다. `SAVED`는 mono 상태 코드라 영어로 남습니다.
 */
export const SAVED_ANALYSIS_NOTICE_COPY = {
  savedOnBefore: "저장된 ",
  savedOnAfter: " 분석입니다. 그 뒤에 올린 커밋은 이 목록에 없습니다.",
  /** 기여 내용을 새로 적고 들어왔는데 저장본을 열었을 때입니다. 적은 것이 쓰이지 않았다고 분명히 알립니다. */
  unusedContribution: " 방금 적은 기여 내용은 반영되지 않았습니다. 반영하려면 다시 분석해 주세요.",
  reanalyze: "다시 분석",
} as const;

export const ANALYSIS_COPY = {
  eyebrow: "Repository 분석 중",
  changeRepository: CHANGE_REPOSITORY,
  chooseAnother: CHOOSE_ANOTHER_REPOSITORY,
  logInAgain: "GitHub에 다시 로그인",
  retryCandidates: "후보 생성 다시 시도",
  retryAll: "분석 전체 다시 시도",
} as const;

/** 분석이 후보를 하나도 내지 못한 경우입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
export const ANALYSIS_EMPTY_COPY = {
  no_commits: {
    code: "No Commits",
    label: "기본 브랜치에 커밋이 없습니다.",
    description: "커밋이 있는 Repository를 선택해 주세요.",
  },
  no_author_commits: {
    code: "No Author Commits",
    label: "로그인한 GitHub 계정으로 작성한 커밋이 없습니다.",
    description:
      "기본 브랜치에 커밋은 있지만 지금 로그인한 GitHub 계정이 작성한 커밋이 없습니다. 직접 작성한 커밋이 있는 Repository를 선택해 주세요.",
  },
  no_analyzable_commits: {
    code: "No Analyzable Commits",
    label: "분석할 커밋이 남지 않았습니다.",
    description:
      "병합, 문서, 의존성, 오타, 서식만 바꾼 커밋을 제외하니 분석할 커밋이 남지 않았습니다. 커밋 히스토리가 있는 다른 Repository를 선택해 주세요.",
  },
  no_stage_a_candidates: {
    code: "No Candidates",
    label: "설명할 가치가 있는 경험 후보를 찾지 못했습니다.",
    description:
      "입력한 기여 내용, 커밋 메시지, 변경 규모를 기준으로 경험 후보를 찾지 못했습니다. 다른 Repository를 선택해 주세요.",
  },
  no_final_candidates: {
    code: "No Final Candidates",
    label: "최종 경험 후보를 만들지 못했습니다.",
    description: "기준을 낮추거나 후보를 임의로 채우지 않습니다. 다른 Repository를 선택해 주세요.",
  },
} as const;

/** GitHub 조회가 실패했을 때의 제목과 안내입니다. 화면은 `StatusScreen`의 label과 sub로 그립니다. */
export const GITHUB_FETCH_ERROR_COPY: Record<
  Exclude<GitHubFetchErrorKind, "partial_failure">,
  { readonly title: string; readonly message: string }
> = {
  rate_limit: {
    title: "GitHub 요청 한도에 도달했습니다.",
    message: "제한이 풀릴 때까지 기다린 뒤 전체 조회를 다시 시도해 주세요.",
  },
  auth_revoked: {
    title: "GitHub에 다시 로그인해 주세요.",
    message: "로그인이 만료됐거나 GitHub 권한이 취소됐습니다. 다시 로그인하면 조회를 이어갈 수 있습니다.",
  },
  repo_not_found: {
    title: "Repository를 찾을 수 없습니다.",
    message: "Repository가 삭제됐거나 이름이 바뀌었는지, 로그인한 계정으로 접근할 수 있는지 확인해 주세요.",
  },
  network: {
    title: "GitHub에 연결하지 못했습니다.",
    message: "네트워크 연결을 확인한 뒤 전체 조회를 다시 시도해 주세요.",
  },
  server_error: {
    title: "GitHub에서 데이터를 불러오지 못했습니다.",
    message: "GitHub 서버 문제일 수 있습니다. 잠시 후 전체 조회를 다시 시도해 주세요.",
  },
};

/** 일부만 모으고 실패한 경우입니다. 어디까지 모았는지와 최초 원인을 함께 알립니다. */
export const PARTIAL_FETCH_COPY = {
  title: "Repository 데이터를 일부만 수집했습니다.",
  detailRange: (completed: number, total: number) =>
    `상세 조회 중 ${total}건 가운데 ${completed}건까지 모은 뒤 실패했습니다.`,
  commitRange: (completed: number) => `커밋 ${completed}건까지 모은 뒤 실패했습니다.`,
  cause: (causeTitle: string) => ` 처음 실패한 이유: ${causeTitle}`,
  guidance: " 중복이나 누락을 막기 위해 일부 결과는 쓰지 않습니다. 문제가 해결되면 조회를 처음부터 다시 시작합니다.",
} as const;

/** Stage B의 diff·PR 재조회가 실패한 원인별 안내입니다. */
export const DIFF_REFETCH_GUIDANCE: Record<Exclude<GitHubFetchErrorKind, "partial_failure">, string> = {
  rate_limit: "GitHub 요청 한도가 풀린 뒤 후보 생성을 다시 시도해 주세요.",
  auth_revoked: "로그인이 만료되었거나 권한이 회수되었습니다. GitHub에 다시 로그인해 주세요.",
  repo_not_found: "Repository가 삭제됐거나 이름이 바뀌었는지 확인한 뒤 다시 선택해 주세요.",
  network: "네트워크 연결을 확인한 뒤 후보 생성을 다시 시도해 주세요.",
  server_error: "GitHub 서버 문제일 수 있습니다. 잠시 후 후보 생성을 다시 시도해 주세요.",
};

/** 후보 생성이 실패했을 때입니다. 갈래마다 사용자가 할 수 있는 일이 다릅니다. */
export const CANDIDATE_GENERATION_ERROR_COPY = {
  unknown: {
    title: "경험 후보를 만들지 못했습니다",
    message: "예기치 못한 오류가 발생했습니다. 후보 생성을 다시 시도해 주세요.",
  },
  diffRefetch: {
    title: "후보의 diff와 PR 근거를 다시 조회하지 못했습니다",
    message: (guidance: string) => `최종 판단에 쓸 diff와 PR 정보를 GitHub에서 수집하지 못했습니다. ${guidance}`,
  },
  schemaViolation: {
    title: "AI가 보낸 결과를 확인할 수 없습니다",
    message: (detail: string) => `${detail} 결과 형식을 확인할 수 없어 사용하지 않았습니다. 후보 생성을 다시 시도해 주세요.`,
  },
  hallucinationRejected: {
    title: "Repository에서 확인할 수 없는 근거가 있어 결과를 쓰지 않았습니다",
    message: (detail: string) =>
      `${detail} 입력에 없는 커밋이나 파일을 인용한 결과는 쓰지 않습니다. 후보 생성을 다시 시도해 주세요.`,
  },
  stageBTimeout: {
    title: "최종 선별이 끝나지 않았습니다",
    message:
      "GitHub에서 diff와 PR을 다시 확인하는 동안 제한 시간을 넘겼습니다. AI 분석 자체는 끝났을 수 있습니다. 잠시 후 후보 생성을 다시 시도해 주세요.",
  },
  llmTimeout: {
    title: "AI 분석이 끝나지 않았습니다",
    message: "잠시 후 후보 생성을 다시 시도해 주세요.",
  },
  llmRateLimit: {
    title: "AI 요청 한도에 도달했습니다",
    message: "호출 한도가 풀린 뒤 후보 생성을 다시 시도해 주세요.",
  },
  llmConfiguration: {
    title: "서비스 설정으로 AI에 연결할 수 없습니다",
    message: "사용자가 해결할 수 없는 문제입니다. 서버 설정을 고쳐야 합니다.",
  },
  llmCallFailure: {
    title: "AI 호출에 실패했습니다",
    message: (detail: string) => `${detail} 잠시 후 후보 생성을 다시 시도해 주세요.`,
  },
  requestTooLarge: {
    title: "한 번에 분석할 수 있는 분량을 넘었습니다",
    message: "수집한 커밋 근거가 한 번의 요청에 담을 수 있는 크기를 넘었습니다. 커밋 수가 더 적은 Repository를 선택해 주세요.",
  },
  network: {
    title: "후보 생성 서버에 연결하지 못했습니다",
    message: "네트워크 연결을 확인한 뒤 후보 생성을 다시 시도해 주세요.",
  },
  contractViolation: {
    title: "후보 생성 요청을 처리할 수 없습니다",
    message: (detail: string) =>
      `${detail} 다시 시도하면 Repository 조회부터 새로 시작합니다. 같은 오류가 반복되면 서버를 고쳐야 합니다.`,
  },
  fallback: (detail: string) => `${detail} 후보 생성을 다시 시도해 주세요.`,
} as const;

/** 저장된 인터뷰를 열지 못한 경우입니다. 없어진 인터뷰와 연결 실패는 사용자가 할 일이 다릅니다. */
export const RESUME_ERROR_COPY = {
  not_found: {
    code: "ERROR / NOT FOUND",
    label: "이 인터뷰를 찾을 수 없습니다.",
    sub: "삭제되었을 수 있습니다. 왼쪽 Interviews에서 다른 인터뷰를 선택해 주세요.",
  },
  unauthorized: {
    code: "ERROR / AUTH",
    label: "세션이 만료되었습니다.",
    sub: "이 인터뷰를 이어가려면 다시 로그인해 주세요.",
  },
  fallback: {
    code: "ERROR / STORAGE",
    label: "이 인터뷰를 열지 못했습니다.",
    sub: "서버가 응답하지 않았습니다. 잠시 후 다시 시도해 주세요.",
  },
  unreadable: {
    code: "ERROR / STORAGE",
    label: "이 인터뷰를 열지 못했습니다.",
    sub: "저장된 근거나 PAAR 블록을 읽을 수 없습니다. 나머지 저장 내용은 계속 확인할 수 있습니다.",
  },
  loadingLabel: "저장된 인터뷰를 여는 중…",
  backToSummary: "요약으로 돌아가기",
  tryAgain: "다시 시도",
} as const;

/** 저장되지 않은 답변을 두고 화면을 떠날 때 받는 확인입니다. */
export const LEAVE_CONFIRM_COPY = {
  title: "저장되지 않은 답변이 있습니다.",
  description: [
    "지금 나가면 저장되지 않은 답변은 사라집니다. 저장된 내용은 왼쪽 Interviews에서",
    "다시 이어갈 수 있습니다.",
  ].join("\n"),
  leave: "나가기",
  stay: CONTINUE_INTERVIEW,
} as const;

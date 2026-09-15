import type { GitHubFetchErrorKind } from "@/lib/github/errors";

export const REPOSITORY_SELECT_COPY = {
  eyebrow: "Repository 선택",
  title: "분석할 Repository를 선택하세요.",
  searchPlaceholder: "Repository 검색...",
  searchLabel: "Repository 검색",
  noMatch: "검색 결과가 없습니다. 다른 키워드로 다시 검색해보세요.",
  contributionHelp: "프로젝트에서 주로 기여한 내용을 알려주세요.",
  contributionPlaceholder: "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다.",
  noSelection: "선택된 Repository 없음",
  analyze: "분석하기",
  /** 목록을 읽는 중입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
  loadingLabel: "GitHub에서 Repository 목록을 불러오는 중...",
  /** 목록이 비었을 때입니다. */
  emptyLabel: "분석할 수 있는 Repository가 없습니다.",
  emptySub: "GitHub 계정에 Repository가 하나 이상 있는지 확인해 주세요.",
  /** 인증이 끊긴 경우입니다. 다시 시도로 풀리지 않아 다시 로그인을 안내합니다. */
  authErrorLabel: "GitHub에 연결할 수 없습니다.",
  authErrorSub: "GitHub 세션이 더 이상 유효하지 않습니다. 다시 로그인해 주세요.",
  logInAgain: "다시 로그인",
  /** 그 밖의 조회 실패입니다. 제목은 고정하고 sub만 원인별로 갈립니다. */
  fetchErrorLabel: "Repository 목록을 불러올 수 없습니다.",
  tryAgain: "다시 시도",
} as const;

export const REPOSITORY_FETCH_ERROR_SUB: Record<Exclude<GitHubFetchErrorKind, "auth_revoked">, string> = {
  rate_limit: "GitHub rate limit에 걸렸습니다. 잠시 후 다시 시도해 주세요.",
  network: "서버에 연결하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.",
  repo_not_found: "GitHub이 오류를 돌려주었습니다.",
  server_error: "GitHub이 오류를 돌려주었습니다.",
  partial_failure: "GitHub이 오류를 돌려주었습니다.",
};

/**
 * 분석 중 체크리스트의 6단계입니다. 순서는 `route-client.ts`의 `fetchContributionsFromApi`가 실제로
 * 보고하는 순서와 같습니다. 단계 키를 바꾸면 `repository-analysis-view.tsx`의 매핑도 함께 고쳐야 합니다.
 */
export const ANALYSIS_CHECKLIST_COPY = {
  commits: "커밋 히스토리 불러오는 중",
  commit_details: "커밋 상세 불러오는 중",
  repository_metadata: "Repository 메타데이터 불러오는 중",
  deriving: "파생 지표 계산 중",
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

export const ANALYSIS_COPY = {
  eyebrow: "Repository 분석 중",
  changeRepository: "← Repository 변경",
  chooseAnother: "다른 Repository 선택",
  logInAgain: "GitHub에 다시 로그인",
  retryCandidates: "후보 생성 다시 시도",
  retryAll: "분석 전체 다시 시도",
} as const;

/** 분석이 후보를 하나도 내지 못한 경우입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
export const ANALYSIS_EMPTY_COPY = {
  no_commits: {
    code: "No Commits",
    label: "분석할 커밋이 없습니다.",
    description: "기본 브랜치에서 커밋을 찾지 못했습니다. 커밋 히스토리가 있는 Repository를 선택해 주세요.",
  },
  no_author_commits: {
    code: "No Author Commits",
    label: "직접 작성한 커밋을 찾지 못했습니다.",
    description:
      "기본 브랜치에 커밋은 있지만 지금 로그인한 GitHub 계정이 작성한 커밋이 없습니다. 직접 작성한 커밋이 있는 Repository를 선택해 주세요.",
  },
  no_analyzable_commits: {
    code: "No Analyzable Commits",
    label: "이 Repository는 분석하기 어렵습니다.",
    description:
      "커밋은 있지만 merge, 문서, 의존성, 오타, 포매팅 커밋을 제외하면 남는 커밋이 없습니다. 커밋 히스토리가 있는 다른 Repository를 선택해 주세요.",
  },
  no_stage_a_candidates: {
    code: "No Candidates",
    label: "설명할 가치가 있는 경험 후보를 찾지 못했습니다.",
    description:
      "기여 항목과 맞거나 커밋 메시지·변경 규모로 보아 설명할 가치가 있다고 볼 만한 커밋이 없습니다. 다른 Repository를 선택해 주세요.",
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
    title: "GitHub API rate limit에 걸렸습니다.",
    message: "제한이 풀릴 때까지 기다린 뒤 전체 조회를 다시 시도해 주세요.",
  },
  auth_revoked: {
    title: "GitHub에 다시 로그인해 주세요.",
    message: "세션이 만료되었거나 권한이 회수되었습니다. 다시 로그인하면 조회를 이어갈 수 있습니다.",
  },
  repo_not_found: {
    title: "Repository를 찾을 수 없습니다.",
    message: "Repository가 삭제되었거나 이름이 바뀌지 않았는지, 지금 인증으로 접근할 수 있는지 확인해 주세요.",
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
  cause: (causeTitle: string) => ` 최초 실패 원인: ${causeTitle}`,
  guidance: " 중복이나 누락을 막기 위해 일부 결과는 재사용하지 않습니다. 복구하면 조회를 처음부터 다시 시작합니다.",
} as const;

/** Stage B의 diff·PR 재조회가 실패한 원인별 안내입니다. */
export const DIFF_REFETCH_GUIDANCE: Record<Exclude<GitHubFetchErrorKind, "partial_failure">, string> = {
  rate_limit: "GitHub API rate limit이 풀린 뒤 후보 생성을 다시 시도해 주세요.",
  auth_revoked: "로그인이 만료되었거나 권한이 회수되었습니다. GitHub에 다시 로그인해 주세요.",
  repo_not_found: "Repository가 삭제되었거나 이름이 바뀌지 않았는지 확인한 뒤 다시 선택해 주세요.",
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
    title: "AI 응답이 정해진 형식을 따르지 않았습니다",
    message: (detail: string) => `${detail} 형식이 맞지 않는 결과는 쓰지 않습니다. 후보 생성을 다시 시도해 주세요.`,
  },
  hallucinationRejected: {
    title: "Repository 근거에 없는 내용을 인용해 결과를 쓰지 않았습니다",
    message: (detail: string) =>
      `${detail} 입력에 없는 커밋이나 파일을 인용한 결과는 쓰지 않습니다. 후보 생성을 다시 시도해 주세요.`,
  },
  stageBTimeout: {
    title: "Stage B가 제한 시간을 넘겼습니다",
    message:
      "GitHub diff·PR 조회를 포함한 처리 전체가 제한 시간을 넘겼습니다. AI 자체의 실패가 아닐 수 있습니다. 잠시 후 후보 생성을 다시 시도해 주세요.",
  },
  llmTimeout: {
    title: "AI 분석이 제한 시간 안에 끝나지 않았습니다",
    message: "제한 시간 안에 분석이 끝나지 않았습니다. 잠시 후 후보 생성을 다시 시도해 주세요.",
  },
  llmRateLimit: {
    title: "AI 호출 한도에 걸렸습니다",
    message: "호출 한도가 풀린 뒤 후보 생성을 다시 시도해 주세요.",
  },
  llmConfiguration: {
    title: "AI 연결 설정에 문제가 있습니다",
    message: "서비스 쪽 인증이나 설정 문제입니다. 잠시 후 후보 생성을 다시 시도해 주세요.",
  },
  llmCallFailure: {
    title: "AI 호출에 실패했습니다",
    message: (detail: string) => `${detail} 잠시 후 후보 생성을 다시 시도해 주세요.`,
  },
  requestTooLarge: {
    title: "분석 데이터가 요청 한도를 넘었습니다",
    message: "수집한 커밋 근거가 한 번의 요청에 담을 수 있는 크기를 넘었습니다. 커밋 수가 더 적은 Repository를 선택해 주세요.",
  },
  network: {
    title: "후보 생성 서버에 연결하지 못했습니다",
    message: "네트워크 연결을 확인한 뒤 후보 생성을 다시 시도해 주세요.",
  },
  contractViolation: {
    title: "후보 생성 요청이 서버 계약과 맞지 않았습니다",
    message: (detail: string) =>
      `${detail} 같은 입력을 그대로 다시 보내지 않고, 다시 시도하면 Repository 조회부터 새로 만듭니다. 계속 반복되면 사용자가 우회할 수 없는 결함일 수 있습니다.`,
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
    sub: "저장된 근거나 블록을 읽을 수 없습니다. 저장된 내용은 계속 확인할 수 있습니다.",
  },
  loadingLabel: "저장된 인터뷰를 여는 중...",
  backToSummary: "요약으로 돌아가기",
  tryAgain: "다시 시도",
} as const;

/** 저장되지 않은 답변을 두고 화면을 떠날 때 받는 확인입니다. */
export const LEAVE_CONFIRM_COPY = {
  title: "저장되지 않은 답변이 있습니다.",
  description: [
    "지금 나가면 아직 저장되지 않은 답변이 사라집니다. 이미 저장된 내용은 왼쪽 Interviews에",
    "남아 있어 거기서 다시 이어갈 수 있습니다.",
  ].join("\n"),
  leave: "나가기",
  stay: "인터뷰 계속하기",
} as const;

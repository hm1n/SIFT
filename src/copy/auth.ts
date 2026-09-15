/**
 * OAuth 라우트가 `?auth_error=`로 돌려보내는 오류 종류별 안내입니다. 종류는 콜백 라우트와 로그인
 * 라우트가 정합니다. 이슈 #94 Constraint대로 종류를 합쳐 한 문구로 만들지 않습니다.
 */
export const AUTH_ERROR_COPY: Record<string, string> = {
  access_denied: "GitHub 권한 승인을 취소했습니다. 다시 로그인할 수 있습니다.",
  state_mismatch: "로그인 요청을 확인하지 못했습니다. 처음부터 다시 로그인해 주세요.",
  exchange_failed: "GitHub 인증이 끝나지 않았습니다. 잠시 후 다시 시도해 주세요.",
  config_missing: "서버에 GitHub 로그인 설정이 없습니다. 서버 관리자가 설정을 마쳐야 합니다.",
};

export const LOGIN_COPY = {
  title: ["코드를 이야기할 가치가 있는", "경험으로 만듭니다."],
  description: ["GitHub 기록을 분석해 실제 근거로", "기술 면접을 준비합니다."],
  continueWithGitHub: "GitHub으로 계속하기",
  terms: "계속하면 이용약관에 동의하는 것입니다",
  /** 로그인 링크를 누른 뒤의 Loading입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
  authenticatingLabel: "GitHub에 연결 중...",
  authenticatingSub: "권한 승인을 위해 GitHub으로 이동합니다.",
  /** `auth_error` 쿼리가 있을 때의 Error입니다. 원인별 문구는 `AUTH_ERROR_COPY`가 sub에 들어갑니다. */
  errorLabel: "GitHub에 연결할 수 없습니다.",
  tryAgain: "다시 시도",
} as const;

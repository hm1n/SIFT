import { CONNECTING_GITHUB, GITHUB_UNREACHABLE } from "./shared";
/**
 * OAuth 라우트가 `?auth_error=`로 돌려보내는 오류 종류별 안내입니다. 종류는 콜백 라우트와 로그인
 * 라우트가 정합니다. 이슈 #94 Constraint대로 종류를 합쳐 한 문구로 만들지 않습니다.
 */
export const AUTH_ERROR_COPY: Record<string, string> = {
  access_denied: "GitHub 권한 승인을 취소했습니다. 다시 로그인할 수 있습니다.",
  state_mismatch: "로그인 요청을 확인할 수 없습니다. 다시 로그인해 주세요.",
  exchange_failed: "GitHub 로그인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
  config_missing: "GitHub 로그인 설정이 없어 로그인할 수 없습니다. 서버 관리자가 설정을 고쳐야 합니다.",
};

/**
 * 약관 동의 안내 문장입니다. `이용약관`에 링크를 걸어야 해서 조각으로 나눠 둡니다(이슈 #141).
 *
 * 문장을 나눈 것이지 문구를 바꾼 것이 아닙니다. 조각을 이어 붙이면 아래 `terms`와 같고, 그 사실을
 * `login-screen.test.tsx`가 화면에서 읽은 글자로 확인합니다.
 */
const TERMS_SENTENCE = {
  lead: "계속하면 ",
  link: "이용약관",
  tail: "에 동의하는 것입니다",
} as const;

export const LOGIN_COPY = {
  title: ["코드 속에 숨겨진", "경험을 발견하세요"],
  description: ["GitHub의 코드와 커밋을 근거로", "설명할 가치가 있는 개발 경험을 찾아보세요"],
  continueWithGitHub: "GitHub으로 계속하기",
  termsSentence: TERMS_SENTENCE,
  /**
   * 화면이 그리는 문장 전체입니다. 화면은 위 조각으로 그리고 이 값은 두 곳이 씁니다. 레퍼런스 대조
   * 표(`reference-ko.test.ts`)와 조각이 이 문장을 그대로 이루는지 보는 테스트입니다.
   */
  terms: `${TERMS_SENTENCE.lead}${TERMS_SENTENCE.link}${TERMS_SENTENCE.tail}`,
  /** 로그인 링크를 누른 뒤의 Loading입니다. `code`는 mono 상태 코드라 영어로 남습니다. */
  authenticatingLabel: CONNECTING_GITHUB,
  authenticatingSub: "GitHub에서 권한을 확인합니다.",
  /** `auth_error` 쿼리가 있을 때의 Error입니다. 원인별 문구는 `AUTH_ERROR_COPY`가 sub에 들어갑니다. */
  errorLabel: GITHUB_UNREACHABLE,
  tryAgain: "다시 시도",
} as const;

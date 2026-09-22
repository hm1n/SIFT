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
 * 회원 탈퇴를 끝낸 뒤 로그인 화면에 보이는 안내입니다(이슈 #145).
 *
 * `auth_error`와 같은 방식입니다. 계정 메뉴가 `?withdrawn=`에 표시를 실어 보내고 이 표에 있는 값만
 * 안내로 취급합니다. 표시를 넷으로 두는 이유는 사용자가 알아야 할 것이 둘이기 때문입니다. 지울
 * 데이터가 있었는지와, GitHub 연결이 실제로 끊겼는지입니다.
 *
 * 연결이 남은 경우에는 문장 뒤에 `WITHDRAWN_GRANT_GUIDE`가 붙습니다. 데이터는 지웠지만 권한이
 * 남았다는 사실만 알리고 끝내면 사용자가 할 수 있는 일이 없습니다.
 */
export const WITHDRAWN_COPY: Record<string, { readonly text: string; readonly grantKept: boolean }> = {
  done: { text: "저장된 분석과 인터뷰를 모두 지웠고 GitHub 연결도 해제했습니다.", grantKept: false },
  empty: { text: "지울 데이터가 없어 GitHub 연결만 해제했습니다.", grantKept: false },
  done_kept: { text: "저장된 분석과 인터뷰를 모두 지웠습니다. GitHub 연결은 아직 남아 있습니다.", grantKept: true },
  empty_kept: { text: "지울 데이터가 없었습니다. GitHub 연결은 아직 남아 있습니다.", grantKept: true },
};

/** 연결이 남은 경우에 이어 붙이는 안내입니다. `이용약관`처럼 링크를 걸어야 해서 조각으로 나눕니다. */
export const WITHDRAWN_GRANT_GUIDE = {
  lead: "GitHub 설정의 ",
  link: "승인된 앱 목록",
  tail: "에서 SIFT 권한을 직접 해제해 주세요.",
  href: "https://github.com/settings/applications",
} as const;

/**
 * 약관 동의 안내 문장입니다. `이용약관`에 링크를 걸어야 해서 조각으로 나눠 둡니다(이슈 #141).
 *
 * 문장을 나눈 것이지 문구를 바꾼 것이 아닙니다. 조각을 이어 붙이면 아래 `terms`와 같고, 그 사실을
 * `landing-page.test.tsx`가 화면에서 읽은 글자로 확인합니다.
 */
const TERMS_SENTENCE = {
  lead: "계속하면 ",
  link: "이용약관",
  tail: "에 동의하는 것입니다",
} as const;

/**
 * 세션 없는 진입에서 쓰는 문구입니다.
 *
 * 이슈 #149 전에는 로그인 카드의 제목과 설명도 여기 있었습니다. 기본 화면이 랜딩으로 바뀌면서 그
 * 자리가 사라졌고, 같은 뜻의 문장은 랜딩의 Hero와 마지막 CTA(`copy/landing.ts`)가 가지고 있습니다.
 * 남은 것은 상태 셋을 가르는 데 필요한 문구와, 랜딩 CTA가 함께 쓰는 버튼·약관 문구입니다.
 */
export const LOGIN_COPY = {
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

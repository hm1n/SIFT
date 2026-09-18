/*
 * 인증 라우트 경로입니다. 헤더, 계정 메뉴, 로그인 화면, 분석 화면이 모두 참조하므로 한 곳에 둡니다.
 * 라우트 파일 위치와 응답 계약은 `src/app/api/auth/` 아래에 있고 이 파일은 경로 문자열만 가집니다.
 */

/** GitHub 로그인 시작 라우트입니다. 전체 이동으로 부르면 서버가 GitHub 인증 페이지로 리다이렉트합니다. */
export const LOGIN_PATH = "/api/auth/github/login";

/** 세션 삭제 라우트입니다. `DELETE`로 부르면 세션 쿠키를 지웁니다. */
export const SESSION_PATH = "/api/auth/session";

/**
 * 회원 탈퇴 라우트입니다(이슈 #145). `DELETE`로 부르면 저장된 데이터를 지우고 GitHub 권한을
 * 해제하고 세션 쿠키를 지웁니다. 대상은 세션의 사용자 번호뿐이라 본문이 없습니다.
 */
export const ACCOUNT_PATH = "/api/account";

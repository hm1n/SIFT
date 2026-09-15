import { CHANGE_REPOSITORY, CONNECTING_GITHUB, NO_INTERVIEWS, NO_REPOSITORY_SELECTED } from "./shared";
/** 문서 metadata입니다. 검색 결과와 브라우저 탭에 나갑니다. */
export const DOCUMENT_COPY = {
  title: "SIFT | Repository 분석",
  description: "GitHub Repository의 코드와 커밋에서 설명할 개발 경험을 찾습니다.",
} as const;

export const TOP_HEADER_COPY = {
  /** 브랜드 마크 링크의 접근성 이름입니다. 보이는 글자는 `SIFT` 마크뿐입니다. */
  homeLabel: "SIFT 홈",
  logIn: "GitHub으로 로그인",
  /** 로그인 링크를 누른 뒤 브라우저가 이동하기 전까지 씁니다. 로그인 화면의 버튼과 같은 문구입니다. */
  connecting: CONNECTING_GITHUB,
} as const;

export const ACCOUNT_MENU_COPY = {
  trigger: "계정",
  signedIn: "로그인됨",
  account: "GitHub 계정",
  signOut: "로그아웃",
  signingOut: "로그아웃 중…",
} as const;

export const APP_SHELL_COPY = {
  /** 사이드바 landmark의 이름입니다. 보이는 라벨이 없어 여기에만 있습니다. */
  workspace: "워크스페이스",
  noRepository: NO_REPOSITORY_SELECTED,
  changeRepository: CHANGE_REPOSITORY,
  noInterviews: NO_INTERVIEWS,
  findNewExperience: "새 경험 찾기",
} as const;

import {
  CHANGE_REPOSITORY,
  CONNECTING_GITHUB,
  NO_INTERVIEWS,
  NO_REPOSITORY_SELECTED,
  SECTION_INTERVIEWS,
} from "./shared";
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
  /** mono 섹션 라벨입니다. 번역하지 않습니다(이슈 #128 경계표). */
  repositorySection: "Repository",
  interviewsSection: SECTION_INTERVIEWS,
  /** 사이드바 landmark의 이름입니다. 보이는 라벨이 없어 여기에만 있습니다. */
  workspace: "워크스페이스",
  noRepository: NO_REPOSITORY_SELECTED,
  changeRepository: CHANGE_REPOSITORY,
  noInterviews: NO_INTERVIEWS,
  findNewExperience: "새 경험 찾기",
} as const;

/**
 * 화면을 그리다 잡히지 않은 오류가 난 경우입니다. `src/app/global-error.tsx`가 씁니다(이슈 #136).
 *
 * 무엇이 잘못됐는지가 아니라 무엇을 하면 되는지를 씁니다. 여기 오는 사용자는 화면을 전부 잃은
 * 상태라 원인 설명으로 할 수 있는 일이 없습니다. `NO_REPOSITORY_SELECTED`와 `BLOCK_EMPTY_PENDING`이
 * 같은 기준을 씁니다.
 *
 * 이 화면은 루트 레이아웃까지 대체하므로 헤더와 사이드바가 없습니다. 그래서 돌아갈 자리를 문장으로
 * 알려 줍니다.
 */
export const GLOBAL_ERROR_COPY = {
  /** mono 상태 코드입니다. 번역하지 않습니다(이슈 #128 경계표). */
  code: "ERROR",
  label: "화면을 그리지 못했습니다.",
  sub: "다시 시도해도 같으면 처음 화면으로 돌아가 주세요. 저장된 인터뷰는 그대로 남아 있습니다.",
  retry: "다시 시도",
  home: "처음 화면으로",
} as const;

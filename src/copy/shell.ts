import type { Metadata } from "next";
import {
  CHANGE_REPOSITORY,
  CONNECTING_GITHUB,
  NO_INTERVIEWS,
  NO_REPOSITORY_SELECTED,
  SECTION_INTERVIEWS,
} from "./shared";

/**
 * 검색 노출의 기준 도메인입니다(이슈 #149). canonical과 sitemap, Open Graph url이 모두 이 값에서
 * 나옵니다.
 *
 * GitHub Repository의 homepage에 설정된 값이고 사용자가 이 값으로 가기로 정했습니다. 도메인이
 * 바뀌면 여기 한 줄만 고치면 됩니다. 각 화면이 절대 주소를 따로 들지 않고 `metadataBase`에 상대
 * 경로를 얹는 이유입니다.
 *
 * 환경변수로 두지 않았습니다. 미리보기 배포마다 주소가 달라지는데 canonical은 어디서 열리든 정식
 * 주소 하나를 가리켜야 합니다. 배포 환경을 따라 움직이면 미리보기 주소가 정식 주소로 색인될 수
 * 있습니다.
 */
export const SITE_URL = "https://sift-dev.vercel.app";

/** 검색 결과와 브라우저 탭에 나가는 값입니다. */
const DOCUMENT_TITLE = "SIFT | Repository 분석";
const DOCUMENT_DESCRIPTION = "GitHub Repository의 코드와 커밋에서 설명할 개발 경험을 찾습니다.";

/**
 * 공유 미리보기 이미지입니다(이슈 #149).
 *
 * `public/og-image.png`이고 주소는 `/og-image.png`입니다. `src/app/opengraph-image.png` 파일 규약을
 * 쓰지 않았습니다. 규약은 메타 태그를 자동으로 만들어 주지만 파일 위치가 `src/app` 아래로 정해지고
 * 주소에 해시가 붙습니다. `public/`에 두면 주소가 고정돼 다른 곳에서도 같은 값으로 가리킬 수 있습니다.
 *
 * 가로·세로를 손으로 적습니다. 파일 규약이 하던 일이라 여기서는 실제 파일과 어긋날 수 있고, 어긋나면
 * 플랫폼이 잘린 카드를 그립니다. `shell.test.ts`가 PNG 헤더를 읽어 이 값과 맞춥니다.
 */
const OPEN_GRAPH_IMAGE = {
  url: "/og-image.png",
  width: 1730,
  height: 909,
  /** 이미지에 글자가 없어 제목과 설명을 되풀이하지 않고 무엇이 그려져 있는지만 적습니다. */
  alt: "SIFT 브랜드 마크와 워드마크",
} as const;

/**
 * 화면마다 반복되는 Open Graph 필드입니다(이슈 #149).
 *
 * 이미지는 여기 넣지 않고 쓰는 자리에서 `images: [OPEN_GRAPH_IMAGE]`로 답니다. `as const`가 배열까지
 * 읽기 전용으로 만드는데 Next의 `OGImage[]`는 바꿀 수 있는 배열이라 대입되지 않습니다.
 */
const OPEN_GRAPH_BASE = {
  siteName: "SIFT",
  locale: "ko_KR",
  type: "website",
} as const;

/**
 * 루트 레이아웃의 metadata입니다. `/`의 값이기도 합니다.
 *
 * 주의할 점이 하나 있습니다. 자식 화면이 `openGraph`나 `alternates`를 정의하지 않으면 이 값을
 * 통째로 물려받습니다. 그래서 `/privacy`와 `/terms`가 자기 canonical과 Open Graph를 각각 들어야
 * 합니다. 아래 `LEGAL_PAGE_METADATA`가 그 자리입니다.
 */
export const DOCUMENT_COPY = {
  metadataBase: new URL(SITE_URL),
  title: DOCUMENT_TITLE,
  description: DOCUMENT_DESCRIPTION,
  alternates: { canonical: "/" },
  /**
   * Google Search Console의 소유권 확인 토큰입니다(이슈 #152). `<meta
   * name="google-site-verification">`으로 나갑니다.
   *
   * `sift-dev.vercel.app`은 URL 접두어 속성으로 등록했습니다. 도메인 속성은 DNS TXT 레코드를
   * 요구하는데 이 주소는 Vercel이 소유한 `vercel.app`의 서브도메인이라 그 zone을 고칠 수 없습니다.
   * 확인 방법마다 토큰이 다르므로 DNS용으로 받은 값을 여기 넣으면 확인이 실패합니다.
   *
   * HTML 응답에 그대로 나가는 공개 값이라 환경변수로 빼지 않고 `SITE_URL` 옆에 둡니다.
   *
   * 확인이 끝난 뒤에도 지우면 안 됩니다. 구글이 주기적으로 다시 확인하고, 태그가 없으면 속성
   * 확인이 해제됩니다.
   */
  verification: { google: "vfWA9bPzc9OdVG5XzZ--ElkRwzOZvDsYuRw_LCzwv1s" },
  openGraph: {
    ...OPEN_GRAPH_BASE,
    url: "/",
    title: DOCUMENT_TITLE,
    description: DOCUMENT_DESCRIPTION,
    images: [OPEN_GRAPH_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: DOCUMENT_TITLE,
    description: DOCUMENT_DESCRIPTION,
    /*
     * X는 `twitter:image`가 없으면 `og:image`를 대신 쓰지만, 그 대체 동작에 기대지 않고 적습니다.
     * 여기가 비어 있으면 카드가 왜 그렇게 나오는지 태그만 보고는 알 수 없습니다.
     */
    images: [OPEN_GRAPH_IMAGE.url],
  },
} satisfies Metadata;

/**
 * 법적 고지 화면의 metadata입니다(이슈 #141). 화면 문구와 같은 자리에 둡니다.
 *
 * 두 화면이 각자 `metadata`를 내보내야 해서 `DOCUMENT_COPY`처럼 하나로 합칠 수 없습니다.
 *
 * canonical과 Open Graph를 각각 답니다(이슈 #149). 제목과 설명만 두면 루트의 `og:title`과
 * canonical을 물려받아, 두 문서를 공유했을 때 랜딩의 제목이 나가고 검색엔진이 세 주소를 모두 `/`의
 * 사본으로 읽습니다.
 */
export const LEGAL_PAGE_METADATA = {
  privacy: legalPageMetadata({
    path: "/privacy",
    title: "개인정보 처리방침 | SIFT",
    description: "SIFT가 처리하는 개인정보의 항목과 목적, 보유 기간, 국외 이전을 안내합니다.",
  }),
  terms: legalPageMetadata({
    path: "/terms",
    title: "이용약관 | SIFT",
    description: "SIFT를 이용하는 데 필요한 조건과 절차, 이용자와 서비스의 권리와 의무를 정합니다.",
  }),
} as const;

/** 두 법적 고지 화면이 같은 모양의 metadata를 갖도록 한 자리에서 만듭니다. */
function legalPageMetadata({
  path,
  title,
  description,
}: {
  path: string;
  title: string;
  description: string;
}) {
  return {
    title,
    description,
    alternates: { canonical: path },
    /* 세 화면이 같은 이미지를 씁니다. 제목과 설명은 각자 다르지만 이미지는 서비스를 가리키는 브랜드 마크 하나입니다. */
    openGraph: { ...OPEN_GRAPH_BASE, url: path, title, description, images: [OPEN_GRAPH_IMAGE] },
    twitter: { card: "summary_large_image", title, description, images: [OPEN_GRAPH_IMAGE.url] },
  } satisfies Metadata;
}

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
  /**
   * 회원 탈퇴입니다(이슈 #145). 저장된 데이터를 모두 지우고 GitHub 연결을 해제합니다.
   *
   * 레퍼런스의 `계정 삭제`를 쓰지 않습니다. 이 서비스에는 지울 회원 레코드가 없고 GitHub 계정은
   * 그대로 남으므로, 계정을 지운다고 하면 실제보다 큰 일을 말하는 것이 됩니다. 사유는
   * `reference-ko.test.ts`의 대조 표에도 적었습니다.
   */
  withdraw: "회원 탈퇴",
  withdrawConfirm: "회원 탈퇴할까요?",
  /**
   * 무엇이 사라지는지와 되돌릴 수 없다는 것을 함께 말합니다. GitHub 연결 해제를 빼지 않는 이유는
   * 해제하면 다음 로그인에서 권한 승인 화면을 다시 보게 되는데, 말해 두지 않으면 그게 왜 나오는지
   * 알 수 없기 때문입니다.
   */
  withdrawWarning: "저장된 분석과 인터뷰를 모두 지우고 GitHub 연결도 해제합니다. 되돌릴 수 없습니다.",
  withdrawConfirmAction: "탈퇴",
  withdrawing: "탈퇴 중…",
  /** 실패 원인을 말하지 않습니다. 사용자가 할 수 있는 일은 원인과 무관하게 다시 시도하는 것뿐입니다. */
  withdrawFailed: "탈퇴를 끝내지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
  withdrawRetry: "다시 시도",
  cancel: "취소",
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

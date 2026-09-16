import type { BlockKind } from "@/features/experience-block/types";

/**
 * 두 화면 이상이 함께 쓰는 문구입니다.
 *
 * 화면별 파일로 나눠 담다 보니 같은 문구가 파일을 넘나들며 10쌍 복제됐습니다. 한쪽만 고치면 두
 * 화면이 조용히 갈립니다. 실제로 이슈 #128에서 `src/copy/`로 모은 뒤에도 남아 있던 것을 셀프
 * 리뷰에서 찾았습니다.
 *
 * **여기 담는 기준은 "같은 것을 가리키는가"이지 "글자가 같은가"가 아닙니다.** 뜻이 다른데 지금
 * 글자가 우연히 같은 문구는 각자의 화면 파일에 남깁니다. 한쪽을 다시 쓸 때 다른 쪽이 따라가면 안
 * 되기 때문입니다. `SAVED_INTERVIEW_SCREEN_COPY.resume`이 그 경우입니다. 글자는 아래
 * `CONTINUE_INTERVIEW`와 같지만 저장된 인터뷰를 여는 조작이고, 저쪽은 나가지 않고 머무르는
 * 조작입니다.
 */

/** 분석 화면의 버튼과 사이드바의 버튼이 같은 곳으로 보냅니다. */
export const CHANGE_REPOSITORY = "← Repository 변경";

/** 분석 화면과 사이드바가 같은 빈 상태를 말합니다. */
export const NO_REPOSITORY_SELECTED = "Repository를 선택하지 않았습니다.";

/** 분석 실패와 후보 확정 실패에서 같은 복구 조작을 가리킵니다. */
export const CHOOSE_ANOTHER_REPOSITORY = "다른 Repository 선택";

/** 사이드바의 빈 목록과 저장된 인터뷰 목록의 빈 상태가 같은 문장을 씁니다. */
export const NO_INTERVIEWS = "인터뷰가 없습니다. 경험 후보를 선택해 시작하세요.";

/** 이탈 확인 다이얼로그 셋(인터뷰 화면, PAAR 종료, Repository 변경)의 머무르기 버튼입니다. */
export const CONTINUE_INTERVIEW = "인터뷰 계속하기";

/** 다른 탭이 인터뷰를 바꿨을 때 최신 상태를 당겨오는 조작입니다. 진행 중과 저장본 화면에 모두 있습니다. */
export const LOAD_LATEST = "최신 내용 불러오기";

/** 로그인 화면과 상단 헤더가 같은 연결 상태를 말합니다. */
export const CONNECTING_GITHUB = "GitHub에 연결 중…";

/** 로그인 실패와 Repository 조회 실패가 같은 원인을 말합니다. */
export const GITHUB_UNREACHABLE = "GitHub에 연결할 수 없습니다.";

/**
 * PAAR 블록의 빈 상태입니다. 진행 중 화면과 저장본 화면이 같은 자리를 그립니다.
 *
 * 무엇이 안 일어났는지가 아니라 무엇을 하면 채워지는지를 씁니다. 레퍼런스
 * `paar-interview-workspace.md` 302행이 "대화에 답하면 오른쪽 PAAR이 채워진다"를 화면의 목표로
 * 정합니다. 두 화면의 말투가 갈리면 이 기준이 무너지므로 한 자리에 둡니다.
 */
export const BLOCK_EMPTY_PENDING = "대화를 진행하면 AI가 이 블록을 채웁니다.";

/** 끝난 인터뷰에서는 채울 방법이 없으므로 사실만 적습니다. */
export const BLOCK_EMPTY_ENDED = "이 블록은 채우지 못한 채 인터뷰가 끝났습니다.";

/**
 * mono로 그리는 섹션 라벨입니다. 번역 대상이 아니지만(이슈 #128 경계표) 두 화면 이상이 같은 라벨을
 * 쓰므로 여기 둡니다. 쓰는 자리에 두면 한쪽만 고쳤을 때 두 화면이 같은 것을 다르게 부릅니다.
 * 실제로 저장 화면이 블록 이름표를 따로 들고 있었습니다.
 */

/** 후보 상세, 인터뷰 화면, 저장본 화면의 머리 라벨입니다. */
export const SECTION_EXPERIENCE = "Experience";

/** 후보 상세와 저장본 화면이 같은 세 섹션을 같은 순서로 그립니다. */
export const SECTION_WHY_WORTH_DISCUSSING = "Why worth discussing";
export const SECTION_TECHNICAL_TOPICS = "Technical topics";
export const SECTION_REPOSITORY_EVIDENCE = "Repository evidence";

/** 사이드바와 저장된 인터뷰 목록의 섹션 라벨입니다. */
export const SECTION_INTERVIEWS = "Interviews";

/**
 * 화면에 보이는 PAAR 블록 이름입니다. 오른쪽 패널의 카드, 답변 입력 아래의 현재 블록 안내,
 * 저장본 화면의 블록 머리가 같은 값을 써야 합니다.
 *
 * 두 번째 블록의 이름은 디자인 개편의 공통 결정을 따라 `Analyze`이고, 설계 문서의 `ALTERNATIVE`를
 * 대체합니다(이슈 #92 Approach). 상태 키 `alternatives`는 모델 계약이라 그대로 둡니다.
 *
 * `experience-block/types.ts`의 `BLOCK_PURPOSES`와 나누는 이유는 읽는 쪽이 다르기 때문입니다.
 * 그 값은 모델에게 주는 한국어 설명이고 이 값은 사용자가 읽는 영어 이름입니다.
 */
export const BLOCK_LABELS: Readonly<Record<BlockKind, string>> = {
  problem: "Problem",
  alternatives: "Analyze",
  action: "Action",
  result: "Result",
};

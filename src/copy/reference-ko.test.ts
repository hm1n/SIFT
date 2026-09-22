import { describe, expect, it } from "vitest";
import * as authCopy from "./auth";
import * as candidatesCopy from "./candidates";
import * as interviewCopy from "./interview";
import * as landingCopy from "./landing";
import * as repositoryCopy from "./repository";
import * as savedCopy from "./saved";
import * as sharedCopy from "./shared";
import * as shellCopy from "./shell";
import { LOGIN_COPY } from "./auth";
import { LANDING_COPY } from "./landing";
import { CANDIDATE_DETAIL_COPY } from "./candidates";
import { INTERVIEW_SCREEN_COPY, PAAR_PANEL_COPY, STREAM_VIEW_COPY } from "./interview";
import { REPOSITORY_SELECT_COPY, RESUME_ERROR_COPY } from "./repository";
import { SAVED_INTERVIEW_LIST_COPY, SAVED_INTERVIEW_SCREEN_COPY } from "./saved";
import { CONTINUE_INTERVIEW } from "./shared";
import { ACCOUNT_MENU_COPY, APP_SHELL_COPY, GLOBAL_ERROR_COPY, TOP_HEADER_COPY } from "./shell";

/**
 * 레퍼런스 `Chat Interface Design/src/App.tsx`의 `TRANSLATIONS.ko`를 옮겨 둔 것입니다.
 *
 * 레퍼런스 저장소는 이 저장소 밖에 있어 테스트가 직접 읽을 수 없습니다. 그래서 값을 여기 고정하고,
 * 항목마다 이 Repository가 그 문구를 **쓰는지** 아니면 **의도적으로 다르게 쓰는지**를 함께 적습니다.
 *
 * 이 표가 있는 이유는 이슈 #128에서 레퍼런스에 한국어 답이 이미 있는 문구 6개를 못 보고 직접
 * 번역했기 때문입니다. 문구가 39개 파일에 흩어져 있어 대조할 방법이 없었습니다. 이제 어긋남은
 * 둘 중 하나입니다. 이 표를 고치지 않은 실수이거나, 이 표에 사유를 적은 결정입니다.
 *
 * 레퍼런스 화면 중 이 Repository에 없는 것(Sessions)은 담지 않습니다. 대조할 자리가 없어 결정이
 * 아니라 미구현입니다. 랜딩은 이슈 #149에서 만들었고 backlog 31번이 닫혔습니다.
 *
 * 계정 삭제는 이슈 #145에서 회원 탈퇴로 구현했습니다. 문구 셋을 모두 다르게 쓰기로 정했고 사유는
 * 아래 표에 있습니다.
 */
const REFERENCE_KO: readonly {
  readonly key: string;
  readonly text: string;
  readonly deviation?: string;
  /**
   * 이 문구를 실제로 그리는 상수입니다. 있으면 뭉친 문자열 검색 대신 이 값과 직접 맞춥니다.
   *
   * 짧은 문구에는 검색이 통하지 않습니다. 취소 버튼 둘을 `그만두기`로 바꿔도 OAuth 오류 문구의
   * "권한 승인을 취소했습니다"가 `취소`를 품고 있어 통과했습니다. 여덟 자 이하 항목은 전부 여기에
   * 상수를 답니다. 긴 문장은 우연히 겹칠 일이 없어 검색으로 둡니다.
   */
  readonly at?: readonly string[];
}[] = [
  // --- 그대로 씁니다 ---
  { key: "landingCTA", text: "GitHub으로 계속하기", at: [LANDING_COPY.cta] },
  { key: "landingLogIn", text: "GitHub으로 로그인", at: [TOP_HEADER_COPY.logIn] },
  { key: "terms", text: "계속하면 이용약관에 동의하는 것입니다", at: [LOGIN_COPY.terms] },

  // --- 랜딩 화면(이슈 #149) ---
  { key: "landingTagline", text: "Developer Tool · AI Interview", at: [LANDING_COPY.hero.tagline] },
  /*
   * 레퍼런스가 `\n`으로 끊어 둔 문구입니다. 이 Repository는 줄을 배열로 들고 화면이 `<br />`로
   * 잇습니다. 이어 붙인 값이 레퍼런스와 같은지 봅니다. 줄을 나누는 자리까지 함께 지킵니다.
   */
  { key: "landingH1", text: "코드에는 이미\n당신의 이야기가 담겨 있습니다.", at: [LANDING_COPY.hero.headline.join("\n")] },
  {
    key: "landingSubtext",
    text: "SIFT는 저장소의 코드와 커밋 히스토리를 분석해 이야기할 가치가 있는 개발 경험을 찾아내고,\n실제 근거에 기반한 AI 인터뷰로 체계적으로 정리합니다.",
    at: [LANDING_COPY.hero.subtext.join("\n")],
  },
  { key: "steps[0].label", text: "ANALYZE", at: [LANDING_COPY.steps.items[0].label] },
  { key: "steps[0].desc", text: "저장소 코드, 커밋 히스토리, 변경 파일, diff를 분석합니다.", at: [LANDING_COPY.steps.items[0].description] },
  { key: "steps[1].label", text: "DISCOVER", at: [LANDING_COPY.steps.items[1].label] },
  { key: "steps[1].desc", text: "설명할 가치가 있는 개발 경험을 발견합니다.", at: [LANDING_COPY.steps.items[1].description] },
  { key: "steps[2].label", text: "INTERVIEW", at: [LANDING_COPY.steps.items[2].label] },
  { key: "steps[2].desc", text: "실제 저장소 근거에 기반한 AI 인터뷰를 진행합니다.", at: [LANDING_COPY.steps.items[2].description] },
  { key: "steps[3].label", text: "STRUCTURE", at: [LANDING_COPY.steps.items[3].label] },
  {
    key: "steps[3].desc",
    text: "대화를 Problem · Analyze · Action · Result 구조로 정리합니다.",
    at: [LANDING_COPY.steps.items[3].description],
  },
  { key: "coreModelTitle", text: "핵심 제품 모델", at: [LANDING_COPY.coreModel.title] },
  { key: "codeLabel", text: "CODE / EVIDENCE", at: [LANDING_COPY.coreModel.columns[0].label] },
  { key: "codeQ", text: "실제로 무슨 일이 있었나요?", at: [LANDING_COPY.coreModel.columns[0].question] },
  {
    key: "codeDesc",
    text: "커밋, 변경 파일, diff, 코드를 직접 참조합니다. 저장소에서 실제로 일어난 일만 근거로 삼습니다.",
    at: [LANDING_COPY.coreModel.columns[0].description],
  },
  { key: "interviewLabel", text: "INTERVIEW", at: [LANDING_COPY.coreModel.columns[1].label] },
  { key: "interviewQ", text: "왜 그런 결정을 내렸나요?", at: [LANDING_COPY.coreModel.columns[1].question] },
  {
    key: "interviewDesc",
    text: "저장소 근거를 바탕으로 질문합니다. 기술 선택의 이유와 트레이드오프를 이끌어냅니다.",
    at: [LANDING_COPY.coreModel.columns[1].description],
  },
  { key: "experienceLabel", text: "EXPERIENCE", at: [LANDING_COPY.coreModel.columns[2].label] },
  { key: "experienceQ", text: "어떻게 구조화할 수 있나요?", at: [LANDING_COPY.coreModel.columns[2].question] },
  {
    key: "experienceDesc",
    text: "대화를 PAAR 구조로 정리합니다. 문제 정의부터 결과까지 일관된 경험 서술을 만듭니다.",
    at: [LANDING_COPY.coreModel.columns[2].description],
  },
  { key: "evidenceTitle", text: "근거 기반 접근", at: [LANDING_COPY.evidence.title] },
  { key: "evidenceH2a", text: "추측이 아니라", at: [LANDING_COPY.evidence.headline[0]] },
  { key: "evidenceH2b", text: "근거로 만들어집니다.", at: [LANDING_COPY.evidence.headline[1]] },
  {
    key: "evidenceSubtext",
    text: "SIFT는 저장소에서 검증된 사실과 사용자가 제공한 맥락을 명확히 구분합니다. 실제 커밋, 변경 파일, 코드, diff만이 저장소 근거로 인정됩니다. 검증되지 않은 정보를 근거로 제시하지 않습니다.",
    at: [LANDING_COPY.evidence.subtext],
  },
  { key: "finalLabel", text: "시작하기", at: [LANDING_COPY.final.label] },
  { key: "finalH2a", text: "코드 속에 숨겨진", at: [LANDING_COPY.final.headline[0]] },
  { key: "finalH2b", text: "경험을 발견하세요.", at: [LANDING_COPY.final.headline[1]] },
  { key: "githubAccount", text: "GitHub 계정" },
  { key: "signOut", text: "로그아웃", at: [ACCOUNT_MENU_COPY.signOut] },
  {
    key: "cancel",
    text: "취소",
    at: [SAVED_INTERVIEW_LIST_COPY.cancel, SAVED_INTERVIEW_SCREEN_COPY.cancel, ACCOUNT_MENU_COPY.cancel],
  },
  { key: "delete", text: "삭제", at: [SAVED_INTERVIEW_LIST_COPY.delete] },
  {
    key: "connectingGitHub",
    text: "GitHub에 연결 중...",
    deviation: "화면 문구의 말줄임표를 세 점 대신 한 글자 말줄임표로 통일했습니다.",
  },
  {
    key: "noReposMatch",
    text: "검색 결과가 없습니다. 다른 키워드로 다시 검색해보세요.",
    deviation: "검색어를 입력하는 다음 행동을 직접 안내하고 `키워드`를 쉬운 말로 바꿨습니다.",
  },
  {
    key: "contributionHelper",
    text: "프로젝트에서 주로 기여한 내용을 알려주세요.",
    deviation: "사용자가 맡은 일을 말로 답하기 쉬운 질문으로 바꿨습니다.",
  },
  { key: "contributionPlaceholder", text: "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다." },
  { key: "analyze", text: "분석하기", at: [REPOSITORY_SELECT_COPY.analyze] },
  { key: "findNewExperience", text: "새 경험 찾기", at: [APP_SHELL_COPY.findNewExperience] },
  {
    key: "loadingSavedInterviews",
    text: "인터뷰를 불러오는 중...",
    deviation: "화면 문구의 말줄임표를 세 점 대신 한 글자 말줄임표로 통일했습니다.",
  },
  { key: "savedInterviewsError", text: "인터뷰를 불러오지 못했습니다." },
  { key: "deleteInterviewConfirm", text: "이 인터뷰를 삭제할까요? 되돌릴 수 없습니다." },
  { key: "stepHistory", text: "커밋 히스토리 불러오는 중" },
  { key: "stepCandidates", text: "경험 후보 찾는 중" },
  { key: "showLess", text: "간단히 보기", at: [CANDIDATE_DETAIL_COPY.showLess] },
  { key: "startInterview", text: "인터뷰 시작", at: [CANDIDATE_DETAIL_COPY.startInterview] },
  { key: "continueInterview", text: "인터뷰 계속하기", at: [CONTINUE_INTERVIEW, SAVED_INTERVIEW_SCREEN_COPY.resume] },
  { key: "reviewInterview", text: "인터뷰 다시 보기" },
  { key: "paarExperience", text: "PAAR 경험", at: [SAVED_INTERVIEW_SCREEN_COPY.paarHeading] },
  { key: "backToCandidates", text: "← 뒤로", at: [INTERVIEW_SCREEN_COPY.back] },
  { key: "send", text: "전송", at: [STREAM_VIEW_COPY.send] },
  { key: "finishInterview", text: "인터뷰 완료", at: [PAAR_PANEL_COPY.end] },
  { key: "unsavedAnswerNotice", text: "마지막 답변이 저장되지 않았습니다." },
  { key: "unsavedAnswerRetry", text: "다시 저장", at: [STREAM_VIEW_COPY.retrySave] },
  { key: "staleSessionNotice", text: "다른 탭에서 이 인터뷰가 변경됐습니다." },
  { key: "loadLatest", text: "최신 내용 불러오기" },
  { key: "noInterviewsYet", text: "인터뷰가 없습니다. 경험 후보를 선택해 시작하세요." },
  { key: "errAuthLabel", text: "GitHub에 연결할 수 없습니다." },
  {
    key: "tryAgain",
    text: "다시 시도",
    // 이 문구를 쓰는 상수를 모두 답니다. 빠진 상수는 검사를 받지 않아 혼자 다른 문구로 흘러갑니다.
    at: [
      LOGIN_COPY.tryAgain,
      STREAM_VIEW_COPY.retry,
      PAAR_PANEL_COPY.retry,
      REPOSITORY_SELECT_COPY.tryAgain,
      RESUME_ERROR_COPY.tryAgain,
      SAVED_INTERVIEW_LIST_COPY.retry,
      GLOBAL_ERROR_COPY.retry,
      ACCOUNT_MENU_COPY.withdrawRetry,
    ],
  },

  // --- 의도적으로 다르게 씁니다 ---
  {
    key: "landingFree",
    text: "무료 · 카드 등록 불필요",
    deviation:
      "Hero의 CTA 옆 문구입니다. 옮기지 않았습니다. 정해진 과금 정책이 없어 무료라고 단정할 수 없습니다(이슈 #149, 사용자 결정). 같은 이유로 랜딩의 `SoftwareApplication` 구조화 데이터에도 `offers`를 넣지 않았습니다.",
  },
  {
    key: "footerTagline",
    text: "DEVELOPER TOOL · AI INTERVIEW",
    deviation:
      "랜딩 푸터 오른쪽의 태그라인입니다. 그 자리를 법적 고지 링크가 씁니다(이슈 #141). 개인정보 처리방침 작성지침 Part 02가 로그인 여부와 무관하게 첫 화면에서 바로 찾을 수 있도록 공개하라고 요구합니다. 사유는 `site-footer.tsx`에 있습니다.",
  },
  {
    key: "selectRepository",
    text: "저장소 선택",
    deviation: "이슈 #128 경계표가 `Repository`를 한국어 문장 안에서 영어로 남기기로 정했습니다. 코드와 위키가 이미 그렇게 씁니다.",
  },
  { key: "chooseRepo", text: "분석할 저장소를 선택하세요.", deviation: "`selectRepository`와 같습니다." },
  {
    key: "searchRepos",
    text: "저장소 검색...",
    deviation: "`Repository`를 영어로 유지하고 이름을 검색한다는 점을 명확히 했습니다.",
  },
  {
    key: "noRepoSelected",
    text: "선택된 저장소 없음",
    deviation: "`Repository`를 영어로 유지하고 상태를 자연스러운 문장으로 바꿨습니다.",
  },
  { key: "analyzingRepo", text: "저장소 분석 중", deviation: "`selectRepository`와 같습니다." },
  { key: "changeRepository", text: "← 저장소 변경", deviation: "`selectRepository`와 같습니다." },
  {
    key: "authenticating",
    text: "인증 중",
    deviation: "`StatusScreen`의 `code`는 mono 상태 코드입니다. 이슈 경계표의 developer metadata라 `Authenticating`으로 남깁니다.",
  },
  {
    key: "errAuthCode",
    text: "연결 실패 / AUTH",
    deviation:
      "레퍼런스 스펙 `product-flow-update.md`는 같은 자리를 `ERROR / AUTH`로 적습니다. 구현과 스펙이 어긋나 스펙을 따랐습니다.",
  },
  {
    key: "errAuthSub",
    text: "연결 상태 또는 GitHub 서버를 확인하세요.",
    deviation: "이 Repository는 실패 원인을 rate limit·network·auth 등으로 갈라 각각 다른 sub를 씁니다.",
  },
  {
    key: "notStartedYet",
    text: "아직 시작되지 않았습니다.",
    deviation:
      "레퍼런스 스펙 `paar-interview-workspace.md`는 같은 자리를 `현재 AI가 ~을 확인하고 있습니다`로 쓰고, 302행에서 \"대화에 답하면 오른쪽 PAAR이 채워진다\"를 화면의 목표로 정합니다. 상태 서술 대신 그 voice를 따랐습니다.",
  },
  {
    key: "collectingInfo",
    text: "정보를 수집 중입니다...",
    deviation: "`notStartedYet`과 같습니다. 어떤 답변을 반영하는 중인지까지 적습니다.",
  },
  {
    key: "answerQuestion",
    text: "질문에 답하세요...",
    deviation: "자연스러운 존댓말로 고치고 코드 블록을 써도 된다는 안내를 덧붙였습니다. 이 Repository는 답변에 코드가 들어옵니다.",
  },
  {
    key: "experiencesFound",
    text: "경험 3개 발견",
    deviation: "사용자 결정으로 `pluralCount`(`3 experiences`)를 영어로 남깁니다. 세는 부분만 영어이고 나머지는 한국어입니다.",
  },
  { key: "viewAllCommits", text: "전체 5개 커밋 보기 →", deviation: "`experiencesFound`와 같습니다." },
  {
    key: "stepConnected",
    text: "저장소 연결됨",
    deviation: "이 Repository의 분석 체크리스트는 6단계라 레퍼런스의 4단계와 구성이 다릅니다. 대응하는 단계가 없습니다.",
  },
  { key: "stepChanges", text: "코드 변경사항 분석 중", deviation: "`stepConnected`와 같습니다." },
  {
    key: "deleteAccount",
    text: "계정 삭제",
    deviation:
      "이 서비스에는 지울 회원 레코드가 없고 GitHub 계정도 그대로 남습니다. 지우는 것은 저장된 분석과 인터뷰이고 함께 끊는 것은 GitHub 권한이라, 계정을 지운다고 하면 실제보다 큰 일을 말하게 됩니다. `회원 탈퇴`로 씁니다(이슈 #145).",
  },
  {
    key: "deleteAccountConfirm",
    text: "계정을 삭제할까요?",
    deviation: "`deleteAccount`와 같습니다. `회원 탈퇴할까요?`로 씁니다.",
  },
  {
    key: "deleteAccountWarning",
    text: "모든 기록이 삭제됩니다. 되돌릴 수 없습니다.",
    deviation:
      "무엇이 사라지는지를 `기록`으로 뭉치지 않고 저장된 분석과 인터뷰로 적고, GitHub 연결 해제를 함께 밝힙니다. 해제하면 다음 로그인에서 권한 승인 화면을 다시 보게 되는데 말해 두지 않으면 그게 왜 나오는지 알 수 없습니다.",
  },
  {
    key: "clarify",
    text: "보완",
    deviation: "완료된 블록을 다시 겨냥하는 조작이 없습니다. 편집은 종료 뒤 요약 화면에서 합니다(이슈 #78).",
  },
];

/** 모든 copy 모듈의 문자열 값입니다. 함수로 만든 문구는 대표 인자를 넣어 펼칩니다. */
function allCopyText(): string {
  const modules = [
    authCopy,
    candidatesCopy,
    interviewCopy,
    landingCopy,
    repositoryCopy,
    savedCopy,
    sharedCopy,
    shellCopy,
  ];
  const out: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      out.push(value);
      return;
    }
    if (typeof value === "function") {
      // 인자 수만큼 자리표시자를 넣습니다. 문구의 고정 부분만 확인하면 충분합니다.
      const args = Array.from({ length: value.length }, () => "1");
      try {
        visit((value as (...rest: unknown[]) => unknown)(...args));
      } catch {
        // 인자 모양이 맞지 않는 함수는 건너뜁니다.
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(visit);
    }
  };
  modules.forEach(visit);
  return out.join("\n");
}

describe("레퍼런스 TRANSLATIONS.ko 대조", () => {
  const text = allCopyText();

  it.each(REFERENCE_KO.filter((entry) => entry.deviation === undefined))(
    "$key: 레퍼런스 문구를 그대로 씁니다",
    ({ text: reference, at }) => {
      // `at`이 있으면 그 자리가 정확히 이 문구인지 봅니다. 없으면 어딘가에 있는지만 봅니다.
      if (at) for (const actual of at) expect(actual).toBe(reference);
      else expect(text).toContain(reference);
    }
  );

  /**
   * `at`을 단 항목은 화면 상수를 직접 맞추므로 뭉친 검색이 필요 없습니다. 반대로 `at`이 없는 항목은
   * 검색에 기대므로, 짧아서 우연히 통과할 수 있는 문구가 남아 있으면 안 됩니다.
   */
  it("검색에만 기대는 항목은 우연히 겹칠 수 없을 만큼 깁니다", () => {
    const searchOnly = REFERENCE_KO.filter(
      (entry) => entry.deviation === undefined && entry.at === undefined
    );
    expect(searchOnly.filter((entry) => entry.text.length <= 8)).toEqual([]);
  });

  it.each(REFERENCE_KO.filter((entry) => entry.deviation !== undefined))(
    "$key: 의도적으로 다르게 씁니다",
    ({ text: reference }) => {
      // 레퍼런스 문구가 다시 쓰이기 시작했다면 이 표의 사유가 낡은 것입니다. 표를 먼저 고칩니다.
      expect(text).not.toContain(reference);
    }
  );

  it("어긋난 항목마다 사유가 문장으로 적혀 있습니다", () => {
    for (const entry of REFERENCE_KO) {
      if (entry.deviation === undefined) continue;
      expect(entry.deviation.length).toBeGreaterThan(10);
    }
  });
});

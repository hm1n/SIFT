import { describe, expect, it } from "vitest";
import * as authCopy from "./auth";
import * as candidatesCopy from "./candidates";
import * as interviewCopy from "./interview";
import * as repositoryCopy from "./repository";
import * as savedCopy from "./saved";
import * as shellCopy from "./shell";

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
 * 레퍼런스 화면 중 이 Repository에 없는 것(랜딩, Sessions, 계정 삭제)은 담지 않습니다. 대조할
 * 자리가 없어 결정이 아니라 미구현입니다. 목록은 디자인 개편 backlog 31번에 있습니다.
 */
const REFERENCE_KO: readonly {
  readonly key: string;
  readonly text: string;
  readonly deviation?: string;
}[] = [
  // --- 그대로 씁니다 ---
  { key: "landingCTA", text: "GitHub으로 계속하기" },
  { key: "landingLogIn", text: "GitHub으로 로그인" },
  { key: "terms", text: "계속하면 이용약관에 동의하는 것입니다" },
  { key: "githubAccount", text: "GitHub 계정" },
  { key: "signOut", text: "로그아웃" },
  { key: "cancel", text: "취소" },
  { key: "delete", text: "삭제" },
  { key: "connectingGitHub", text: "GitHub에 연결 중..." },
  { key: "noReposMatch", text: "검색 결과가 없습니다. 다른 키워드로 다시 검색해보세요." },
  { key: "contributionHelper", text: "프로젝트에서 주로 기여한 내용을 알려주세요." },
  { key: "contributionPlaceholder", text: "실시간 채팅, 푸시 알림, TypeScript 전환 작업을 주로 담당했습니다." },
  { key: "analyze", text: "분석하기" },
  { key: "findNewExperience", text: "새 경험 찾기" },
  { key: "loadingSavedInterviews", text: "인터뷰를 불러오는 중..." },
  { key: "savedInterviewsError", text: "인터뷰를 불러오지 못했습니다." },
  { key: "deleteInterviewConfirm", text: "이 인터뷰를 삭제할까요? 되돌릴 수 없습니다." },
  { key: "stepHistory", text: "커밋 히스토리 불러오는 중" },
  { key: "stepCandidates", text: "경험 후보 찾는 중" },
  { key: "showLess", text: "간단히 보기" },
  { key: "startInterview", text: "인터뷰 시작" },
  { key: "continueInterview", text: "인터뷰 계속하기" },
  { key: "reviewInterview", text: "인터뷰 다시 보기" },
  { key: "paarExperience", text: "PAAR 경험" },
  { key: "backToCandidates", text: "← 뒤로" },
  { key: "send", text: "전송" },
  { key: "finishInterview", text: "인터뷰 완료" },
  { key: "unsavedAnswerNotice", text: "마지막 답변이 저장되지 않았습니다." },
  { key: "unsavedAnswerRetry", text: "다시 저장" },
  { key: "staleSessionNotice", text: "다른 탭에서 이 인터뷰가 변경됐습니다." },
  { key: "loadLatest", text: "최신 내용 불러오기" },
  { key: "noInterviewsYet", text: "인터뷰가 없습니다. 경험 후보를 선택해 시작하세요." },
  { key: "errAuthLabel", text: "GitHub에 연결할 수 없습니다." },
  { key: "tryAgain", text: "다시 시도" },

  // --- 의도적으로 다르게 씁니다 ---
  {
    key: "selectRepository",
    text: "저장소 선택",
    deviation: "이슈 #128 경계표가 `Repository`를 한국어 문장 안에서 영어로 남기기로 정했습니다. 코드와 위키가 이미 그렇게 씁니다.",
  },
  { key: "chooseRepo", text: "분석할 저장소를 선택하세요.", deviation: "`selectRepository`와 같습니다." },
  { key: "searchRepos", text: "저장소 검색...", deviation: "`selectRepository`와 같습니다." },
  { key: "noRepoSelected", text: "선택된 저장소 없음", deviation: "`selectRepository`와 같습니다." },
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
    deviation: "같은 문장으로 시작하되 코드 블록을 써도 된다는 안내를 덧붙입니다. 이 Repository는 답변에 코드가 들어옵니다.",
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
    key: "clarify",
    text: "보완",
    deviation: "완료된 블록을 다시 겨냥하는 조작이 없습니다. 편집은 종료 뒤 요약 화면에서 합니다(이슈 #78).",
  },
];

/** 모든 copy 모듈의 문자열 값입니다. 함수로 만든 문구는 대표 인자를 넣어 펼칩니다. */
function allCopyText(): string {
  const modules = [authCopy, candidatesCopy, interviewCopy, repositoryCopy, savedCopy, shellCopy];
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
    ({ text: reference }) => {
      expect(text).toContain(reference);
    }
  );

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

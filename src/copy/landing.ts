import { LOGIN_COPY } from "./auth";
import { STREAM_VIEW_COPY } from "./interview";

/**
 * 비로그인 `/`가 그리는 랜딩 화면의 문구입니다(이슈 #149).
 *
 * 값의 출처는 레퍼런스 `Chat Interface Design/src/App.tsx`의 `TRANSLATIONS.ko`(382~410줄)이고
 * 섹션 구성은 같은 파일의 `LandingPage`(2039줄)입니다. 디자인 개편 backlog 31번이 "레퍼런스에
 * 한국어 문구가 이미 있어 만들 때 그대로 쓸 수 있다"고 적어 둔 그 문구입니다. 대조는
 * `reference-ko.test.ts`가 합니다.
 *
 * 영어로 남는 것은 셋입니다. mono로 그리는 섹션 라벨(`ANALYZE`·`CODE / EVIDENCE` 등), 흐름 표기
 * (`CODE → CHAT → PAAR`), 근거 종류 태그(`COMMIT`·`CHANGED FILE`·`DIFF`·`CODE`)입니다. #128이
 * 정한 경계표를 따릅니다.
 */

/** Hero입니다. 제목과 설명은 레퍼런스가 `\n`으로 끊어 둔 줄을 배열로 폅니다. */
const HERO = {
  /** mono 태그라인입니다. 레퍼런스가 ko에서도 영어로 둡니다. */
  tagline: "Developer Tool · AI Interview",
  headline: ["코드에는 이미", "당신의 이야기가 담겨 있습니다."],
  subtext: [
    "SIFT는 저장소의 코드와 커밋 히스토리를 분석해 이야기할 가치가 있는 개발 경험을 찾아내고,",
    "실제 근거에 기반한 AI 인터뷰로 체계적으로 정리합니다.",
  ],
  /**
   * 레퍼런스 Hero에는 `무료 · 카드 등록 불필요`가 CTA 옆에 붙어 있습니다. 옮기지 않았습니다.
   * 과금 정책을 단정하는 문장인데 정해진 정책이 없습니다(사용자 결정).
   */
} as const;

/**
 * 제품 화면 미리보기입니다. 레퍼런스 `LandingProductPreview`(1853줄)를 옮겼습니다.
 *
 * `alt` 말고는 전부 화면에 그려 넣는 예시 데이터입니다. 실제 저장소에서 온 값이 아니라 인터뷰
 * 워크스페이스가 어떻게 생겼는지 보여 주려고 만든 장면이고, 레퍼런스가 쓰는 값 그대로입니다.
 *
 * 보조기술에는 이 장면을 읽히지 않습니다. 컨테이너에 `role="img"`를 주고 `alt` 한 문장으로
 * 대신합니다. 스크린샷이었다면 `alt`가 됐을 자리이고, 가짜 대화를 전부 읽어 주면 소음이 됩니다.
 */
const PREVIEW = {
  alt: "SIFT 인터뷰 워크스페이스 미리보기. 왼쪽은 코드와 근거, 가운데는 AI 인터뷰 대화, 오른쪽은 PAAR 경험 블록입니다.",
  windowTitle: "SIFT · INTERVIEW WORKSPACE",
  header: {
    back: "← Candidates",
    experienceLabel: "EXPERIENCE / 01",
    experienceTitle: "Architected real-time collaboration system",
    codeChip: "Code",
    paarChip: "PAAR 1/4",
  },
  code: {
    panelLabel: "Code / Evidence",
    diffMode: "DIFF",
    fileMode: "FILE",
    filesLabel: "Files",
    filesCount: "/ 06",
    tree: [
      { directory: "hooks", files: [{ name: "useDocumentSync.ts", added: "+9", removed: "-7", selected: true }] },
      {
        directory: "lib/ws",
        files: [
          { name: "ConnectionManager.ts" },
          { name: "types.ts" },
          { name: "offlineQueue.ts" },
          { name: "presenceState.ts" },
        ],
      },
    ],
    selectedFileLabel: "Selected File",
    selectedFilePath: "src/hooks/useDocumentSync.ts",
    diff: [
      { kind: "context", line: "9", text: "  useEffect(() => {" },
      { kind: "removed", line: "10", text: "    const int = setInterval(…" },
      { kind: "removed", line: "11", text: "      const doc = await fetch…" },
      { kind: "removed", line: "12", text: "    }, 2000);" },
      { kind: "added", line: "9", text: "    const cm = new ConnectionManager();" },
      { kind: "added", line: "10", text: "    cm.connect(`wss://.../doc/${id}`);" },
      { kind: "added", line: "11", text: "    cm.on('delta', applyDelta);" },
    ],
  },
  chat: {
    agent: "AGENT",
    you: "YOU",
    messages: [
      {
        role: "agent",
        stage: "PROBLEM / OPENING",
        evidence: "● EVIDENCE / useDocumentSync.ts",
        text: "실시간 협업 시스템을 만들 때 처음 마주한 핵심 문제가 무엇이었는지 설명해주세요. 어떤 상황이었고, 기존 방식의 어떤 한계 때문에 이 작업을 시작하게 되었나요?",
        time: "14:28",
      },
      {
        role: "you",
        text: "polling 기반 동기화는 평균 2,100ms 지연으로 동시 편집 시 커서가 뒤로 튀는 현상이 반복됐어요. 2~4명이 동시에 편집할 때는 충돌이 눈에 보일 정도였고요.",
        time: "14:30",
      },
      {
        role: "agent",
        stage: "ANALYZE / FOLLOW-UP",
        text: "기존 polling 코드에서 2,100ms 지연이 발생한다는 걸 확인했어요. 실시간 통신 방식으로 어떤 대안들을 고려했나요?",
        time: "14:31",
      },
    ],
    /**
     * 답변 입력칸의 안내와 전송 버튼입니다. 레퍼런스 값(`질문에 답하세요...`)이 아니라 실제 인터뷰
     * 화면이 쓰는 문구를 가져옵니다.
     *
     * 이 미리보기가 보여 주려는 것은 실제 제품 화면이고, 이 Repository는 그 자리의 문구를 이미 다르게
     * 쓰기로 정했습니다(`reference-ko.test.ts`의 `answerQuestion`). 레퍼런스 값을 그대로 옮기면
     * 랜딩에서 본 화면과 로그인한 뒤 화면의 같은 자리가 달라집니다.
     */
    composerPlaceholder: STREAM_VIEW_COPY.answerPlaceholder,
    composerStage: "ANALYZE / IN PROGRESS",
    composerShortcut: "CMD+↵",
    composerSubmit: STREAM_VIEW_COPY.send,
  },
  paar: {
    panelLabel: "Experience",
    progress: "PAAR / 01 OF 04",
    markers: [
      { state: "complete", letter: "P" },
      { state: "in-progress", letter: "A" },
      { state: "empty", letter: "A" },
      { state: "empty", letter: "R" },
    ],
    verifiedLabel: "Verified from Repo",
    verifiedValue: "3 commits · 5 files",
    cards: [
      {
        state: "complete",
        label: "Problem",
        text: "polling 기반 동기화는 평균 2,100ms 지연으로 동시 편집 시 커서가 뒤로 튀는 현상이 반복됐다.",
        /** 저장소에서 확인한 근거가 붙는 카드입니다. 아래 `verifiedLabel`·`verifiedValue`를 답니다. */
        verified: true,
      },
      { state: "in-progress", label: "Analyze", note: "/ IN PROGRESS", text: "Identifying alternatives..." },
      { state: "empty", label: "Action", text: "Not started yet." },
      { state: "empty", label: "Result", text: "Not started yet." },
    ],
  },
} as const;

/**
 * 제품 흐름 네 단계입니다. `label`은 mono 라벨이라 영어로 남습니다. 번호(`01`~`04`)는 화면이
 * 순서에서 만들므로 문구로 두지 않습니다.
 */
const STEPS = {
  /** 이 섹션에는 보이는 제목이 없어 landmark 이름을 여기서 답니다. */
  sectionLabel: "SIFT 사용 흐름",
  items: [
    { label: "ANALYZE", description: "저장소 코드, 커밋 히스토리, 변경 파일, diff를 분석합니다." },
    { label: "DISCOVER", description: "설명할 가치가 있는 개발 경험을 발견합니다." },
    { label: "INTERVIEW", description: "실제 저장소 근거에 기반한 AI 인터뷰를 진행합니다." },
    { label: "STRUCTURE", description: "대화를 Problem · Analyze · Action · Result 구조로 정리합니다." },
  ],
} as const;

/** CODE → CHAT → PAAR 세 열입니다. `label`과 `flow`는 화면에서 쓰는 mono 라벨 그대로입니다. */
const CORE_MODEL = {
  title: "핵심 제품 모델",
  flow: ["CODE", "CHAT", "PAAR"],
  columns: [
    {
      label: "CODE / EVIDENCE",
      question: "실제로 무슨 일이 있었나요?",
      description: "커밋, 변경 파일, diff, 코드를 직접 참조합니다. 저장소에서 실제로 일어난 일만 근거로 삼습니다.",
    },
    {
      label: "INTERVIEW",
      question: "왜 그런 결정을 내렸나요?",
      description: "저장소 근거를 바탕으로 질문합니다. 기술 선택의 이유와 트레이드오프를 이끌어냅니다.",
    },
    {
      label: "EXPERIENCE",
      question: "어떻게 구조화할 수 있나요?",
      description: "대화를 PAAR 구조로 정리합니다. 문제 정의부터 결과까지 일관된 경험 서술을 만듭니다.",
    },
  ],
} as const;

/**
 * 근거 기반 접근 섹션입니다. 오른쪽 목록은 근거 종류 넷의 예시이고 레퍼런스 값 그대로입니다.
 * `tag`는 근거 구분 태그, `value`와 `sub`는 커밋 SHA와 파일 경로 자리라 셋 다 영어입니다.
 */
const EVIDENCE = {
  title: "근거 기반 접근",
  headline: ["추측이 아니라", "근거로 만들어집니다."],
  subtext:
    "SIFT는 저장소에서 검증된 사실과 사용자가 제공한 맥락을 명확히 구분합니다. 실제 커밋, 변경 파일, 코드, diff만이 저장소 근거로 인정됩니다. 검증되지 않은 정보를 근거로 제시하지 않습니다.",
  samples: [
    { tag: "COMMIT", value: "a3f91c0", sub: "add presence sync via BroadcastChannel" },
    { tag: "CHANGED FILE", value: "useDocumentSync.ts", sub: "src/hooks/useDocumentSync.ts" },
    { tag: "DIFF", value: "+cm.connect(url)", sub: "replace polling with WebSocket" },
    { tag: "CODE", value: "scheduleReconnect()", sub: "exponential backoff implementation" },
  ],
} as const;

/** 마지막 CTA입니다. 약관 동의 문장은 로그인 화면이 쓰던 조각을 그대로 씁니다. */
const FINAL = {
  label: "시작하기",
  headline: ["코드 속에 숨겨진", "경험을 발견하세요."],
} as const;

export const LANDING_COPY = {
  hero: HERO,
  preview: PREVIEW,
  steps: STEPS,
  coreModel: CORE_MODEL,
  evidence: EVIDENCE,
  final: FINAL,
  /**
   * CTA 문구는 로그인 화면이 쓰던 것과 같은 값입니다. 여기서 다시 쓰지 않고 `LOGIN_COPY`를
   * 가져옵니다. 레퍼런스에서도 `landingCTA`와 로그인 버튼이 같은 문장이고, 두 곳에 각각 두면
   * 한쪽만 고쳐질 수 있습니다.
   */
  cta: LOGIN_COPY.continueWithGitHub,
  termsSentence: LOGIN_COPY.termsSentence,
} as const;

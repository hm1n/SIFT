/**
 * 꼬리 질문 경로의 모델을 확정하기 위한 실측 스크립트입니다. 이슈 #79이고 수동 실행이며 vitest
 * 스위트에 포함되지 않습니다.
 *
 * 실행:
 *   GITHUB_TOKEN=$(gh auth token) npx tsx --env-file=<.env 경로> \
 *     src/features/interview/measurement/followup-question-model.measure.mts --pr=61
 *
 * 옵션:
 *   --owner=<소유자>          기본 hm1n
 *   --repo=<저장소>           기본 demian
 *   --pr=<번호>               근거로 쓸 Pull Request. 기본 61
 *   --max-commits=<N>         PR에서 가져올 커밋 수 상한. 기본 6
 *   --max-input-tokens=<N>    근거 스냅샷 상한. 기본 5250(운영값)
 *   --turns=<N>               측정할 마지막 턴. 기본 10(`INTERVIEW_MAX_TURNS`)
 *   --answer=short|long|both  답변 길이 시나리오. 기본 both
 *   --models=<id,id>          비교할 모델. 기본 gemini-3.1-flash-lite,gemini-3.5-flash-lite
 *   --canonical=<id>          이력에 쌓을 질문을 만드는 모델. 기본 --models의 첫 값
 *   --repeat=<N>              같은 시나리오 반복 횟수. 기본 1
 *   --max-output-tokens=<N>   출력 상한을 걸고 잽니다. 지정하지 않으면 상한 없이 잽니다
 *   --out=<경로>              질문 원문을 적을 Markdown 경로. 지정하지 않으면 쓰지 않습니다
 *   --dry-run                 LLM을 부르지 않고 입력 크기와 픽스처 검증만 합니다
 *
 * 재는 것:
 *   - 턴별·모델별 첫 청크 지연, 총 지연, 청크 수, 출력 길이. 판정 기준은 첫 청크 지연이고
 *     판정선은 20초(`INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS`)입니다.
 *   - 입출력 토큰과 캐시 읽기 토큰(`inputTokenDetails.cacheReadTokens`). 암묵적 캐싱이 자동으로
 *     걸리는지를 문서가 아니라 응답으로 확인합니다.
 *   - 응답 헤더의 잔여 한도. 제약이 "한도는 문서가 아니라 응답 헤더로 확인한다"입니다.
 *   - 질문 원문. 품질 판정은 사람이 읽고 합니다.
 *   - 질문이 이력 항목 상한 `INTERVIEW_HISTORY_ITEM_MAX_BYTES`를 넘는지. 넘는 질문은 운영에서
 *     생성 실패로 취급되므로 그 빈도가 `maxOutputTokens`를 정하는 근거입니다.
 *
 * ## 왜 두 모델에 같은 이력을 싣는가
 *
 * 모델마다 자기 질문을 이력에 쌓게 두면 3턴째부터 입력이 갈립니다. 그러면 지연 차이가 모델
 * 차이인지 입력 차이인지 가릴 수 없습니다. 그래서 이력은 `--canonical` 모델의 질문으로만 쌓고,
 * 매 턴 두 모델에 **같은 이력**을 실어 각각 재고 각각의 질문을 남깁니다. 대신 비교 대상이 아닌
 * 모델은 자기가 만들지 않은 대화를 이어받게 되는데, 판정 기준 셋(답변 요약으로 시작, 앞 턴 질문
 * 중복, 사용자 답변을 사실로 전제) 가운데 어느 것도 질문의 저자가 누구인지에 기대지 않습니다.
 *
 * ## 재지 않는 것
 *
 * 사용자 답변은 고정 픽스처입니다. 실제 사용자가 질문을 읽고 쓴 답변이 아니므로 답변이 질문에
 * 대응하지 않습니다. 두 모델에 같은 입력을 실어야 한다는 조건과 맞바꾼 것이고, 이 맞바꿈이 없으면
 * 지연 비교 자체가 성립하지 않습니다.
 *
 * ## 운영 프롬프트와 갈라지지 않게 하는 장치
 *
 * 프롬프트를 여기서 다시 접지 않고 운영 코드 `buildInterviewQuestionPrompt`와
 * `toInterviewQuestionMessages`를 그대로 부릅니다. 그 위에 시스템 프롬프트가 이력 유무에 따라
 * 갈렸는지를 매 턴 단언합니다(`assertProductionPrompt`). 손으로 확인하던 항목입니다
 * (`llm-wiki/wiki/2026-09-08-꼬리질문-요청계약-후속-backlog.md` 4번).
 *
 * 출력에는 수치와 질문·답변 원문만 담습니다. 토큰 문자열과 키를 출력하지 않습니다.
 */

import { streamText } from "ai";
import { writeFileSync } from "node:fs";
import { createInterviewQuestionModel } from "../../experience-candidates/llm-provider";
import {
  INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS,
  INTERVIEW_QUESTION_MAX_PROMPT_BYTES,
  INTERVIEW_QUESTION_MAX_RETRIES,
  INTERVIEW_QUESTION_MODEL,
  INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS,
  buildInterviewQuestionPrompt,
  interviewQuestionPromptBytes,
  toInterviewQuestionMessages,
  type InterviewQuestionPrompt,
} from "../question-generation";
import {
  renderInterviewEvidencePrompt,
  renderInterviewQuestionSystemPrompt,
} from "../question-prompt";
import {
  INTERVIEW_HISTORY_ITEM_MAX_BYTES,
  INTERVIEW_HISTORY_MAX_ITEMS,
  INTERVIEW_MAX_TURNS,
  interviewHistoryItemBytes,
  type InterviewHistoryMessage,
} from "../history";
import { buildSnapshot } from "./evidence-fixture.mjs";
import {
  averageUsagePerRound,
  canonicalQuestionOf,
  completeRounds,
  datasetShortfall,
  interviewCost,
  priceFor,
  type UsageRow,
} from "./cost.mjs";

// ---------------------------------------------------------------------------
// 인자
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const has = (name: string) => args.includes(`--${name}`);

const owner = flag("owner", "hm1n");
const repo = flag("repo", "demian");
const maxCommits = Number(flag("max-commits", "6"));
const maxInputTokens = Number(flag("max-input-tokens", "5250"));
const maxTurns = Number(flag("turns", String(INTERVIEW_MAX_TURNS)));
const repeat = Number(flag("repeat", "1"));
const models = flag("models", `${INTERVIEW_QUESTION_MODEL},gemini-3.5-flash-lite`)
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value !== "");
const canonicalModel = flag("canonical", models[0] ?? INTERVIEW_QUESTION_MODEL);
const maxOutputTokensRaw = flag("max-output-tokens", "");
const maxOutputTokens = maxOutputTokensRaw === "" ? null : Number(maxOutputTokensRaw);
const outPath = flag("out", "");
const dryRun = has("dry-run");
const answerScenarioFlag = flag("answer", "both");
const pullRequestNumber = Number(flag("pr", "61"));

// 단가를 모르는 모델이 섞여 있으면 호출을 쓰기 전에 끊습니다. 다 돌린 뒤에 비용 표에서
// 깨지면 그만큼의 호출과 요금이 버려집니다.
for (const model of models) priceFor(model);

if (!models.includes(canonicalModel)) {
  console.error(`--canonical=${canonicalModel}은 --models 안에 있어야 합니다.`);
  process.exit(1);
}
if (maxTurns > INTERVIEW_MAX_TURNS) {
  // 11턴째 요청부터 가장 오래된 질문·답변 쌍이 이력에서 빠집니다. 입력 크기가 10턴에서 최대이고
  // 그 뒤로는 평평해지므로, 그 구간의 값을 턴에 따른 증가로 읽으면 틀립니다.
  console.error(
    `--turns는 ${INTERVIEW_MAX_TURNS} 이하여야 합니다. ` +
      `이력 항목 상한 ${INTERVIEW_HISTORY_MAX_ITEMS}개 때문에 그 뒤로는 절단이 걸립니다.`
  );
  process.exit(1);
}

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
  console.error("GITHUB_TOKEN이 필요합니다. GITHUB_TOKEN=$(gh auth token) 형태로 넘겨 주세요.");
  process.exit(1);
}
if (!dryRun && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error("GOOGLE_GENERATIVE_AI_API_KEY가 필요합니다. --env-file로 넘겨 주세요.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 답변 픽스처
// ---------------------------------------------------------------------------
// 두 구간만 씁니다. 짧은 답변과 긴 답변에서 지연이 갈리는지를 보는 것이 목적이고, 중간 구간은
// 두 끝 사이에 들어오므로 호출 수만 늘립니다.
//
// **긴 답변은 상한 안에 있어야 합니다.** 항목 하나가 `INTERVIEW_HISTORY_ITEM_MAX_BYTES`를 넘으면
// 운영에서는 `submitAnswer`가 요청을 아예 보내지 않습니다. 픽스처가 상한을 넘으면 측정이 조용히
// 비므로 아래에서 단언합니다.
//
// 긴 답변에는 **저장소 근거로 확인할 수 없는 주장**을 일부러 넣었습니다("30명 중 28명"). 모델이
// 사용자 답변을 사실로 전제해 다음 질문을 만드는지가 판정 기준 셋 중 하나이고, 그 위반은 근거에
// 없는 주장이 답변에 들어 있을 때만 드러납니다.

const SHORT_ANSWERS: readonly string[] = [
  "청크가 도착할 때마다 setState를 부르다가 긴 메시지에서 입력창 타이핑이 밀리는 게 보였습니다. 버퍼에 쌓고 프레임마다 한 번만 반영하도록 바꿨습니다. 추측으로 고치지 않으려고 4,919자 메시지의 재파싱 비용을 먼저 쟀고 2.94밀리초였습니다. 그 숫자를 보고 호출 수를 줄이는 쪽이 맞다고 판단했습니다.",
  "전송은 SSE로 갔습니다. WebSocket을 쓰면 연결 상태와 재연결을 직접 관리해야 하는데, 우리가 보내는 것은 서버에서 클라이언트로 가는 텍스트 조각뿐입니다. 양방향이 필요 없는데 양방향 프로토콜을 쓰면 관리 비용만 늘어난다고 봤습니다. 브라우저가 EventSource로 재연결을 대신해 주는 것도 이유였습니다.",
  "자동 스크롤과 수동 스크롤이 부딪히는 문제를 따로 처리했습니다. 사용자가 위로 올려 읽는 중이면 새 청크가 도착해도 스크롤을 내리지 않고 새 메시지 안내만 띄웁니다. 처음에는 바닥에서 몇 픽셀 떨어졌는지로 판정했는데, 이미지가 늦게 로드되어 높이가 바뀌면 사용자가 아무것도 하지 않았는데 판정이 뒤집혔습니다.",
  "Syntax Highlighting은 스트리밍이 끝난 뒤에만 겁니다. 스트리밍 중에는 코드 블록이 닫히지 않은 상태라 파싱 결과가 매 청크 달라지는데 그 비용을 매번 치를 이유가 없었습니다. 대신 미완성 코드 블록도 고정폭 글꼴로는 보이게 해서 하이라이팅이 걸리는 순간 형태가 갑자기 바뀌지 않게 했습니다.",
  "가상 스크롤은 검토했지만 넣지 않았습니다. 메시지 높이가 코드 블록 때문에 제각각이라 높이를 미리 알 수 없고, 추정 높이로 넣으면 스크롤 위치가 튑니다. 인터뷰 턴이 10으로 묶여 있어 DOM 노드 수가 문제가 되는 구간에 닿지 않는다고 봤고, 10턴을 채운 화면에서 끊김은 재현되지 않았습니다.",
  "메시지가 쌓일 때 리스트 전체가 다시 렌더되고 있었습니다. 스트리밍 중인 마지막 메시지만 바뀌는데도 이전 메시지가 모두 다시 그려졌습니다. 메시지 컴포넌트를 메모이제이션하고 스트리밍 중인 메시지만 별도 컴포넌트로 떼어내서 리렌더 범위를 그 하나로 좁혔습니다.",
  "스트림이 중간에 끊겼을 때 이어받는 방식은 넣지 않았습니다. 같은 질문을 다시 만들어 낼 수 없어서 중간부터 이어 붙이면 앞뒤가 맞지 않는 문장이 남습니다. 그래서 끊기면 그 메시지를 통째로 버리고 처음부터 다시 생성합니다. 이미 절반쯤 읽은 답을 버리게 되는 것은 이 선택의 대가입니다.",
  "오류를 첫 청크 전과 후로 갈랐습니다. 첫 청크 전이면 화면에 아무것도 없으니 HTTP 상태와 본문에 분류를 실어 보내고 안내를 갈라 보여 줍니다. 첫 청크 후에는 이미 표시된 내용이 있어 되돌릴 수 없으니 스트림 안의 이벤트로 알립니다. 그래서 첫 청크 시한을 총 시한과 따로 뒀습니다.",
  "측정은 두 군데로 나눠서 했습니다. Markdown 파싱과 하이라이팅 같은 연산 비용은 Node에서 재고, 누적된 DOM의 레이아웃과 스크롤 비용은 실제 브라우저에서 쟀습니다. 두 비용의 성격이 달라서 한 숫자로 묶으면 어느 쪽을 고쳐야 하는지가 안 보였습니다.",
  "프레임 예약 여부를 handle 값과 따로 둔 것은 handle 0이 유효한 값이라 그것만으로 예약 여부를 판정할 수 없었기 때문입니다. 그리고 스트림이 끝나는 시점에는 예약된 프레임을 취소하고 즉시 반영합니다. 마지막 조각이 버퍼에 남은 채 프레임을 기다리면 완료 신호와 화면 내용이 어긋납니다.",
];

/**
 * 긴 답변은 크기 시나리오입니다. 이력 항목 상한 `INTERVIEW_HISTORY_ITEM_MAX_BYTES` 가까이 채운
 * 답변이 턴마다 쌓일 때 첫 청크 지연이 움직이는지를 보는 것이 목적입니다.
 *
 * **이 시나리오의 질문은 품질 판정에 쓰지 않습니다.** 같은 본문이 매 턴 실리므로 5턴을 넘기면 두
 * 모델 모두 "같은 답변을 반복한다"고 지적하는 쪽으로 대화가 굳습니다. 그 굳음은 모델의 성질이
 * 아니라 픽스처가 만든 것입니다. 품질은 턴마다 내용이 다른 짧은 답변 시나리오에서 봅니다.
 *
 * 저장소 근거로 확인할 수 없는 주장("30명 중 28명")을 일부러 넣었습니다. 모델이 사용자 답변을
 * 사실로 전제해 다음 질문을 만드는지가 판정 기준 셋 중 하나이고, 그 위반은 근거에 없는 주장이
 * 답변에 들어 있을 때만 드러납니다.
 */
const LONG_ANSWER_EXTRA = [
  "반영이 최대 한 프레임 늦어지므로 아주 짧은 메시지에서는 예전보다 미세하게 늦게 보입니다.",
  "실제 사용자 테스트에서 30명 중 28명이 그 차이를 못 느꼈다고 답해서 그대로 두기로 했습니다.",
  "추측으로 먼저 고치지 않고 숫자를 보고 고친 것이 이 작업에서 제일 중요했던 부분이라고 생각합니다.",
] as const;

/**
 * 상한에 닿을 때까지 문단을 이어 붙입니다. 상한을 넘기는 문단은 붙이지 않습니다.
 *
 * 길이를 손으로 맞추지 않는 이유는 문단을 고치면 그때마다 다시 세어야 하고, 한 번 넘기면 운영에서
 * 요청이 아예 나가지 않아 측정이 조용히 비기 때문입니다.
 */
function buildLongAnswer(): string {
  let text = "";
  for (const paragraph of [...SHORT_ANSWERS, ...LONG_ANSWER_EXTRA]) {
    const next = text === "" ? paragraph : `${text} ${paragraph}`;
    if (interviewHistoryItemBytes({ role: "answer", text: next }) > INTERVIEW_HISTORY_ITEM_MAX_BYTES) {
      break;
    }
    text = next;
  }
  return text;
}

const LONG_ANSWER = buildLongAnswer();

interface AnswerScenario {
  readonly id: "short" | "long";
  readonly label: string;
  /** 턴 번호로 답변을 고릅니다. 짧은 답변은 턴마다 다르고 긴 답변은 매 턴 같습니다. */
  readonly answerFor: (turn: number) => string;
  /** 품질 판정에 쓰는 시나리오인지입니다. 긴 답변은 크기만 봅니다. */
  readonly forQuality: boolean;
}

const ALL_SCENARIOS: readonly AnswerScenario[] = [
  {
    id: "short",
    label: "짧은 답변",
    // 턴마다 다른 답변을 씁니다. 같은 답변을 되풀이하면 5턴을 넘기며 두 모델 모두 "같은 답변을
    // 반복한다"고 지적하는 쪽으로 대화가 굳어, 질문 품질이 아니라 픽스처를 재게 됩니다.
    answerFor: (turn) => SHORT_ANSWERS[(turn - 1) % SHORT_ANSWERS.length],
    forQuality: true,
  },
  { id: "long", label: "긴 답변", answerFor: () => LONG_ANSWER, forQuality: false },
];

const scenarios =
  answerScenarioFlag === "both"
    ? ALL_SCENARIOS
    : ALL_SCENARIOS.filter((scenario) => scenario.id === answerScenarioFlag);
if (scenarios.length === 0) {
  console.error(`--answer는 short, long, both 중 하나여야 합니다: ${answerScenarioFlag}`);
  process.exit(1);
}

/**
 * 픽스처가 운영 상한 안에 있는지 봅니다.
 *
 * 상한을 넘긴 답변은 운영에서 요청이 나가지 않으므로, 이 단언이 없으면 측정이 조용히 비어 있는
 * 결과와 정상 결과를 구별할 수 없습니다. 재는 대상이 아니라 재는 조건이므로 실행 전에 끊습니다.
 */
function assertFixturesWithinLimits(): void {
  for (const scenario of scenarios) {
    // 턴마다 답변이 다르므로 한 건만 재면 상한을 넘긴 턴을 놓칩니다. 모든 턴을 봅니다.
    const sizes = Array.from({ length: maxTurns }, (_, index) => {
      const text = scenario.answerFor(index + 1);
      return { chars: text.length, bytes: interviewHistoryItemBytes({ role: "answer", text }) };
    });
    const worst = sizes.reduce((left, right) => (right.bytes > left.bytes ? right : left));
    if (worst.bytes > INTERVIEW_HISTORY_ITEM_MAX_BYTES) {
      console.error(
        `${scenario.label} 픽스처가 이력 항목 상한을 넘습니다: ${worst.bytes} > ${INTERVIEW_HISTORY_ITEM_MAX_BYTES}바이트`
      );
      process.exit(1);
    }
    console.log(
      `${scenario.label} 픽스처 최대 ${worst.chars}자 · 직렬화 ${worst.bytes}바이트 ` +
        `(상한 ${INTERVIEW_HISTORY_ITEM_MAX_BYTES}의 ${((worst.bytes / INTERVIEW_HISTORY_ITEM_MAX_BYTES) * 100).toFixed(1)}%)` +
        `${scenario.forQuality ? " · 품질 판정 대상" : " · 크기 시나리오"}`
    );
  }
}

// ---------------------------------------------------------------------------
// 운영 프롬프트 추적 단언
// ---------------------------------------------------------------------------

/**
 * 측정이 배포되는 프롬프트를 따라가는지 봅니다.
 *
 * `buildInterviewQuestionPrompt`가 이력 유무로 시스템 프롬프트를 가릅니다. 이력이 붙은 호출에는
 * 꼬리 질문 규칙 넷이 더 실리고 그 몫이 턴마다 약 120토큰입니다. 측정이 첫 질문 쪽 프롬프트를
 * 쓰면 지연도 토큰도 배포되는 값을 설명하지 못합니다.
 */
function assertProductionPrompt(prompt: InterviewQuestionPrompt, turn: number): void {
  const expected = renderInterviewQuestionSystemPrompt(undefined, turn > 1);
  if (prompt.system !== expected) {
    throw new Error(
      `턴 ${turn}의 시스템 프롬프트가 운영 값과 다릅니다. 이력 ${prompt.history.length}개.`
    );
  }
  const bytes = interviewQuestionPromptBytes(prompt);
  if (bytes > INTERVIEW_QUESTION_MAX_PROMPT_BYTES) {
    throw new Error(
      `턴 ${turn}의 프롬프트가 route 가드 상한을 넘습니다: ${bytes} > ${INTERVIEW_QUESTION_MAX_PROMPT_BYTES}바이트`
    );
  }
}

// ---------------------------------------------------------------------------
// 한 번의 생성
// ---------------------------------------------------------------------------

interface Measurement {
  readonly model: string;
  readonly turn: number;
  readonly firstChunkMs: number | null;
  readonly totalMs: number;
  readonly chunks: number;
  readonly text: string;
  readonly promptBytes: number;
  readonly questionBytes: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly rateLimit: string;
  readonly failure: string | null;
}

/**
 * 잔여 한도를 응답 헤더에서 읽습니다. 제공자가 이름을 바꿔도 남는 것이 있도록 접두사로 걷습니다.
 * 헤더 자체를 그대로 찍지 않고 한도 관련 항목만 추립니다.
 */
function summarizeRateLimit(headers: Record<string, string> | undefined): string {
  if (!headers) return "헤더 없음";
  const picked = Object.entries(headers)
    .filter(([name]) => name.toLowerCase().startsWith("x-ratelimit") || name.toLowerCase() === "retry-after")
    .map(([name, value]) => `${name}=${value}`);
  return picked.length === 0 ? "한도 헤더 없음" : picked.join(" ");
}

/**
 * 한 턴을 한 모델로 생성하면서 잽니다.
 *
 * 운영 호출과 같은 인자를 씁니다. 다른 것은 둘입니다. `maxOutputTokens`는 상한을 정하려고 재는
 * 값이라 옵션으로 걸고, 첫 청크 시한을 abort로 걸지 않습니다. **시한을 걸면 판정선을 넘은 값이
 * 20초로 잘려 얼마나 넘었는지가 사라집니다.** 대신 총 시한에서만 끊고 넘김 여부를 기록합니다.
 */
async function measureOnce(
  model: string,
  prompt: InterviewQuestionPrompt,
  turn: number
): Promise<Measurement> {
  const controller = new AbortController();
  const totalTimer = setTimeout(() => controller.abort(), INTERVIEW_QUESTION_TOTAL_TIMEOUT_MS);
  const startedAt = performance.now();
  let firstChunkMs: number | null = null;
  let chunks = 0;
  let text = "";
  let failure: string | null = null;

  const result = streamText({
    model: createInterviewQuestionModel(model),
    system: prompt.system,
    messages: toInterviewQuestionMessages(prompt),
    abortSignal: controller.signal,
    maxRetries: INTERVIEW_QUESTION_MAX_RETRIES,
    ...(maxOutputTokens === null ? {} : { maxOutputTokens }),
  });

  try {
    for await (const part of result.fullStream) {
      if (part.type === "text-delta") {
        const delta = (part as { text?: string }).text ?? "";
        if (delta === "") continue;
        if (firstChunkMs === null) firstChunkMs = performance.now() - startedAt;
        chunks += 1;
        text += delta;
        continue;
      }
      if (part.type === "error") throw (part as { error: unknown }).error;
      if (part.type === "abort") throw new Error("총 시한에서 끊겼습니다.");
    }
  } catch (error) {
    failure = (error as Error).message;
  } finally {
    clearTimeout(totalTimer);
  }

  const totalMs = performance.now() - startedAt;

  // usage와 response는 실패한 호출에서도 확정됩니다. 여기서 잡지 않으면 처리되지 않은 거절이
  // 남아 프로세스가 그 이유로 끝날 수 있습니다.
  const usage = await Promise.resolve(result.usage).catch(() => null);
  const response = await Promise.resolve(result.response).catch(() => null);

  return {
    model,
    turn,
    firstChunkMs,
    totalMs,
    chunks,
    text,
    promptBytes: interviewQuestionPromptBytes(prompt),
    questionBytes: interviewHistoryItemBytes({ role: "question", text }),
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    rateLimit: summarizeRateLimit(
      (response as { headers?: Record<string, string> } | null)?.headers
    ),
    failure,
  };
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

function ms(value: number | null): string {
  return value === null ? "-" : `${Math.round(value)}ms`;
}

/** 판정선을 넘었는지 표시합니다. 판정선은 SSE 라우트의 첫 청크 시한을 그대로 씁니다. */
function verdict(firstChunkMs: number | null): string {
  if (firstChunkMs === null) return "첫 청크 없음";
  const ratio = (firstChunkMs / INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS) * 100;
  return `${ratio.toFixed(1)}%${firstChunkMs > INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS ? " 초과" : ""}`;
}

interface RunResult {
  readonly scenario: AnswerScenario;
  readonly round: number;
  readonly measurements: readonly Measurement[];
}

async function runScenario(
  snapshot: Awaited<ReturnType<typeof buildSnapshot>>,
  scenario: AnswerScenario,
  round: number
): Promise<RunResult> {
  const history: InterviewHistoryMessage[] = [];
  const measurements: Measurement[] = [];

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    const prompt = buildInterviewQuestionPrompt(snapshot, { history: [...history] });
    assertProductionPrompt(prompt, turn);

    if (dryRun) {
      console.log(
        `[dry-run] ${scenario.label} 턴 ${turn} · 이력 ${history.length}개 · ` +
          `프롬프트 ${interviewQuestionPromptBytes(prompt)}바이트`
      );
      history.push({ role: "question", text: "(dry-run 질문 자리)" });
      history.push({ role: "answer", text: scenario.answerFor(turn) });
      continue;
    }

    let canonicalNext: string | null = null;
    for (const model of models) {
      const measurement = await measureOnce(model, prompt, turn);
      measurements.push(measurement);
      if (model === canonicalModel) canonicalNext = canonicalQuestionOf(measurement);
      console.log(
        [
          `${scenario.label} R${round}`,
          `턴 ${turn}`,
          model,
          `첫 청크 ${ms(measurement.firstChunkMs)} (${verdict(measurement.firstChunkMs)})`,
          `총 ${ms(measurement.totalMs)}`,
          `청크 ${measurement.chunks}`,
          `입력 ${measurement.inputTokens ?? "-"}`,
          `출력 ${measurement.outputTokens ?? "-"}`,
          `캐시읽기 ${measurement.cacheReadTokens ?? "-"}`,
          `질문 ${measurement.questionBytes}바이트`,
          measurement.failure === null ? "" : `실패: ${measurement.failure}`,
        ]
          .filter((part) => part !== "")
          .join(" | ")
      );
      if (measurement.questionBytes > INTERVIEW_HISTORY_ITEM_MAX_BYTES) {
        console.log(
          `  ↑ 이 질문은 이력 항목 상한 ${INTERVIEW_HISTORY_ITEM_MAX_BYTES}바이트를 넘어 운영에서 생성 실패로 취급됩니다.`
        );
      }
    }

    // 이력은 한 모델의 질문으로만 쌓습니다. 모델마다 자기 질문을 쌓으면 다음 턴부터 입력이 갈려
    // 지연 차이가 모델 차이인지 입력 차이인지 가릴 수 없습니다.
    // 본문이 비었는지로 판정하지 않습니다. 첫 조각이 도착한 뒤 오류가 나면 본문은 남아 있는데
    // 질문은 완성되지 않았고, 그 잘린 본문 위에 다음 턴을 쌓으면 이후 측정이 모두 망가집니다.
    if (canonicalNext === null) {
      console.log(
        `턴 ${turn}에서 ${canonicalModel}이 쓸 수 있는 질문을 내지 못해 이 회차를 끊습니다. ` +
          `이 회차는 비용 표에서 빠집니다.`
      );
      break;
    }
    history.push({ role: "question", text: canonicalNext });
    history.push({ role: "answer", text: scenario.answerFor(turn) });
  }

  return { scenario, round, measurements };
}

/** 질문 원문을 사람이 읽을 수 있게 적습니다. 품질 판정이 사람 손에 있으므로 원문을 남깁니다. */
function renderTranscript(
  snapshotLabel: string,
  snapshot: Awaited<ReturnType<typeof buildSnapshot>>,
  runs: readonly RunResult[]
): string {
  const lines: string[] = [
    `# 꼬리 질문 모델 비교 · 질문 원문`,
    "",
    `- 근거: ${snapshotLabel}`,
    `- 모델: ${models.join(", ")} (이력을 쌓은 모델: ${canonicalModel})`,
    `- 출력 상한: ${maxOutputTokens === null ? "없음" : `${maxOutputTokens}토큰`}`,
    `- 판정 기준 셋: 답변 요약으로 시작 / 앞 턴 질문 중복 / 사용자 답변을 사실로 전제`,
    "",
    // 질문만 늘어놓으면 그 질문이 무엇을 읽고 나온 것인지 판정할 수 없습니다. 모델이 실제로 받은
    // 것을 그대로 싣습니다. 두 프롬프트는 운영 코드가 만든 값이고 여기서 다시 접지 않습니다.
    `## 모델에 보낸 것 · 시스템 프롬프트(첫 질문, 턴 1)`,
    "",
    "```",
    renderInterviewQuestionSystemPrompt(undefined, false),
    "```",
    "",
    `## 모델에 보낸 것 · 시스템 프롬프트(꼬리 질문, 턴 2 이후)`,
    "",
    "```",
    renderInterviewQuestionSystemPrompt(undefined, true),
    "```",
    "",
    `## 모델에 보낸 것 · 근거 프롬프트(매 턴 전량 다시 실림)`,
    "",
    "```",
    renderInterviewEvidencePrompt(snapshot),
    "```",
    "",
    `## 모델에 보낸 것 · 턴별 사용자 답변`,
    "",
  ];
  for (const scenario of scenarios) {
    lines.push(`### ${scenario.label}`, "");
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const text = scenario.answerFor(turn);
      lines.push(`턴 ${turn} 제출 답변 (${text.length}자)`, "", "```", text, "```", "");
      // 긴 답변은 매 턴 같은 본문이므로 한 번만 싣습니다.
      if (!scenario.forQuality) break;
    }
  }
  for (const run of runs) {
    lines.push(
      `## ${run.scenario.label} · ${run.round}회차` +
        (run.scenario.forQuality ? "" : " (크기 시나리오 · 품질 판정 대상 아님)"),
      ""
    );
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const turnRows = run.measurements.filter((entry) => entry.turn === turn);
      if (turnRows.length === 0) continue;
      lines.push(`### 턴 ${turn}`, "");
      // 질문만 늘어놓으면 그 질문이 무엇에 대한 꼬리 질문인지 읽을 수 없습니다. 이 턴이 받은
      // 답변, 즉 직전 턴에 제출된 답변을 질문 앞에 둡니다.
      if (turn > 1) {
        lines.push(
          `직전 턴 사용자 답변`,
          "",
          "```",
          run.scenario.answerFor(turn - 1),
          "```",
          ""
        );
      }
      for (const row of turnRows) {
        lines.push(
          `#### ${row.model}${row.model === canonicalModel ? " (이력에 쌓임)" : ""}`,
          "",
          `첫 청크 ${ms(row.firstChunkMs)} · 총 ${ms(row.totalMs)} · 출력 ${row.outputTokens ?? "-"}토큰 · ${row.questionBytes}바이트`,
          "",
          row.failure === null ? row.text : `생성 실패: ${row.failure}`,
          ""
        );
      }
    }
  }
  return lines.join("\n");
}

/**
 * 이 실행이 낸 표본이 몇 개인지 못박습니다.
 *
 * 1차 리뷰 지적이 이것입니다. 회차를 여러 번 돌린 뒤 문서에 옮길 때 어느 실행의 값인지가 흐려져
 * 서로 다른 실행의 수치가 한 표에 섞였고, 모델당 호출 수보다 큰 캐시 히트 수가 근거로 적혔습니다.
 *
 * 그래서 실행이 스스로 표본 수를 세고 기대한 수와 다르면 요약을 내기 전에 끊습니다. 문서에는 이
 * 줄이 낸 수치만 옮깁니다.
 */
function describeDataset(runs: readonly RunResult[]): { line: string; shortfall: string | null } {
  const expected = runs.length * maxTurns * models.length;
  const actual = runs.reduce((total, run) => total + run.measurements.length, 0);
  return {
    line:
      `데이터셋: 시나리오 ${scenarios.length} × 회차 ${repeat} × 턴 ${maxTurns} × 모델 ${models.length} ` +
      `= 생성 호출 ${expected}건 기대, 실제 ${actual}건 (모델당 ${actual / models.length}건)`,
    shortfall: datasetShortfall(expected, actual),
  };
}

function summarize(runs: readonly RunResult[]): void {
  console.log(`\n${"=".repeat(78)}`);
  console.log("요약 · 첫 청크 지연(밀리초)");
  console.log(`${"=".repeat(78)}`);
  const dataset = describeDataset(runs);
  console.log(dataset.line);
  if (dataset.shortfall !== null) console.log(`경고: ${dataset.shortfall}`);
  const failed = runs.flatMap((run) => run.measurements).filter((entry) => entry.failure !== null);
  console.log(
    failed.length === 0
      ? "실패한 호출 0건"
      : `실패한 호출 ${failed.length}건: ${failed.map((entry) => `${entry.model} 턴 ${entry.turn}`).join(", ")}`
  );
  console.log(["시나리오", "모델", "표본", "최소", "중앙", "최대", "판정선 20초 초과"].join(" | "));
  for (const scenario of scenarios) {
    for (const model of models) {
      const values = runs
        .filter((run) => run.scenario.id === scenario.id)
        .flatMap((run) => run.measurements)
        .filter((entry) => entry.model === model && entry.firstChunkMs !== null)
        .map((entry) => entry.firstChunkMs as number)
        .sort((left, right) => left - right);
      if (values.length === 0) {
        console.log([scenario.label, model, "0", "-", "-", "-", "측정 없음"].join(" | "));
        continue;
      }
      const over = values.filter(
        (value) => value > INTERVIEW_QUESTION_FIRST_CHUNK_TIMEOUT_MS
      ).length;
      console.log(
        [
          scenario.label,
          model,
          `${values.length}`,
          `${Math.round(values[0])}`,
          `${Math.round(values[Math.floor(values.length / 2)])}`,
          `${Math.round(values[values.length - 1])}`,
          `${over}/${values.length}`,
        ].join(" | ")
      );
    }
  }

  console.log(`\n출력 토큰 · maxOutputTokens를 정하는 근거`);
  console.log(
    ["모델", "표본", "최소", "최대", "질문 최대 바이트", "토큰당 최대 바이트", "상한 초과"].join(" | ")
  );
  for (const model of models) {
    const rows = runs.flatMap((run) => run.measurements).filter((entry) => entry.model === model);
    const outputs = rows
      .map((entry) => entry.outputTokens)
      .filter((value): value is number => value !== null);
    const bytes = rows.map((entry) => entry.questionBytes);
    const over = bytes.filter((value) => value > INTERVIEW_HISTORY_ITEM_MAX_BYTES).length;
    // 토큰당 바이트의 최대는 출력 상한을 유도하는 값입니다. 실행이 직접 내야 문서에 적은 값과
    // 갈리지 않습니다.
    const ratios = rows
      .filter((entry) => entry.outputTokens !== null && entry.outputTokens > 0)
      .map((entry) => entry.questionBytes / (entry.outputTokens as number));
    console.log(
      [
        model,
        `${rows.length}`,
        outputs.length === 0 ? "-" : `${Math.min(...outputs)}`,
        outputs.length === 0 ? "-" : `${Math.max(...outputs)}`,
        bytes.length === 0 ? "-" : `${Math.max(...bytes)}`,
        ratios.length === 0 ? "-" : Math.max(...ratios).toFixed(2),
        `${over}/${bytes.length}`,
      ].join(" | ")
    );
  }

  console.log(`
캐시 읽기 · 분모는 그 모델의 호출 수입니다`);
  for (const model of models) {
    const modelRows = runs
      .flatMap((run) => run.measurements)
      .filter((entry) => entry.model === model);
    const hits = modelRows.filter(
      (entry) => entry.cacheReadTokens !== null && entry.cacheReadTokens > 0
    );
    console.log(
      `${model}: ${hits.length}/${modelRows.length}건` +
        (hits.length === 0
          ? " (암묵적 캐싱이 걸린 흔적 없음)"
          : `, 최대 ${Math.max(...hits.map((entry) => entry.cacheReadTokens as number))}토큰`)
    );
  }

  const cacheRows = runs
    .flatMap((run) => run.measurements)
    .filter((entry) => entry.cacheReadTokens !== null && entry.cacheReadTokens > 0);
  console.log(
    `\n캐시 읽기 토큰이 잡힌 호출: ${cacheRows.length}건. ` +
      (cacheRows.length === 0
        ? "이 실행에서는 암묵적 캐싱이 걸린 흔적이 없습니다."
        : `최대 ${Math.max(...cacheRows.map((entry) => entry.cacheReadTokens as number))}토큰.`)
  );

  const limits = new Set(
    runs.flatMap((run) => run.measurements).map((entry) => entry.rateLimit)
  );
  console.log(`잔여 한도 헤더: ${[...limits].join(" / ")}`);

  reportCost(runs);
}

/**
 * 실제 usage로 회당 비용을 냅니다.
 *
 * 2026-09-03과 2026-09-08 값은 `countTokens`로 센 입력에 첫 질문 실측 출력을 빌려 온 것이었습니다.
 * 여기서는 생성 호출이 실제로 쓴 토큰을 그대로 씁니다.
 *
 * 이 스크립트의 턴 1은 이력이 없으므로 첫 질문 호출과 같습니다. 따라서 아래 합계는 인터뷰 한 번의
 * LLM 비용 가운데 질문 생성 몫 전체이고, 여기에 Stage A·B 몫만 더하면 인터뷰 한 번의 총액입니다.
 *
 * 계산은 `cost.mts`에 있습니다. 단가는 모델마다 다르고, 중간에 끊긴 회차는 평균에서 뺍니다. 둘 다
 * 틀리면 표가 정상으로 보이면서 값만 낮아집니다.
 */
function reportCost(runs: readonly RunResult[]): void {
  console.log(`
회당 비용 · 실제 usage 기준`);
  console.log(
    ["시나리오", "모델", "입력", "캐시읽기", "출력", "질문 생성 몫", "인터뷰 한 번", "10달러", "쓴 회차"].join(
      " | "
    )
  );
  for (const scenario of scenarios) {
    for (const model of models) {
      const rows: UsageRow[] = runs
        .filter((run) => run.scenario.id === scenario.id)
        .flatMap((run) =>
          run.measurements
            .filter((entry) => entry.model === model)
            .map((entry) => ({
              round: run.round,
              turn: entry.turn,
              inputTokens: entry.inputTokens,
              outputTokens: entry.outputTokens,
              cacheReadTokens: entry.cacheReadTokens,
            }))
        );
      const selection = completeRounds(rows, maxTurns);
      const totals = averageUsagePerRound(selection);
      const used = `${selection.complete.length}/${selection.complete.length + selection.skipped.length}`;
      if (totals === null) {
        console.log(
          [scenario.label, model, "-", "-", "-", "-", "-", "-", `${used} · 온전한 회차 없음`].join(" | ")
        );
        continue;
      }
      const price = priceFor(model);
      const total = interviewCost(totals, price);
      console.log(
        [
          scenario.label,
          model,
          `${Math.round(totals.inputTokens)}`,
          `${Math.round(totals.cacheReadTokens)}`,
          `${Math.round(totals.outputTokens)}`,
          `${(total - 0.02025).toFixed(5)}달러`,
          `${total.toFixed(5)}달러`,
          `${Math.floor(10 / total)}회`,
          selection.skipped.length === 0 ? used : `${used} · ${selection.skipped.join(",")}회차 제외`,
        ].join(" | ")
      );
    }
  }
}

async function main(): Promise<void> {
  console.log(
    `PR #${pullRequestNumber} · 커밋 상한 ${maxCommits} · 근거 상한 ${maxInputTokens}토큰 · ` +
      `턴 1~${maxTurns} · 반복 ${repeat}회 · 모델 ${models.join(", ")}`
  );
  assertFixturesWithinLimits();

  const snapshot = await buildSnapshot(
    { owner, repo, token: githubToken!, maxCommits, maxInputTokens },
    pullRequestNumber
  );
  const snapshotLabel = `${owner}/${repo} PR #${pullRequestNumber} · 커밋 ${
    1 + snapshot.relatedCommits.length
  }개 · patch ${snapshot.patchBudget.patchBytes}바이트`;
  console.log(snapshotLabel);

  const runs: RunResult[] = [];
  for (const scenario of scenarios) {
    for (let round = 1; round <= repeat; round += 1) {
      runs.push(await runScenario(snapshot, scenario, round));
    }
  }

  // 질문 원문을 먼저 적습니다. 요약이 먼저 오면 그쪽에서 무슨 일이 생겼을 때 이미 쓴 호출의
  // 결과까지 함께 잃습니다. dry-run에서도 파일은 씁니다. 모델에 보낸 것은 생성 호출 없이도
  // 확정되므로 그 부분만 다시 뽑을 때 호출과 요금을 쓰지 않게 합니다.
  if (outPath !== "") {
    writeFileSync(outPath, renderTranscript(snapshotLabel, snapshot, runs), "utf8");
    console.log(`
${dryRun ? "모델에 보낸 것을" : "질문 원문을"} ${outPath}에 적었습니다.`);
  }
  if (dryRun) return;
  summarize(runs);

  // 온전하지 않은 실행을 종료 코드로 알립니다. 값을 감추지 않으면서도 문서에 옮겨도 되는 실행인지를
  // 가릅니다. 앞 단계에서 던지면 회차 제외와 비용 표와 원문 저장이 모두 도달 불가능해집니다.
  if (describeDataset(runs).shortfall !== null) process.exitCode = 1;
}

await main();

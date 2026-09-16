import { createOpenAI } from "@ai-sdk/openai";
import { requireLocalModel, resolveLocalLlm } from "@/features/experience-candidates/llm-provider";

/**
 * 블록 갱신 호출의 provider입니다. 프로덕션은 OpenAI(`gpt-5.6-luna`, 이슈 #88 확정)이고, 로컬 전환은
 * 다른 인터뷰 경로와 같이 `STAGE_A_MODEL`이 가리키는 Groq 호환 엔드포인트를 씁니다. 블록 갱신 전용
 * 로컬 모델 환경변수를 새로 만들지 않는 이유는 `createInterviewQuestionModel`과 같습니다. 로컬은
 * 모델 하나를 띄워 쓰는 환경이라 환경변수를 늘리면 로컬 완주에 필요한 설정만 늘어납니다.
 *
 * `OPENAI_API_KEY`는 `@ai-sdk/openai`가 기본으로 읽으므로 여기서 따로 배선하지 않습니다.
 */
export function createBlockUpdateModel(model: string) {
  const local = resolveLocalLlm();
  if (!local) return createOpenAI()(model);
  return requireLocalModel(local, local.stageAModel, "STAGE_A_MODEL");
}

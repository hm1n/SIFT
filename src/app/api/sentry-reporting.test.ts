import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleFindAnalysis, handleSaveAnalysis } from "./analyses/route";
import { handleGetAnalysis } from "./analyses/[id]/route";
import { handleDeleteInterview, handlePatchInterview } from "./interviews/[id]/route";
import { handleStageA } from "./candidates/stage-a/route";
import { handlePurge } from "./cron/purge/route";
import { handleInterviewQuestionStream } from "./interview/stream/route";
import { handleExperienceBlockUpdate } from "./interview/experience-block/route";
import { emptyExperienceBlockState } from "@/features/experience-block/types";
import { evidenceSnapshotFixture } from "@/features/interview/question-fixture";

/**
 * 라우트가 실제로 오류를 Sentry로 넘기는지 봅니다(이슈 #136).
 *
 * `src/lib/sentry/report.test.ts`가 status 기준 자체를 고정하고, 이 파일은 그 기준이 라우트에 실제로
 * 배선돼 있는지를 봅니다. 둘을 나누는 이유는 이슈 #136의 원인이 판정 로직이 틀린 것이 아니라 오류가
 * SDK까지 가는 경로가 아예 없던 것이기 때문입니다. 배선이 빠지면 판정 테스트는 그대로 통과합니다.
 *
 * SDK를 mock합니다. 실제 전송을 일으키지 않고 `captureException`에 무엇이 넘어오는지만 봅니다.
 */
const reported = vi.fn();
vi.mock("@sentry/nextjs", () => ({
  init: () => undefined,
  captureException: (...args: unknown[]) => reported(...args),
  captureRequestError: () => undefined,
}));

const OWNER_ID = 44727850;

let savedKey: string | undefined;
let savedSecret: string | undefined;

beforeEach(() => {
  reported.mockReset();
  savedKey = process.env[GITHUB_SESSION_KEY_ENV];
  savedSecret = process.env.CRON_SECRET;
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
  process.env.CRON_SECRET = "cron-secret-value";
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[GITHUB_SESSION_KEY_ENV];
  else process.env[GITHUB_SESSION_KEY_ENV] = savedKey;
  if (savedSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = savedSecret;
});

function cookieFor(githubUserId: number = OWNER_ID): string {
  return `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId })}`;
}

function request(
  url: string,
  { body, method = "POST", authenticated = true, headers = {} }: {
    body?: unknown;
    method?: string;
    authenticated?: boolean;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  return new NextRequest(`https://example.com${url}`, {
    method,
    headers: { ...(authenticated ? { cookie: cookieFor() } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

/** 언제나 오류를 던지는 저장 계층입니다. 연결이 끊긴 상태를 흉내 냅니다. */
function brokenStore(kind: "query_failed" | "config_missing" = "query_failed"): SiftStore {
  const fail = async () => {
    throw new DatabaseError(kind, "흉내 낸 오류");
  };
  return {
    saveAnalysis: fail, getAnalysis: fail, getLatestAnalysisByRepo: fail, createInterview: fail,
    appendTurn: fail, appendHistory: fail, listInterviews: fail, getInterview: fail,
    completeInterview: fail, deleteInterview: fail, purgeInterviewsOpenedBefore: fail,
    purgeAnalysesWithoutInterviews: fail,
  } as unknown as SiftStore;
}

const ANALYSIS = {
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: ["성능 개선"],
  candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
  stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
};

describe("5xx 응답은 Sentry로 갑니다", () => {
  /**
   * 저장 계층이 답하지 않는 경우입니다. 이슈 #136의 Why가 적은 "Neon 질의 실패"가 이 갈래입니다.
   * 라우트마다 따로 확인하는 이유는 catch가 라우트마다 따로 있기 때문입니다.
   */
  /**
   * 저장 계층이 답하지 않는 경우입니다. 이슈 #136의 Why가 적은 "Neon 질의 실패"가 이 갈래입니다.
   *
   * 라우트를 전수로 훑지 않습니다. 저장 계층을 쓰는 라우트 일곱 개의 catch가 전부
   * `savedInterviewErrorResponseFor` 하나를 지나므로 그 함수를 한 번 지나면 같은 배선을 확인합니다.
   * cron purge는 자기 catch에서 직접 감싸므로 따로 봅니다.
   */
  it.each([
    [
      "savedInterviewErrorResponseFor를 지나는 라우트",
      () => handleSaveAnalysis(request("/api/analyses", { body: { analysis: ANALYSIS } }), brokenStore()),
    ],
    [
      "GET /api/cron/purge",
      () =>
        handlePurge(
          request("/api/cron/purge", {
            method: "GET",
            headers: { authorization: "Bearer cron-secret-value" },
          }),
          brokenStore()
        ),
    ],
  ])("%s가 저장소 실패로 5xx를 내면 보고한다", async (_label, call) => {
    const response = await call();
    expect(response.status).toBeGreaterThanOrEqual(500);
    expect(reported).toHaveBeenCalledTimes(1);
    expect(reported.mock.calls[0]?.[0]).toBeInstanceOf(DatabaseError);
  });

  /**
   * 세션 쿠키는 있는데 암호화 키 설정이 없는 경우입니다. 사용자가 다시 로그인해도 풀리지 않는 서버
   * 설정 문제라 500으로 나가고, 배포에서 이것이 조용하면 로그인 전체가 막힌 것을 알 수 없습니다.
   */
  it.each([
    [
      "GET /api/analyses",
      () => request("/api/analyses?owner=hm1n&repo=SIFT", { method: "GET" }),
      (req: NextRequest) => handleFindAnalysis(req, createInMemoryStore()),
    ],
    [
      "DELETE /api/interviews/[id]",
      () => request("/api/interviews/x", { method: "DELETE" }),
      (req: NextRequest) => handleDeleteInterview(req, "x", createInMemoryStore()),
    ],
    [
      "POST /api/interview/stream",
      () => request("/api/interview/stream", { body: {} }),
      (req: NextRequest) => handleInterviewQuestionStream(req),
    ],
  ])("%s가 세션 설정 문제로 500을 내면 보고한다", async (_label, make, call) => {
    // 쿠키를 만든 뒤에 키를 지웁니다. 세션은 있는데 서버가 그것을 풀 수 없는 상태입니다.
    const req = make();
    delete process.env[GITHUB_SESSION_KEY_ENV];
    const response = await call(req);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { kind: "server_error" } });
    expect(reported).toHaveBeenCalledTimes(1);
  });
});

describe("4xx 응답은 Sentry로 가지 않습니다", () => {
  /**
   * 이슈 #136의 Goal입니다. 사용자 입력 문제가 Issues에 섞이면 실제 장애가 묻힙니다. 각 항목은 이 앱이
   * 실제로 내보내는 4xx 갈래입니다.
   */
  it.each([
    [
      "401 unauthorized",
      401,
      () => handleSaveAnalysis(request("/api/analyses", { body: { analysis: ANALYSIS }, authenticated: false }), createInMemoryStore()),
    ],
    [
      "400 invalid_request",
      400,
      () => handleFindAnalysis(request("/api/analyses", { method: "GET" }), createInMemoryStore()),
    ],
    [
      "400 invalid_json",
      400,
      () => handlePatchInterview(request("/api/interviews/x", { method: "PATCH", body: "{" }), "x", createInMemoryStore()),
    ],
    [
      "404 not_found",
      404,
      () => handleGetAnalysis(request("/api/analyses/x", { method: "GET" }), "x", createInMemoryStore()),
    ],
    [
      "422 invalid_request",
      422,
      () => handleStageA(request("/api/candidates/stage-a", { body: { units: [] } })),
    ],
    [
      "413 body_too_large",
      413,
      () =>
        handleStageA(
          request("/api/candidates/stage-a", {
            body: { units: [] },
            headers: { "content-length": String(5 * 1024 * 1024) },
          })
        ),
    ],
  ])("%s는 보고하지 않는다", async (_label, status, call) => {
    const response = await call();
    expect(response.status).toBe(status);
    expect(reported).not.toHaveBeenCalled();
  });
});

describe("Sentry 이벤트에 사용자 답변 본문을 싣지 않습니다", () => {
  /**
   * PR #138 리뷰 1라운드에서 받은 지적입니다.
   *
   * 모델 출력이 검증을 통과하지 못하면 502로 거절하는데, 그 `detail`에 모델이 생성한 문장이 섞입니다
   * (`reducer.ts`의 `no_claim_reference`가 `sentence.text`를 30자까지 자릅니다). 그 문장은 사용자의
   * 답변을 모델이 다시 쓴 것이라, Sentry로 그대로 보내면 이슈 #136의 제약을 어깁니다.
   *
   * Sentry가 `message`와 `cause.message`를 싣고 비표준 속성은 싣지 않는 것은 2026-09-16에
   * 실측했습니다. 그래서 `message`에 무엇이 들어가는지가 이 경로의 전부입니다.
   */
  it("모델 출력 거절을 보고할 때 문장은 빼고 분류만 보낸다", async () => {
    const sentence = "재시도 큐를 붙여 실패한 요청을 다시 보냈습니다";
    const output = {
      ops: [],
      // 주장 참조가 없는 표시 문장입니다. `no_claim_reference`로 걸리면서 문장이 detail에 실립니다.
      display: [{ block: "problem", sentences: [{ text: sentence, claimRefs: [] }] }],
      evaluation: [],
      targetResponse: "provided",
    };
    const body = {
      snapshot: evidenceSnapshotFixture(),
      history: [{ turnId: "t1", question: "질문", answer: sentence }],
      state: emptyExperienceBlockState(),
      targetBlock: "problem",
      targetElement: "a",
      answerTurnId: "t1",
    };

    const response = await handleExperienceBlockUpdate(
      request("/api/interview/experience-block", { body }),
      { generate: (async () => output) as never, store: createInMemoryStore() }
    );

    expect(response.status).toBe(502);
    // 사용자에게 가는 응답은 그대로입니다. 어느 문장이 왜 걸렸는지는 화면에서 필요합니다.
    const payload = (await response.json()) as { error: { kind: string; message: string } };
    expect(payload.error.kind).toBe("block_update_rejected");
    expect(payload.error.message).toContain(sentence.slice(0, 30));

    expect(reported).toHaveBeenCalledTimes(1);
    const sent = reported.mock.calls[0]?.[0] as Error;
    expect(sent.message).toContain("no_claim_reference");
    expect(sent.message).not.toContain(sentence.slice(0, 30));
  });
});

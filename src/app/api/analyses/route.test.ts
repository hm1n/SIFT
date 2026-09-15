import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_SAVE_ANALYSIS_BODY_BYTES } from "@/features/saved-interviews/request";
import { DatabaseError } from "@/lib/db/client";
import { createInMemoryStore } from "@/lib/db/in-memory-store";
import type { SiftStore } from "@/lib/db/store";
import {
  encryptGitHubSession,
  GITHUB_SESSION_COOKIE,
  GITHUB_SESSION_KEY_ENV,
} from "@/lib/github/auth-session";
import { handleGetAnalysis } from "./[id]/route";
import { handleFindAnalysis, handleSaveAnalysis } from "./route";

const OWNER_ID = 44727850;
const OTHER_ID = 13579246;

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env[GITHUB_SESSION_KEY_ENV];
  process.env[GITHUB_SESSION_KEY_ENV] = Buffer.alloc(32, 7).toString("base64");
});

afterEach(() => {
  if (savedKey === undefined) delete process.env[GITHUB_SESSION_KEY_ENV];
  else process.env[GITHUB_SESSION_KEY_ENV] = savedKey;
});

function cookieFor(githubUserId: number): string {
  return `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token: "token", githubUserId })}`;
}

function request(
  body: unknown,
  { userId = OWNER_ID, authenticated = true, method = "POST", query = "", headers = {} }: {
    userId?: number;
    authenticated?: boolean;
    method?: string;
    query?: string;
    headers?: Record<string, string>;
  } = {}
): NextRequest {
  return new NextRequest(`https://example.com/api/analyses${query}`, {
    method,
    headers: { ...(authenticated ? { cookie: cookieFor(userId) } : {}), ...headers },
    ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const ANALYSIS = {
  repoOwner: "hm1n",
  repoName: "SIFT",
  contributionItems: ["성능 개선"],
  candidates: { candidates: { candidates: [], insufficientCandidatesReason: null, diffs: [] }, includedCommits: [] },
  stageASummary: { excludedUnits: [], selectedUnitCount: 0, thresholdScore: 0, unjudgedShas: [] },
};

function saveBody(overrides: Record<string, unknown> = {}) {
  return { analysis: { ...ANALYSIS, ...overrides } };
}

/** 언제나 오류를 던지는 저장 계층입니다. 연결이 끊긴 상태를 흉내 냅니다. */
function brokenStore(kind: "query_failed" | "config_missing"): SiftStore {
  const fail = async () => {
    throw new DatabaseError(kind, "흉내 낸 오류");
  };
  return {
    saveAnalysis: fail, getAnalysis: fail, getLatestAnalysisByRepo: fail, createInterview: fail,
    appendTurn: fail, listInterviews: fail, getInterview: fail, completeInterview: fail,
    deleteInterview: fail, purgeInterviewsOpenedBefore: fail,
  } as unknown as SiftStore;
}

describe("POST /api/analyses", () => {
  it("분석 한 줄을 저장하고 식별자를 돌려준다", async () => {
    const store = createInMemoryStore();

    const response = await handleSaveAnalysis(request(saveBody()), store);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(typeof body.analysisId).toBe("string");
    expect(await store.getAnalysis(body.analysisId, OWNER_ID)).toMatchObject({
      repoOwner: "hm1n",
      repoName: "SIFT",
    });
  });

  /** 저장한 사람의 것으로만 남습니다. 사용자 번호는 요청 본문이 아니라 세션에서 옵니다. */
  it("다른 사용자는 저장된 분석을 읽지 못한다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await (await handleSaveAnalysis(request(saveBody()), store)).json();

    expect(await store.getAnalysis(analysisId, OTHER_ID)).toBeNull();
  });

  it("세션이 없으면 401이다", async () => {
    const response = await handleSaveAnalysis(request(saveBody(), { authenticated: false }), createInMemoryStore());

    expect(response.status).toBe(401);
    expect((await response.json()).error.kind).toBe("unauthorized");
  });

  it("JSON이 아니면 400이다", async () => {
    const response = await handleSaveAnalysis(request("{"), createInMemoryStore());

    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("invalid_json");
  });

  it.each([
    ["analysis가 없으면", { analysis: undefined }],
    ["저장소 이름이 비었으면", { analysis: { ...ANALYSIS, repoOwner: " " } }],
    ["기여 항목이 문자열 배열이 아니면", { analysis: { ...ANALYSIS, contributionItems: [1] } }],
    ["후보가 객체가 아니면", { analysis: { ...ANALYSIS, candidates: [] } }],
    ["Stage A 요약이 없으면", { analysis: { ...ANALYSIS, stageASummary: undefined } }],
    /**
     * 바깥 모양만 보면 이 넷이 통과해 저장되고, 읽는 자리도 같은 검사를 쓰므로 멀쩡한 분석으로
     * 돌아옵니다. 화면은 `data.includedCommits.map`과 후보 목록에서 멈춥니다(PR #130 리뷰).
     */
    ["후보 칸이 비어 있으면", { analysis: { ...ANALYSIS, candidates: {} } }],
    ["Stage A 요약이 비어 있으면", { analysis: { ...ANALYSIS, stageASummary: {} } }],
    [
      "후보 하나의 모양이 어긋나면",
      {
        analysis: {
          ...ANALYSIS,
          candidates: {
            candidates: { candidates: [{ sha: "a1" }], insufficientCandidatesReason: null, diffs: [] },
            includedCommits: [],
          },
        },
      },
    ],
    [
      "커밋의 파일 목록이 없으면",
      {
        analysis: {
          ...ANALYSIS,
          candidates: { ...ANALYSIS.candidates, includedCommits: [{ sha: "a1" }] },
        },
      },
    ],
  ])("%s 400이다", async (_label, body) => {
    const response = await handleSaveAnalysis(request(body), createInMemoryStore());

    expect(response.status).toBe(400);
    expect((await response.json()).error.kind).toBe("invalid_request");
  });

  it("선언한 길이가 상한을 넘으면 본문을 읽기 전에 413이다", async () => {
    const response = await handleSaveAnalysis(
      request(saveBody(), { headers: { "content-length": String(MAX_SAVE_ANALYSIS_BODY_BYTES + 1) } }),
      createInMemoryStore()
    );

    expect(response.status).toBe(413);
  });

  it.each([
    ["query_failed", 503, "storage_failed"],
    ["config_missing", 500, "server_error"],
  ] as const)("저장 계층이 %s를 던지면 %i이다", async (kind, status, errorKind) => {
    const response = await handleSaveAnalysis(request(saveBody()), brokenStore(kind));

    expect(response.status).toBe(status);
    expect((await response.json()).error.kind).toBe(errorKind);
  });
});

describe("GET /api/analyses", () => {
  const find = (store: SiftStore, query: string, userId = OWNER_ID) =>
    handleFindAnalysis(request(null, { method: "GET", query, userId }), store);

  it("저장소 이름으로 저장된 분석을 돌려준다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await (await handleSaveAnalysis(request(saveBody()), store)).json();

    const body = await (await find(store, "?owner=hm1n&repo=SIFT")).json();

    expect(body.analysis).toMatchObject({ id: analysisId, repoOwner: "hm1n", repoName: "SIFT" });
  });

  /** 같은 저장소를 다시 분석하면 줄이 하나 더 생깁니다. 앞선 분석은 그때의 커밋만 담고 있습니다. */
  it("같은 저장소를 여러 번 분석했으면 마지막 것을 돌려준다", async () => {
    const store = createInMemoryStore();
    await handleSaveAnalysis(request(saveBody()), store);
    const { analysisId: latest } = await (
      await handleSaveAnalysis(request(saveBody({ contributionItems: ["다시 분석"] })), store)
    ).json();

    const body = await (await find(store, "?owner=hm1n&repo=SIFT")).json();

    expect(body.analysis.id).toBe(latest);
    expect(body.analysis.contributionItems).toEqual(["다시 분석"]);
  });

  // JSON에는 날짜 타입이 없습니다. 타입만 `Date`로 남으면 받는 쪽이 `getTime()`을 부르다 깨집니다.
  it("저장 시각을 ISO 문자열로 내보낸다", async () => {
    const store = createInMemoryStore();
    await handleSaveAnalysis(request(saveBody()), store);

    const body = await (await find(store, "?owner=hm1n&repo=SIFT")).json();

    expect(new Date(body.analysis.createdAt).toISOString()).toBe(body.analysis.createdAt);
  });

  it("저장된 분석이 없으면 404이다", async () => {
    const response = await find(createInMemoryStore(), "?owner=hm1n&repo=SIFT");

    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("not_found");
  });

  it("남의 분석은 없는 것으로 답한다", async () => {
    const store = createInMemoryStore();
    await handleSaveAnalysis(request(saveBody()), store);

    expect((await find(store, "?owner=hm1n&repo=SIFT", OTHER_ID)).status).toBe(404);
  });

  /**
   * 저장 경계를 통과하지 못하는 값이라도 저장 계층에는 이미 그런 줄이 남아 있을 수 있습니다. 모양이
   * 바뀌기 전에 쓴 줄입니다. 읽는 자리에서도 걸러야 화면이 깨지지 않습니다(PR #130 리뷰).
   */
  it("저장된 값이 지금 화면이 그릴 수 있는 모양이 아니면 없는 것으로 답한다", async () => {
    const store = createInMemoryStore();
    await handleSaveAnalysis(request(saveBody()), store);
    const broken = {
      ...store,
      getLatestAnalysisByRepo: async () => ({
        id: "a1",
        repoOwner: "hm1n",
        repoName: "SIFT",
        contributionItems: [],
        candidates: {},
        stageASummary: {},
        createdAt: new Date(),
      }),
    } as unknown as SiftStore;

    const response = await find(broken, "?owner=hm1n&repo=SIFT");

    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("not_found");
  });

  it.each([["?owner=hm1n"], ["?repo=SIFT"], ["?owner=&repo=SIFT"], [""]])(
    "저장소 이름이 갖춰지지 않은 %s는 400이다",
    async (query) => {
      const response = await find(createInMemoryStore(), query);

      expect(response.status).toBe(400);
      expect((await response.json()).error.kind).toBe("invalid_request");
    }
  );

  it("세션이 없으면 401이다", async () => {
    const response = await handleFindAnalysis(
      request(null, { method: "GET", query: "?owner=hm1n&repo=SIFT", authenticated: false }),
      createInMemoryStore()
    );

    expect(response.status).toBe(401);
  });
});

describe("GET /api/analyses/[id]", () => {
  it("식별자로 저장된 분석을 돌려준다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await (await handleSaveAnalysis(request(saveBody()), store)).json();

    const body = await (
      await handleGetAnalysis(request(null, { method: "GET" }), analysisId, store)
    ).json();

    expect(body.analysis).toMatchObject({ id: analysisId, repoOwner: "hm1n" });
  });

  it("없는 분석은 404이다", async () => {
    const response = await handleGetAnalysis(
      request(null, { method: "GET" }),
      "11111111-1111-4111-8111-111111111111",
      createInMemoryStore()
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error.kind).toBe("not_found");
  });

  /** 구분해 알려 주면 남의 분석이 있는지 없는지를 알 수 있게 됩니다. */
  it("남의 분석도 없는 것과 같은 답이다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await (await handleSaveAnalysis(request(saveBody()), store)).json();

    const mine = await handleGetAnalysis(request(null, { method: "GET" }), "11111111-1111-4111-8111-111111111111", store);
    const theirs = await handleGetAnalysis(
      request(null, { method: "GET", userId: OTHER_ID }),
      analysisId,
      store
    );

    expect(theirs.status).toBe(mine.status);
    expect((await theirs.json()).error).toEqual((await mine.json()).error);
  });

  /**
   * 저장된 값은 오래전에 쓴 것일 수 있습니다. 그대로 실어 보내면 후보 목록을 그리는 도중에 깨지므로
   * 읽는 자리에서 거릅니다.
   */
  it("저장된 값이 지금 모양이 아니면 404로 답한다", async () => {
    const store = createInMemoryStore();
    const analysisId = await store.saveAnalysis({
      githubUserId: OWNER_ID,
      repoOwner: "hm1n",
      repoName: "SIFT",
      contributionItems: "문자열 배열이 아님",
      candidates: {},
      stageASummary: {},
    });

    const response = await handleGetAnalysis(request(null, { method: "GET" }), analysisId, store);

    expect(response.status).toBe(404);
  });

  it("세션이 없으면 401이다", async () => {
    const response = await handleGetAnalysis(
      request(null, { method: "GET", authenticated: false }),
      "11111111-1111-4111-8111-111111111111",
      createInMemoryStore()
    );

    expect(response.status).toBe(401);
  });
});

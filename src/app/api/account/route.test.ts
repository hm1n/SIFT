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
import type { RevokeGrantResult } from "@/lib/github/oauth";
import { handleDeleteAccount } from "./route";

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
  vi.restoreAllMocks();
});

function request(
  { userId = OWNER_ID, token = "user-token", authenticated = true, body }: {
    userId?: number;
    token?: string;
    authenticated?: boolean;
    body?: unknown;
  } = {}
): NextRequest {
  return new NextRequest("https://example.com/api/account", {
    method: "DELETE",
    headers: authenticated
      ? { cookie: `${GITHUB_SESSION_COOKIE}=${encryptGitHubSession({ token, githubUserId: userId })}` }
      : {},
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seed(store: SiftStore, githubUserId = OWNER_ID) {
  const analysisId = await store.saveAnalysis({
    githubUserId,
    repoOwner: "hm1n",
    repoName: "SIFT",
    contributionItems: [],
    candidates: {},
    stageASummary: {},
  });
  const interviewId = await store.createInterview({
    githubUserId,
    analysisId,
    candidateKey: "c1",
    title: "스트리밍 렌더링 최적화",
    evidence: { commits: ["sha-1"] },
  });
  if (interviewId === null) throw new Error("seed failed");
  return { analysisId, interviewId };
}

const revoked = async (): Promise<RevokeGrantResult> => ({ status: "revoked" });

function brokenStore(): SiftStore {
  const fail = async () => {
    throw new DatabaseError("query_failed", "흉내 낸 오류");
  };
  return { ...createInMemoryStore(), deleteUserData: fail } as unknown as SiftStore;
}

describe("회원 탈퇴", () => {
  it("저장된 분석과 인터뷰를 지우고 세션 쿠키를 지운다", async () => {
    const store = createInMemoryStore();
    const { analysisId, interviewId } = await seed(store);

    const response = await handleDeleteAccount(request(), store, revoked);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1, revoked: true });
    expect(response.headers.get("set-cookie")).toContain(`${GITHUB_SESSION_COOKIE}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await store.getAnalysis(analysisId, OWNER_ID)).toBeNull();
    expect(await store.getInterview(interviewId, OWNER_ID)).toBeNull();
    expect(await store.listInterviews(OWNER_ID)).toEqual([]);
  });

  /**
   * 이슈 #145 Constraint입니다. 대상은 세션의 사용자 번호로만 정하고 요청은 대상을 지정할 수
   * 없어야 합니다. 본문에 남의 번호를 실어 보내도 그 사람의 데이터는 남습니다.
   */
  it("본문으로 대상을 지정할 수 없고 다른 사용자의 데이터는 남는다", async () => {
    const store = createInMemoryStore();
    const mine = await seed(store);
    const theirs = await seed(store, OTHER_ID);

    const response = await handleDeleteAccount(
      request({ body: { githubUserId: OTHER_ID } }),
      store,
      revoked
    );

    expect(await response.json()).toEqual({ deleted: 1, revoked: true });
    expect(await store.getAnalysis(mine.analysisId, OWNER_ID)).toBeNull();
    expect(await store.getAnalysis(theirs.analysisId, OTHER_ID)).not.toBeNull();
    expect(await store.getInterview(theirs.interviewId, OTHER_ID)).not.toBeNull();
  });

  /** 이슈 #145 Approach입니다. 해제가 실패해도 데이터 삭제는 끝나야 합니다. */
  it.each(["config_missing", "invalid_credentials", "rate_limit", "rejected", "network"] as const)(
    "권한 해제가 %s로 실패해도 데이터는 지우고 남은 사실을 알린다",
    async (reason) => {
      const store = createInMemoryStore();
      const { analysisId } = await seed(store);
      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const response = await handleDeleteAccount(request(), store, async () => ({ status: "failed", reason }));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ deleted: 1, revoked: false });
      expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
      expect(await store.getAnalysis(analysisId, OWNER_ID)).toBeNull();
    }
  );

  it("권한 해제에는 세션의 토큰을 넘긴다", async () => {
    const store = createInMemoryStore();
    await seed(store);
    const revoke = vi.fn(revoked);

    await handleDeleteAccount(request({ token: "세션-토큰" }), store, revoke);

    expect(revoke).toHaveBeenCalledWith("세션-토큰");
  });

  /** 저장한 적 없는 계정입니다. 지울 것이 없었을 뿐이므로 실패가 아닙니다. */
  it("지울 데이터가 없어도 성공이고 권한은 해제한다", async () => {
    const revoke = vi.fn(revoked);

    const response = await handleDeleteAccount(request(), createInMemoryStore(), revoke);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 0, revoked: true });
    expect(revoke).toHaveBeenCalledOnce();
  });

  /**
   * 지우지 못한 채 토큰을 죽이면 사용자가 다시 시도할 자리가 사라집니다. 쿠키도 남겨야 다음 화면이
   * 로그인 상태로 그려지고 사용자가 무엇이 남았는지 볼 수 있습니다.
   */
  it("삭제가 실패하면 권한을 해제하지 않고 쿠키도 남긴다", async () => {
    const revoke = vi.fn(revoked);

    const response = await handleDeleteAccount(request(), brokenStore(), revoke);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { kind: "storage_failed" } });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(revoke).not.toHaveBeenCalled();
  });

  it("세션이 없으면 401이고 저장 계층과 GitHub을 건드리지 않는다", async () => {
    const store = createInMemoryStore();
    const { analysisId } = await seed(store);
    const revoke = vi.fn(revoked);

    const response = await handleDeleteAccount(request({ authenticated: false }), store, revoke);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { kind: "unauthorized" } });
    expect(revoke).not.toHaveBeenCalled();
    expect(await store.getAnalysis(analysisId, OWNER_ID)).not.toBeNull();
  });

  /** 세션 쿠키는 있는데 암호화 키 설정이 없거나 어긋난 경우입니다. 다시 로그인해도 풀리지 않습니다. */
  it("세션을 풀 수 없으면 500이고 아무것도 지우지 않는다", async () => {
    const authenticated = request();
    delete process.env[GITHUB_SESSION_KEY_ENV];
    const store = createInMemoryStore();
    const revoke = vi.fn(revoked);

    const response = await handleDeleteAccount(authenticated, store, revoke);

    expect(response.status).toBe(500);
    expect(revoke).not.toHaveBeenCalled();
  });
});

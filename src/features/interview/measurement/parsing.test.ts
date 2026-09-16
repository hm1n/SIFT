import { describe, expect, it } from "vitest";
import { CachedContentParseError, parseCreatedCache } from "./cache-response.mjs";
import {
  CommitDetailCollectError,
  PullRequestCommitShaError,
  collectCommitDetails,
  collectShas,
  type CommitShaPage,
} from "./evidence-fixture.mjs";
import type { CommitDetail } from "../../../lib/github/types";

describe("캐시 생성 응답 읽기", () => {
  it("정상 응답에서 이름과 캐시 토큰을 읽는다", () => {
    const created = parseCreatedCache(
      "gemini-3.1-flash-lite",
      JSON.stringify({ name: "cachedContents/abc", usageMetadata: { totalTokenCount: 4001 } })
    );

    expect(created).toEqual({ name: "cachedContents/abc", totalTokenCount: 4001 });
  });

  it("성공 상태인데 본문이 JSON이 아니면 분류가 있는 오류가 된다", () => {
    // 감싸지 않으면 분류 없는 SyntaxError만 남아 어느 모델의 어느 단계에서 깨졌는지가 사라지고,
    // 던지는 자리가 정리 경로보다 앞이라 이미 만들어진 캐시를 지우지도 못합니다.
    expect(() => parseCreatedCache("gemini-3.5-flash-lite", "<html>502</html>")).toThrow(
      CachedContentParseError
    );
    try {
      parseCreatedCache("gemini-3.5-flash-lite", "<html>502</html>");
    } catch (error) {
      expect((error as Error).message).toContain("gemini-3.5-flash-lite");
    }
  });

  it("본문이 잘려도 분류가 있는 오류가 된다", () => {
    expect(() => parseCreatedCache("gemini-3.1-flash-lite", '{"name":"cachedCon')).toThrow(
      CachedContentParseError
    );
  });

  it("필드가 없어도 던지지 않고 없는 채로 돌려준다", () => {
    // 이름이 없으면 지울 수 없다는 것이 결과이지 오류가 아닙니다.
    expect(parseCreatedCache("gemini-3.1-flash-lite", "{}")).toEqual({});
  });
});

describe("PR 커밋 페이지 따라가기", () => {
  function page(shas: string[], next: string | null): CommitShaPage {
    return { shas, next };
  }

  it("링크를 따라가며 모은다", async () => {
    const pages: Record<string, CommitShaPage> = {
      first: page(["a", "b"], "second"),
      second: page(["c"], null),
    };

    expect(await collectShas(10, "first", async (url) => pages[url])).toEqual(["a", "b", "c"]);
  });

  it("뒤 페이지가 깨져도 앞 페이지에서 모은 SHA를 오류에 남긴다", async () => {
    // 2페이지 본문이 깨졌다고 1페이지에서 이미 받은 커밋까지 버리면 부르는 쪽이 처음부터 다시
    // 받아야 하고 그동안 쓴 요청도 함께 버려집니다.
    const fetchPage = async (url: string): Promise<CommitShaPage> => {
      if (url === "first") return page(["a", "b"], "second");
      throw new Error("PR 커밋 목록 응답을 읽지 못했습니다.");
    };

    await expect(collectShas(10, "first", fetchPage)).rejects.toThrow(PullRequestCommitShaError);
    try {
      await collectShas(10, "first", fetchPage);
    } catch (error) {
      expect((error as PullRequestCommitShaError).collectedShas).toEqual(["a", "b"]);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it("상한을 채우면 다음 페이지를 부르지 않는다", async () => {
    let calls = 0;
    const fetchPage = async (): Promise<CommitShaPage> => {
      calls += 1;
      return page(["a", "b", "c"], "next");
    };

    expect(await collectShas(2, "first", fetchPage)).toEqual(["a", "b", "c"]);
    expect(calls).toBe(1);
  });
});

describe("커밋 상세 모으기", () => {
  function detail(sha: string): CommitDetail {
    return {
      sha,
      message: `커밋 ${sha}`,
      authoredAt: "2026-09-09T00:00:00Z",
      authorLogin: "hm1n",
      files: [],
    } as unknown as CommitDetail;
  }

  it("모든 SHA의 상세를 순서대로 모은다", async () => {
    const details = await collectCommitDetails(["a", "b"], async (sha) => detail(sha));

    expect(details.map(({ sha }) => sha)).toEqual(["a", "b"]);
  });

  it("뒤 커밋이 깨져도 앞에서 받은 상세를 오류에 남긴다", async () => {
    // 상세 조회는 커밋마다 한 번씩 나갑니다. 앞에서 받은 것을 버리면 그만큼의 요청을 다시 씁니다.
    const fetchDetail = async (sha: string): Promise<CommitDetail> => {
      if (sha === "a") return detail("a");
      throw new Error("커밋 상세 응답을 읽지 못했습니다.");
    };

    await expect(collectCommitDetails(["a", "b"], fetchDetail)).rejects.toThrow(
      CommitDetailCollectError
    );
    try {
      await collectCommitDetails(["a", "b"], fetchDetail);
    } catch (error) {
      expect((error as CommitDetailCollectError).collectedDetails.map(({ sha }) => sha)).toEqual([
        "a",
      ]);
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });
});

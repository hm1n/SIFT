import type { NextRequest } from "next/server";
import { getGitHubTokenFromRequest } from "./auth-session";
import { GitHubRouteRequestError } from "./api-contract";
import type { GitHubAuth } from "./types";

export async function readGitHubRouteRequest(request: NextRequest): Promise<{ body: Record<string, unknown>; auth: GitHubAuth }> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new GitHubRouteRequestError("invalid_json", "The request body must be JSON.", 400);
  }
  if (typeof body !== "object" || body === null) {
    throw new GitHubRouteRequestError("invalid_request", "The request body format is not valid.", 422);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.owner !== "string" || record.owner.trim() === "" || typeof record.repo !== "string" || record.repo.trim() === "") {
    throw new GitHubRouteRequestError("invalid_request", "owner and repo are required.", 422);
  }
  return {
    body: record,
    auth: { owner: record.owner, repo: record.repo, token: getGitHubTokenFromRequest(request) },
  };
}

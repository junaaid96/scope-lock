import { createHmac, timingSafeEqual } from "node:crypto";
import { GitHubPullRequestEventSchema, GitHubPushEventSchema } from "@scopelock/contracts";
import { DomainError, parseExternalRefs } from "@scopelock/domain";
import type { ExternalProvider, ObservedWork, ProviderHeaders } from "./types.js";

/** Max commits processed per push delivery (bounded work per webhook). */
export const GITHUB_PUSH_COMMIT_CAP = 100;

/**
 * GitHub provider: `X-Hub-Signature-256` verification plus normalization of
 * `pull_request` and `push` events. Refs are parsed from PR titles, bodies,
 * and head branches, and from pushed commit messages.
 */
export const GitHubProvider: ExternalProvider = {
  name: "GITHUB",

  verifySignature(secret: string, rawBody: string, headers: ProviderHeaders): void {
    const header = headers.signature256;
    if (!header || !header.startsWith("sha256=")) throw DomainError.unauthorized("Invalid webhook signature");
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const actual = Buffer.from(header.slice("sha256=".length), "hex");
    if (expected.length !== actual.length || expected.length === 0 || !timingSafeEqual(expected, actual)) {
      throw DomainError.unauthorized("Invalid webhook signature");
    }
  },

  parseEvent(event: string, payload: unknown): ObservedWork[] {
    if (event === "pull_request") return [parsePullRequest(payload)];
    if (event === "push") return parsePush(payload);
    return [];
  },
};

function parsePullRequest(payload: unknown): ObservedWork {
  const parsed = GitHubPullRequestEventSchema.safeParse(payload);
  if (!parsed.success) throw DomainError.unprocessable("Malformed pull_request payload");
  const { repository, pull_request: pr } = parsed.data;
  const refs = parseExternalRefs([pr.title, pr.body ?? "", pr.head?.ref ?? ""].join("\n"));
  const merged = pr.merged === true;
  return {
    provider: "GITHUB",
    externalId: `${repository.full_name}#${pr.number}`,
    kind: "PULL_REQUEST",
    url: pr.html_url,
    title: pr.title.slice(0, 200),
    refs,
    merged,
    mergedAt: merged ? (pr.merged_at ?? null) : null,
  };
}

function parsePush(payload: unknown): ObservedWork[] {
  const parsed = GitHubPushEventSchema.safeParse(payload);
  if (!parsed.success) throw DomainError.unprocessable("Malformed push payload");
  const { ref, repository, commits } = parsed.data;
  const landed = repository.default_branch !== undefined && ref === `refs/heads/${repository.default_branch}`;
  return commits.slice(0, GITHUB_PUSH_COMMIT_CAP).map((commit) => {
    const message = commit.message ?? "";
    return {
      provider: "GITHUB",
      externalId: commit.id,
      kind: "PUSH",
      url: commit.url ?? null,
      title: message.split("\n")[0]?.slice(0, 200) ?? null,
      refs: parseExternalRefs(message),
      merged: landed,
      mergedAt: landed ? (commit.timestamp ?? null) : null,
    };
  });
}

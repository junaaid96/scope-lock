import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GITHUB_PUSH_COMMIT_CAP, GitHubProvider } from "../src/lib/providers/github.js";

const SECRET = "whsec_test";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
}

describe("GitHubProvider.verifySignature", () => {
  it("accepts a valid signature", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(() => GitHubProvider.verifySignature(SECRET, body, { signature256: sign(body) })).not.toThrow();
  });

  it("rejects missing, malformed, and wrong signatures", () => {
    const body = JSON.stringify({ action: "opened" });
    expect(() => GitHubProvider.verifySignature(SECRET, body, {})).toThrowError(/signature/i);
    expect(() => GitHubProvider.verifySignature(SECRET, body, { signature256: "sha1=deadbeef" })).toThrowError(/signature/i);
    expect(() => GitHubProvider.verifySignature(SECRET, body, { signature256: sign(body).replace(/.$/, "0") })).toThrowError(/signature/i);
    expect(() => GitHubProvider.verifySignature(SECRET, `${body} `, { signature256: sign(body) })).toThrowError(/signature/i);
  });
});

describe("GitHubProvider.parseEvent", () => {
  const repo = { full_name: "octo/repo", default_branch: "main" };

  it("parses pull_request refs from title, body, and branch", () => {
    const [item] = GitHubProvider.parseEvent("pull_request", {
      action: "opened",
      repository: repo,
      pull_request: {
        number: 12,
        title: "Add export for CHG-003",
        body: "Also touches REQ-004.\n\nCHG-003 again.",
        html_url: "https://github.com/octo/repo/pull/12",
        merged: false,
        merged_at: null,
        head: { ref: "feature/CHG-003-export" },
      },
    });
    expect(item?.externalId).toBe("octo/repo#12");
    expect(item?.kind).toBe("PULL_REQUEST");
    expect(item?.refs).toEqual(["CHG-003", "REQ-004"]);
    expect(item?.merged).toBe(false);
    expect(item?.mergedAt).toBeNull();
  });

  it("marks closed+merged PRs as merged with merged_at", () => {
    const [item] = GitHubProvider.parseEvent("pull_request", {
      action: "closed",
      repository: repo,
      pull_request: {
        number: 13,
        title: "No refs here",
        body: null,
        html_url: "https://github.com/octo/repo/pull/13",
        merged: true,
        merged_at: "2026-02-01T10:00:00Z",
        head: { ref: "main" },
      },
    });
    expect(item?.refs).toEqual([]);
    expect(item?.merged).toBe(true);
    expect(item?.mergedAt).toBe("2026-02-01T10:00:00Z");
  });

  it("treats closed-but-unmerged PRs as not merged", () => {
    const [item] = GitHubProvider.parseEvent("pull_request", {
      action: "closed",
      repository: repo,
      pull_request: {
        number: 14,
        title: "Dropped",
        html_url: "https://github.com/octo/repo/pull/14",
        merged: false,
        merged_at: null,
      },
    });
    expect(item?.merged).toBe(false);
  });

  it("expands pushes per commit, merged only on the default branch", () => {
    const payload = {
      ref: "refs/heads/main",
      repository: repo,
      commits: [
        { id: "aaa", message: "Ship CHG-005\n\nDetails", url: "https://github.com/octo/repo/commit/aaa", timestamp: "2026-02-02T00:00:00Z" },
        { id: "bbb", message: "Unrelated cleanup", url: "https://github.com/octo/repo/commit/bbb" },
      ],
    };
    const items = GitHubProvider.parseEvent("push", payload);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ externalId: "aaa", kind: "PUSH", refs: ["CHG-005"], merged: true, mergedAt: "2026-02-02T00:00:00Z" });
    expect(items[0]?.title).toBe("Ship CHG-005");
    expect(items[1]).toMatchObject({ externalId: "bbb", refs: [], merged: true, mergedAt: null });

    const branch = GitHubProvider.parseEvent("push", { ...payload, ref: "refs/heads/feature" });
    expect(branch.every((i) => !i.merged)).toBe(true);
  });

  it("caps commits per push", () => {
    const commits = Array.from({ length: GITHUB_PUSH_COMMIT_CAP + 5 }, (_, i) => ({ id: `c${i}`, message: `commit ${i}` }));
    const items = GitHubProvider.parseEvent("push", { ref: "refs/heads/main", repository: repo, commits });
    expect(items).toHaveLength(GITHUB_PUSH_COMMIT_CAP);
  });

  it("ignores unknown events and rejects malformed known ones", () => {
    expect(GitHubProvider.parseEvent("issues", { action: "opened" })).toEqual([]);
    expect(GitHubProvider.parseEvent("ping", {})).toEqual([]);
    expect(() => GitHubProvider.parseEvent("pull_request", { action: "opened" })).toThrowError(/pull_request/);
    expect(() => GitHubProvider.parseEvent("push", { ref: "refs/heads/main" })).toThrowError(/push/);
  });
});

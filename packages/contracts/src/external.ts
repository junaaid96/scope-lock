import { z } from "zod";
import { IdSchema } from "./common.js";

// ---------- External provider connections ----------
// Linear/Jira plug in behind the same connection + work-item shape later;
// only GITHUB is accepted today.

export const ExternalProviderSchema = z.enum(["GITHUB"]);

export const CreateExternalConnectionSchema = z.object({
  provider: ExternalProviderSchema,
  /** Omit to create an enabled connection. */
  enabled: z.boolean().default(true),
});

export const UpdateExternalConnectionSchema = z.object({
  enabled: z.boolean(),
});

export const ExternalConnectionViewSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  provider: z.string(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// ---------- Observed external work ----------

export const ExternalWorkKindSchema = z.enum(["PULL_REQUEST", "PUSH"]);

export const ExternalWorkItemViewSchema = z.object({
  id: IdSchema,
  projectId: IdSchema,
  provider: z.string(),
  externalId: z.string(),
  kind: ExternalWorkKindSchema,
  url: z.string().nullable(),
  title: z.string().nullable(),
  refs: z.array(z.string()),
  merged: z.boolean(),
  mergedAt: z.string().nullable(),
  observedAt: z.string(),
  updatedAt: z.string(),
});

// ---------- GitHub webhook payloads (loose: only consumed fields) ----------
// Unknown fields pass through so new GitHub payload shapes never break intake.

const GitHubRepoSchema = z.object({ full_name: z.string(), default_branch: z.string().optional() }).passthrough();

const GitHubPullRequestSchema = z
  .object({
    number: z.number().int(),
    title: z.string(),
    body: z.string().nullable().optional(),
    html_url: z.string().url(),
    merged: z.boolean().optional(),
    merged_at: z.string().nullable().optional(),
    head: z.object({ ref: z.string() }).passthrough().optional(),
  })
  .passthrough();

export const GitHubPullRequestEventSchema = z
  .object({
    action: z.string(),
    number: z.number().int().optional(),
    repository: GitHubRepoSchema,
    pull_request: GitHubPullRequestSchema,
  })
  .passthrough();

const GitHubCommitSchema = z
  .object({
    id: z.string(),
    message: z.string(),
    url: z.string().url().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

export const GitHubPushEventSchema = z
  .object({
    ref: z.string(),
    repository: GitHubRepoSchema,
    commits: z.array(GitHubCommitSchema).max(500),
  })
  .passthrough();

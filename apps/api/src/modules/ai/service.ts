import { DomainError, detectDrift } from "@scopelock/domain";
import type { AIKind } from "@scopelock/domain";
import type { Env } from "../../env.js";
import { currentPeriod, type AIAnalysis, type Project, type Store, type User } from "../../store/index.js";
import { assertAiQuota } from "../../lib/limits.js";
import { completeWithFailover, resolveProviders, type AiProvider } from "./providers.js";
import { PROMPT_VERSION, SYSTEM_BASE, clarifyPrompt, comparePrompt, driftPrompt, extractPrompt, importChangesPrompt, memoryPrompt, proposalPrompt } from "./prompts.js";
import {
  ClarificationsResponseSchema,
  CompareResponseSchema,
  DriftAnalysisResponseSchema,
  ExtractRequirementsResponseSchema,
  ImportChangesResponseSchema,
  MemoryResponseSchema,
  ProposalDraftResponseSchema,
} from "./schemas.js";

export interface AiContext {
  store: Store;
  env: Env;
  user: User;
  project: Project;
  organizationId: string;
  plan: "FREE" | "PRO" | "SCALE";
  orgAiEnabled: boolean;
}

async function gate(ctx: AiContext): Promise<{ providers: AiProvider[] }> {
  if (!ctx.env.AI_ENABLED || !ctx.orgAiEnabled || !ctx.project.settings.aiEnabled) {
    throw DomainError.unprocessable("AI assistance is disabled for this project. Use the manual workflow.", {
      code: "AI_DISABLED",
    });
  }
  await assertAiQuota(ctx.store, ctx.organizationId, ctx.plan);
  return { providers: resolveProviders(ctx.env) };
}

async function record(
  ctx: AiContext,
  kind: AIKind,
  inputRefs: Record<string, unknown>,
  output: unknown,
  status: AIAnalysis["status"],
  extra?: {
    latencyMs?: number | null;
    error?: string | null;
    changeRequestId?: string | null;
    usage?: AIAnalysis["usage"];
    provider?: string;
    model?: string;
  },
): Promise<AIAnalysis> {
  const analysis = await ctx.store.createAIAnalysis({
    projectId: ctx.project.id,
    changeRequestId: extra?.changeRequestId ?? null,
    kind,
    inputRefs,
    provider: extra?.provider ?? "none",
    model: extra?.model ?? ctx.env.GROQ_MODEL,
    promptVersion: PROMPT_VERSION,
    output: output ?? {},
    status,
    usage: extra?.usage ?? null,
    latencyMs: extra?.latencyMs ?? null,
    error: extra?.error ?? null,
    reviewerDisposition: null,
    reviewedBy: null,
    createdBy: ctx.user.id,
  });
  if (status !== "FAILED") {
    await ctx.store.bumpUsage(ctx.organizationId, currentPeriod(), { aiCalls: 1 });
  }
  return analysis;
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

/** Requirement extraction. No deterministic fallback — manual entry is the fallback. */
export async function extractRequirements(ctx: AiContext, sourceText: string, sourceLabel: string): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    return record(ctx, "EXTRACT", { sourceLabel, chars: sourceText.length }, { requirements: [], assumptions: [], exclusions: [] }, "FALLBACK", {
      error: "AI provider is not configured; enter requirements manually.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: extractPrompt(sourceLabel, sourceText), maxTokens: 4000 });
    const output = ExtractRequirementsResponseSchema.parse(parseJson(result.text));
    return record(ctx, "EXTRACT", { sourceLabel, chars: sourceText.length }, output, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model });
  } catch (err) {
    return record(ctx, "EXTRACT", { sourceLabel }, {}, "FAILED", { error: String(err).slice(0, 500) });
  }
}

/** Transcript/thread import: one draft change request per implicit ask, each with a source excerpt. A human accepts or edits each draft — nothing is created here. No deterministic fallback: manual entry is the fallback. */
export async function importChangeDrafts(ctx: AiContext, sourceText: string, sourceLabel: string): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    return record(ctx, "IMPORT", { sourceLabel, chars: sourceText.length }, { drafts: [] }, "FALLBACK", {
      error: "AI provider is not configured; enter change requests manually.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: importChangesPrompt(sourceLabel, sourceText), maxTokens: 4000 });
    const output = ImportChangesResponseSchema.parse(parseJson(result.text));
    return record(ctx, "IMPORT", { sourceLabel, chars: sourceText.length }, output, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model });
  } catch (err) {
    return record(ctx, "IMPORT", { sourceLabel }, {}, "FAILED", { error: String(err).slice(0, 500) });
  }
}

export interface DriftResult {
  analysis: AIAnalysis;
  deterministic: ReturnType<typeof detectDrift>;
}

/** Scope-drift analysis: deterministic links always; AI refines when available. Null changeId = pre-submission check. */
export async function analyzeScopeDrift(
  ctx: AiContext,
  changeId: string | null,
  requestText: string,
  candidates: Array<{ requirementId: string; stableKey: string; title: string; description: string; acceptanceCriteria: string[] }>,
): Promise<DriftResult> {
  const { providers } = await gate(ctx);
  const deterministic = detectDrift(requestText, candidates);
  const validIds = new Set(candidates.map((c) => c.requirementId));

  if (providers.length === 0) {
    const analysis = await record(
      ctx,
      "DRIFT",
      { changeRequestId: changeId, candidateIds: candidates.map((c) => c.requirementId) },
      { links: [], missingContext: [], note: "AI provider not configured; deterministic matches only." },
      "FALLBACK",
      { changeRequestId: changeId },
    );
    return { analysis, deterministic };
  }

  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, {
      system: SYSTEM_BASE,
      user: driftPrompt(requestText, JSON.stringify(candidates.map((c) => ({ requirementId: c.requirementId, stableKey: c.stableKey, title: c.title, description: c.description.slice(0, 800) })))),
      maxTokens: 2500,
    });
    const parsed = DriftAnalysisResponseSchema.parse(parseJson(result.text));
    // Reject invented IDs: only links citing real project requirements survive.
    const links = parsed.links.filter((l) => validIds.has(l.requirementId));
    const dropped = parsed.links.length - links.length;
    const analysis = await record(
      ctx,
      "DRIFT",
      { changeRequestId: changeId, candidateIds: [...validIds] },
      { ...parsed, links, droppedInventedIds: dropped },
      "SUCCEEDED",
      { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model, changeRequestId: changeId },
    );
    return { analysis, deterministic };
  } catch (err) {
    const analysis = await record(ctx, "DRIFT", { changeRequestId: changeId }, {}, "FAILED", {
      error: String(err).slice(0, 500),
      changeRequestId: changeId,
    });
    return { analysis, deterministic };
  }
}

/** Clarification questions with a template fallback when the provider is down. */
export async function generateClarifications(ctx: AiContext, changeId: string, requestText: string, maxQuestions: number): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    const templates = [
      "What should happen when the user encounters an error in this flow?",
      "Who is allowed to use this, and are there roles or permissions involved?",
      "What does 'done' look like — how will you verify the result?",
      "Are there deadlines, milestones, or budget constraints for this request?",
      "Should this replace existing behavior or add alongside it?",
    ];
    return record(ctx, "CLARIFY", { changeRequestId: changeId }, { questions: templates.slice(0, maxQuestions) }, "FALLBACK", {
      changeRequestId: changeId,
      error: "AI provider not configured; template questions returned.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: clarifyPrompt(requestText, maxQuestions), maxTokens: 1200 });
    const output = ClarificationsResponseSchema.parse(parseJson(result.text));
    return record(ctx, "CLARIFY", { changeRequestId: changeId }, output, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model, changeRequestId: changeId });
  } catch (err) {
    return record(ctx, "CLARIFY", { changeRequestId: changeId }, {}, "FAILED", { error: String(err).slice(0, 500), changeRequestId: changeId });
  }
}

/** Client-facing proposal draft from approved impact inputs. Never sends automatically. */
export async function draftProposal(
  ctx: AiContext,
  changeId: string,
  requestText: string,
  impact: Record<string, unknown>,
  tone: string,
): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    return record(ctx, "PROPOSAL", { changeRequestId: changeId }, { subject: "", summary: "", bullets: [] }, "FALLBACK", {
      changeRequestId: changeId,
      error: "AI provider not configured; draft the proposal manually from the impact record.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: proposalPrompt(JSON.stringify(impact), requestText, tone), maxTokens: 2000 });
    const output = ProposalDraftResponseSchema.parse(parseJson(result.text));
    return record(ctx, "PROPOSAL", { changeRequestId: changeId }, output, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model, changeRequestId: changeId });
  } catch (err) {
    return record(ctx, "PROPOSAL", { changeRequestId: changeId }, {}, "FAILED", { error: String(err).slice(0, 500), changeRequestId: changeId });
  }
}

/** Decision-memory summary over authorized project history. */
export async function summarizeMemory(ctx: AiContext, question: string, history: unknown[]): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    return record(ctx, "MEMORY", { question }, { relevantDecisions: [] }, "FALLBACK", {
      error: "AI provider not configured; browse the decision list manually.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: memoryPrompt(JSON.stringify(history).slice(0, 12000), question), maxTokens: 2000 });
    const parsed = MemoryResponseSchema.parse(parseJson(result.text));
    const validIds = new Set((history as Array<{ approvalId: string }>).map((h) => h.approvalId));
    const relevantDecisions = parsed.relevantDecisions.filter((d) => validIds.has(d.approvalId));
    return record(ctx, "MEMORY", { question }, { ...parsed, relevantDecisions }, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model });
  } catch (err) {
    return record(ctx, "MEMORY", { question }, {}, "FAILED", { error: String(err).slice(0, 500) });
  }
}

/** Plain-language agreement comparison. The structural diff remains canonical. */
export async function compareVersions(ctx: AiContext, diff: unknown): Promise<AIAnalysis> {
  const { providers } = await gate(ctx);
  if (providers.length === 0) {
    return record(ctx, "COMPARE", {}, { summary: "", highlights: [] }, "FALLBACK", {
      error: "AI provider not configured; the structural diff below is the complete record.",
    });
  }
  const started = Date.now();
  try {
    const result = await completeWithFailover(providers, ctx.env, { system: SYSTEM_BASE, user: comparePrompt(JSON.stringify(diff).slice(0, 12000)), maxTokens: 2000 });
    const output = CompareResponseSchema.parse(parseJson(result.text));
    return record(ctx, "COMPARE", {}, output, "SUCCEEDED", { latencyMs: Date.now() - started, usage: result.usage, provider: result.provider, model: result.model });
  } catch (err) {
    return record(ctx, "COMPARE", {}, {}, "FAILED", { error: String(err).slice(0, 500) });
  }
}

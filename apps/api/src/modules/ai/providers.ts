import type { Env } from "../../env.js";
import { groqConnection, openAiChatJson, openAiConnection, type ChatJsonOptions, type ChatJsonResult } from "./groq.js";

/**
 * AI provider seam: every capability calls through this interface so models
 * are swappable without touching call sites. Providers are tried in
 * resolution order; when the primary fails, the next configured provider
 * serves the request (its name is recorded in the usage log).
 */

export type AiProviderName = "groq" | "openai";

export interface AiProvider {
  readonly name: AiProviderName;
  isConfigured(env: Env): boolean;
  model(env: Env): string;
  complete(env: Env, opts: ChatJsonOptions): Promise<ChatJsonResult>;
}

class GroqProvider implements AiProvider {
  readonly name = "groq" as const;
  isConfigured(env: Env): boolean {
    return env.GROQ_API_KEY.length > 0;
  }
  model(env: Env): string {
    return env.GROQ_MODEL;
  }
  complete(env: Env, opts: ChatJsonOptions): Promise<ChatJsonResult> {
    return openAiChatJson(groqConnection(env), opts);
  }
}

class OpenAiProvider implements AiProvider {
  readonly name = "openai" as const;
  isConfigured(env: Env): boolean {
    return env.OPENAI_API_KEY.length > 0;
  }
  model(env: Env): string {
    return env.OPENAI_MODEL;
  }
  complete(env: Env, opts: ChatJsonOptions): Promise<ChatJsonResult> {
    return openAiChatJson(openAiConnection(env), opts);
  }
}

const ALL: AiProvider[] = [new GroqProvider(), new OpenAiProvider()];

/** Configured providers, primary (`AI_PROVIDER`) first. Empty means fall back. */
export function resolveProviders(env: Env): AiProvider[] {
  const ordered = [...ALL].sort((a, b) => (a.name === env.AI_PROVIDER ? -1 : b.name === env.AI_PROVIDER ? 1 : 0));
  return ordered.filter((p) => p.isConfigured(env));
}

export interface FailoverResult extends ChatJsonResult {
  provider: AiProviderName;
}

/**
 * Try each provider in order; the first success wins. Throws the last
 * provider's error when all fail. Callers record `provider` in the usage log
 * so failover is visible, never silent.
 */
export async function completeWithFailover(
  providers: AiProvider[],
  env: Env,
  opts: ChatJsonOptions,
): Promise<FailoverResult> {
  let lastError: unknown = new Error("No AI provider is configured");
  for (const provider of providers) {
    try {
      const result = await provider.complete(env, opts);
      return { ...result, provider: provider.name };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

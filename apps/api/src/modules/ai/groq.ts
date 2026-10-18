import type { Env } from "../../env.js";

export interface ChatJsonOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface ChatJsonResult {
  text: string;
  latencyMs: number;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

/** @deprecated Use AiProvider via ./providers.js. Kept for the transport below. */
export type GroqOptions = ChatJsonOptions;
/** @deprecated Use AiProvider via ./providers.js. Kept for the transport below. */
export type GroqResult = ChatJsonResult;

const GROQ_DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal OpenAI-compatible chat client (`POST {baseUrl}/chat/completions`
 * with `response_format: json_object`). Retries only safe transient failures
 * (429/5xx, network errors), with timeout + backoff. Both AI providers share
 * this transport; only credentials, model, and base URL differ.
 */
export async function openAiChatJson(
  connection: { baseUrl: string; apiKey: string; model: string; label: string },
  opts: ChatJsonOptions,
): Promise<ChatJsonResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${connection.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${connection.apiKey}` },
        body: JSON.stringify({
          model: connection.model,
          messages: [
            { role: "system", content: opts.system },
            { role: "user", content: opts.user },
          ],
          response_format: { type: "json_object" },
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 2000,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status >= 500) {
        lastError = `${connection.label} responded ${res.status}`;
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
        continue;
      }
      if (!res.ok) throw new Error(`${connection.label} request failed with status ${res.status}`);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error(`${connection.label} returned an empty completion`);
      const u = body.usage;
      const usage =
        u && typeof u.total_tokens === "number"
          ? {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens,
            }
          : null;
      return { text, latencyMs: Date.now() - started, model: connection.model, usage };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = `${connection.label} request timed out`;
        break;
      }
      if (err instanceof Error && /status \d/.test(err.message)) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
  throw new Error(lastError || `${connection.label} request failed`);
}

export function groqConnection(env: Env): { baseUrl: string; apiKey: string; model: string; label: string } {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");
  return {
    baseUrl: process.env.GROQ_BASE_URL ?? GROQ_DEFAULT_BASE_URL,
    apiKey: env.GROQ_API_KEY,
    model: env.GROQ_MODEL,
    label: "Groq",
  };
}

export function openAiConnection(env: Env): { baseUrl: string; apiKey: string; model: string; label: string } {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return {
    baseUrl: process.env.OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL,
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    label: "OpenAI",
  };
}

/**
 * Minimal Groq client over the OpenAI-compatible chat API.
 * Retries only safe transient failures (429/5xx), with timeout + backoff.
 */
export async function groqJson(env: Env, opts: GroqOptions): Promise<GroqResult> {
  return openAiChatJson(groqConnection(env), opts);
}

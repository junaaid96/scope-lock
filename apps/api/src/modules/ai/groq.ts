import type { Env } from "../../env.js";

export interface GroqOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GroqResult {
  text: string;
  latencyMs: number;
  model: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number } | null;
}

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";

function baseUrl(): string {
  return process.env.GROQ_BASE_URL ?? DEFAULT_BASE_URL;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal Groq client over the OpenAI-compatible chat API.
 * Retries only safe transient failures (429/5xx), with timeout + backoff.
 */
export async function groqJson(env: Env, opts: GroqOptions): Promise<GroqResult> {
  if (!env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");
  const model = env.GROQ_MODEL;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model,
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
        lastError = `Groq responded ${res.status}`;
        await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
        continue;
      }
      if (!res.ok) throw new Error(`Groq request failed with status ${res.status}`);
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };
      const text = body.choices?.[0]?.message?.content ?? "";
      if (!text) throw new Error("Groq returned an empty completion");
      const u = body.usage;
      const usage =
        u && typeof u.total_tokens === "number"
          ? {
              promptTokens: u.prompt_tokens ?? 0,
              completionTokens: u.completion_tokens ?? 0,
              totalTokens: u.total_tokens,
            }
          : null;
      return { text, latencyMs: Date.now() - started, model, usage };
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof Error && err.name === "AbortError") {
        lastError = "Groq request timed out";
        break;
      }
      if (err instanceof Error && /status \d/.test(err.message)) throw err;
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
  throw new Error(lastError || "Groq request failed");
}

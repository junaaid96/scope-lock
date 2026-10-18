import type { Env } from "../env.js";
import { OPENAI_DEFAULT_BASE_URL } from "../modules/ai/groq.js";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMS = 1536;

export interface EmbeddingsDriver {
  readonly name: string;
  isConfigured(env: Env): boolean;
  /** Embed up to a provider batch in one call; order matches inputs. */
  embed(env: Env, inputs: string[]): Promise<number[][]>;
}

function baseUrl(): string {
  return process.env.OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL;
}

/** OpenAI embeddings transport (also serves OpenAI-compatible endpoints). */
export const OpenAiEmbeddings: EmbeddingsDriver = {
  name: "openai",

  isConfigured(env: Env): boolean {
    return env.OPENAI_API_KEY.length > 0;
  },

  async embed(env: Env, inputs: string[]): Promise<number[][]> {
    if (!this.isConfigured(env)) throw new Error("Embeddings provider is not configured");
    if (inputs.length === 0) return [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${baseUrl()}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Embeddings provider responded ${res.status}`);
      const json = (await res.json()) as { data?: Array<{ embedding?: unknown; index?: number }> };
      const rows = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== inputs.length) throw new Error("Embeddings provider returned the wrong row count");
      return rows.map((row, i) => {
        if (!Array.isArray(row.embedding) || row.embedding.length !== EMBEDDING_DIMS) {
          throw new Error(`Embedding row ${i} has the wrong dimensions`);
        }
        return (row.embedding as unknown[]).map((v) => Number(v));
      });
    } finally {
      clearTimeout(timer);
    }
  },
};

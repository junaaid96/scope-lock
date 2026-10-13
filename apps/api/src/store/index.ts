import type { Env } from "../env.js";
import { usesPrisma } from "../env.js";
import { FileStore } from "./file-store.js";
import { MemoryStore } from "./memory.js";
import type { Store } from "./store.js";

export type { Store } from "./store.js";
export * from "./types.js";

/**
 * Backend selection:
 * - `DATABASE_URL=postgres://…` → PrismaStore (staging/production).
 * - otherwise → FileStore at DATA_FILE (local dev), pure memory when DATA_FILE is ":memory:".
 */
export async function createStore(env: Env): Promise<Store> {
  if (usesPrisma(env)) {
    const { PrismaStore } = await import("./prisma-store.js");
    return PrismaStore.connect(env.DATABASE_URL);
  }
  if (env.DATA_FILE === ":memory:") return new MemoryStore();
  return new FileStore(env.DATA_FILE);
}

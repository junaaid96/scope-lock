import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  correlationId: string;
  userId?: string;
  ip?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getCorrelationId(): string {
  return storage.getStore()?.correlationId ?? "no-correlation";
}

import { afterCursor, paginate, DomainError } from "@scopelock/domain";

export interface ListQueryInput {
  cursor?: string;
  limit?: number;
}

/** Uniform newest-first cursor pagination for list endpoints. */
export function paginateList<T extends { id: string; createdAt: string }>(
  items: T[],
  query: ListQueryInput,
): { data: T[]; pagination: { nextCursor: string | null } } {
  const sorted = [...items].sort((a, b) =>
    a.createdAt === b.createdAt ? (a.id < b.id ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1,
  );
  try {
    const page = paginate(afterCursor(sorted, query.cursor), query.limit ?? 25);
    return { data: page.items, pagination: { nextCursor: page.nextCursor } };
  } catch {
    throw DomainError.badRequest("Invalid pagination cursor");
  }
}

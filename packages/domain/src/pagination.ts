// Opaque cursor pagination helpers used by list/activity/notification endpoints.

export interface CursorPayload {
  /** ISO timestamp of the last item on the page (keyset anchor). */
  t: string;
  /** Id of the last item on the page (tie-breaker). */
  i: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as Partial<CursorPayload>;
    if (typeof parsed.t !== "string" || typeof parsed.i !== "string") throw new Error("bad cursor");
    return { t: parsed.t, i: parsed.i };
  } catch {
    throw new Error("Invalid pagination cursor");
  }
}

export interface PageInput {
  cursor?: string;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Keyset pagination over items pre-sorted by (createdAt desc, id desc).
 * `take` should be limit+1 style; this helper slices and computes the next cursor.
 */
export function paginate<T extends { id: string; createdAt: string }>(
  sortedDesc: T[],
  limit: number,
): Page<T> {
  const safeLimit = Math.min(Math.max(limit, 1), 100);
  const items = sortedDesc.slice(0, safeLimit);
  const hasMore = sortedDesc.length > safeLimit;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ t: last.createdAt, i: last.id }) : null,
  };
}

/** Filters a desc-sorted list to items strictly after the cursor. */
export function afterCursor<T extends { id: string; createdAt: string }>(sortedDesc: T[], cursor?: string): T[] {
  if (!cursor) return sortedDesc;
  const { t, i } = decodeCursor(cursor);
  return sortedDesc.filter((row) => row.createdAt < t || (row.createdAt === t && row.id < i));
}

// Structural (deterministic) scope-version diff. This output is canonical;
// any AI summary is advisory only and must cite these entries.

export interface RevisionLike {
  requirementId: string;
  stableKey: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category?: string | null;
  priority?: string | null;
  order: number;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ModifiedRequirement {
  requirementId: string;
  stableKey: string;
  changes: FieldChange[];
}

export interface ScopeDiff {
  fromVersionId: string;
  toVersionId: string;
  added: RevisionLike[];
  removed: RevisionLike[];
  modified: ModifiedRequirement[];
  assumptionsChanged: boolean;
  exclusionsChanged: boolean;
  beforeAssumptions: string[];
  afterAssumptions: string[];
  beforeExclusions: string[];
  afterExclusions: string[];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

const COMPARED_FIELDS = [
  "title",
  "description",
  "acceptanceCriteria",
  "category",
  "priority",
  "order",
] as const;

export function diffRevisions(
  fromVersionId: string,
  toVersionId: string,
  from: RevisionLike[],
  to: RevisionLike[],
  meta?: {
    fromAssumptions?: string[];
    toAssumptions?: string[];
    fromExclusions?: string[];
    toExclusions?: string[];
  },
): ScopeDiff {
  const fromById = new Map(from.map((r) => [r.requirementId, r]));
  const toById = new Map(to.map((r) => [r.requirementId, r]));
  const added: RevisionLike[] = [];
  const removed: RevisionLike[] = [];
  const modified: ModifiedRequirement[] = [];

  for (const rev of to) {
    const prev = fromById.get(rev.requirementId);
    if (!prev) {
      added.push(rev);
      continue;
    }
    const changes: FieldChange[] = [];
    for (const field of COMPARED_FIELDS) {
      const before = prev[field];
      const after = rev[field];
      if (!valuesEqual(before, after)) changes.push({ field, before, after });
    }
    if (changes.length > 0) {
      modified.push({ requirementId: rev.requirementId, stableKey: rev.stableKey, changes });
    }
  }
  for (const rev of from) {
    if (!toById.has(rev.requirementId)) removed.push(rev);
  }

  const beforeAssumptions = meta?.fromAssumptions ?? [];
  const afterAssumptions = meta?.toAssumptions ?? [];
  const beforeExclusions = meta?.fromExclusions ?? [];
  const afterExclusions = meta?.toExclusions ?? [];
  return {
    fromVersionId,
    toVersionId,
    added,
    removed,
    modified,
    assumptionsChanged: !valuesEqual(beforeAssumptions, afterAssumptions),
    exclusionsChanged: !valuesEqual(beforeExclusions, afterExclusions),
    beforeAssumptions,
    afterAssumptions,
    beforeExclusions,
    afterExclusions,
  };
}

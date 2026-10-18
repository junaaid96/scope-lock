// Scope templates: pure application of a template's standard content into a
// draft scope payload. Storage, key allocation, and permissions live in the
// API layer; this module only normalizes and caps what a template carries.

export interface TemplateItemInput {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category?: string | null;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | null;
}

export interface TemplateInput {
  assumptions: string[];
  exclusions: string[];
  items: TemplateItemInput[];
}

export interface DraftPayload {
  assumptions: string[];
  exclusions: string[];
  items: TemplateItemInput[];
}

export const TEMPLATE_MAX_ITEMS = 100;
export const TEMPLATE_MAX_ASSUMPTIONS = 50;
export const TEMPLATE_MAX_EXCLUSIONS = 50;

function clean(lines: string[], max: number): string[] {
  return [...new Set(lines.map((l) => l.trim()).filter((l) => l.length > 0))].slice(0, max);
}

/**
 * Normalize a template into draft content: trim, drop blanks and dupes, cap
 * counts. Items with blank titles are dropped (a template must not mint
 * untitled requirements).
 */
export function applyTemplate(template: TemplateInput): DraftPayload {
  const items = template.items
    .filter((it) => it.title.trim().length > 0)
    .slice(0, TEMPLATE_MAX_ITEMS)
    .map((it) => ({
      title: it.title.trim(),
      description: it.description.trim(),
      acceptanceCriteria: clean(it.acceptanceCriteria, 50),
      category: it.category?.trim() ? it.category.trim() : null,
      priority: it.priority ?? null,
    }));
  return {
    assumptions: clean(template.assumptions, TEMPLATE_MAX_ASSUMPTIONS),
    exclusions: clean(template.exclusions, TEMPLATE_MAX_EXCLUSIONS),
    items,
  };
}

/** Split a CSV acceptance-criteria cell ("a | b") into trimmed criteria. */
export function splitCriteria(cell: string | undefined): string[] {
  if (!cell) return [];
  return [...new Set(cell.split("|").map((c) => c.trim()).filter((c) => c.length > 0))].slice(0, 50);
}

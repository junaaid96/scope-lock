import { DomainError } from "./errors.js";

/**
 * Invoice-ready export: approved changes as billing line items for a
 * project/period. Derived, never stored: each line carries the decided price
 * in minor units plus its currency, so downstream invoicing never inherits a
 * silent conversion. Totals are per currency.
 */

export interface InvoiceLineInput {
  number: string;
  title: string;
  status: string;
  decidedAt: string | null;
  priceMinor: number | null;
  currency: string | null;
  pricingMode: string | null;
  overrideReason: string | null;
  allowancePoolName: string | null;
  drawStatus: string | null;
}

export interface InvoiceLine {
  number: string;
  title: string;
  decidedAt: string;
  priceMinor: number;
  price: string;
  currency: string;
  pricingMode: string | null;
  overrideReason: string | null;
  allowancePoolName: string | null;
  drawStatus: string | null;
}

export interface InvoiceTotals {
  currency: string;
  totalMinor: number;
  total: string;
  lines: number;
}

const BILLABLE_STATUSES = new Set(["APPROVED", "IMPLEMENTED"]);

/** Approved (or since implemented) changes decided inside [from, to]. A
 * calendar-date `to` covers the whole day (through 23:59:59.999 UTC). */
export function buildInvoiceLines(
  changes: InvoiceLineInput[],
  period: { from: string; to: string },
): InvoiceLine[] {
  const fromMs = Date.parse(period.from);
  const toMs = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(period.to) ? `${period.to}T23:59:59.999Z` : period.to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw DomainError.unprocessable("Export period must be valid dates");
  if (fromMs > toMs) throw DomainError.unprocessable("Export period start must not be after its end");
  return changes
    .filter((c) => {
      if (!BILLABLE_STATUSES.has(c.status)) return false;
      if (!c.decidedAt) return false;
      const at = Date.parse(c.decidedAt);
      return !Number.isNaN(at) && at >= fromMs && at <= toMs;
    })
    .sort((a, b) => (a.decidedAt as string).localeCompare(b.decidedAt as string))
    .map((c) => {
      const priceMinor = c.priceMinor ?? 0;
      const currency = c.currency ?? "USD";
      return {
        number: c.number,
        title: c.title,
        decidedAt: c.decidedAt as string,
        priceMinor,
        price: (priceMinor / 100).toFixed(2),
        currency,
        pricingMode: c.pricingMode,
        overrideReason: c.overrideReason,
        allowancePoolName: c.allowancePoolName,
        drawStatus: c.drawStatus,
      };
    });
}

/** Per-currency totals. Currencies are never converted or merged. */
export function invoiceTotals(lines: InvoiceLine[]): InvoiceTotals[] {
  const byCurrency = new Map<string, { totalMinor: number; lines: number }>();
  for (const line of lines) {
    const entry = byCurrency.get(line.currency) ?? { totalMinor: 0, lines: 0 };
    entry.totalMinor += line.priceMinor;
    entry.lines += 1;
    byCurrency.set(line.currency, entry);
  }
  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => ({
      currency,
      totalMinor: entry.totalMinor,
      total: (entry.totalMinor / 100).toFixed(2),
      lines: entry.lines,
    }));
}

const CSV_COLUMNS = [
  "number",
  "title",
  "decided_at",
  "price_minor",
  "price",
  "currency",
  "pricing_mode",
  "override_reason",
  "allowance_pool",
  "draw_status",
] as const;

function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Deterministic CSV: fixed column order, RFC 4180 escaping, LF endings. */
export function invoiceLinesToCsv(lines: InvoiceLine[]): string {
  const rows = lines.map((l) =>
    [
      csvCell(l.number),
      csvCell(l.title),
      csvCell(l.decidedAt),
      csvCell(l.priceMinor),
      csvCell(l.price),
      csvCell(l.currency),
      csvCell(l.pricingMode),
      csvCell(l.overrideReason),
      csvCell(l.allowancePoolName),
      csvCell(l.drawStatus),
    ].join(","),
  );
  return [CSV_COLUMNS.join(","), ...rows].join("\n") + "\n";
}

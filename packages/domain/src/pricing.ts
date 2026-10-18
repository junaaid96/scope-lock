// Estimate pricing: effort x rate-card rates, with template contingency and an
// optional tax percentage. All money stays in integer minor units; the single
// currency is asserted, never converted. Tax here is a plain arithmetic
// estimate line, not tax advice or a tax calculation.

import { DomainError } from "./errors.js";
import { assertCurrency, assertMinorUnits } from "./money.js";

export interface PricingLineInput {
  label: string;
  role: string;
  hours: number;
}

export interface RateEntryInput {
  role: string;
  hourlyRateMinor: number;
}

export interface PricedLine {
  label: string;
  role: string;
  hours: number;
  hourlyRateMinor: number;
  lineMinor: number;
}

export interface PriceBreakdown {
  lines: PricedLine[];
  subtotalMinor: number;
  contingencyPct: number;
  contingencyMinor: number;
  /** Null when the template carries no tax line. */
  taxPct: number | null;
  taxMinor: number;
  totalMinor: number;
  currency: string;
}

export function assertHours(hours: number, field: string): void {
  if (!Number.isFinite(hours) || hours < 0 || hours > 1000000) {
    throw new Error(`${field} must be a finite number of hours between 0 and 1000000`);
  }
}

export function assertPct(pct: number, field: string): void {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    throw new Error(`${field} must be a percentage between 0 and 100`);
  }
}

/**
 * Price line items against a rate card. Tax applies to (subtotal +
 * contingency). Unknown roles fail loudly — a price must never silently drop
 * a line.
 */
export function computeImpactPrice(args: {
  lines: PricingLineInput[];
  rates: RateEntryInput[];
  currency: string;
  contingencyPct?: number;
  taxPct?: number | null;
}): PriceBreakdown {
  assertCurrency(args.currency);
  if (args.lines.length === 0) throw DomainError.unprocessable("At least one line item is required for computed pricing");
  const contingencyPct = args.contingencyPct ?? 0;
  assertPct(contingencyPct, "contingencyPct");
  if (args.taxPct !== undefined && args.taxPct !== null) assertPct(args.taxPct, "taxPct");
  const byRole = new Map(args.rates.map((r) => [r.role, r.hourlyRateMinor]));
  const lines: PricedLine[] = args.lines.map((line) => {
    assertHours(line.hours, `hours for ${line.role}`);
    const hourlyRateMinor = byRole.get(line.role);
    if (hourlyRateMinor === undefined) {
      throw DomainError.unprocessable(`Role "${line.role}" has no rate on this card`, { role: line.role });
    }
    assertMinorUnits(hourlyRateMinor, `rate for ${line.role}`);
    return { label: line.label, role: line.role, hours: line.hours, hourlyRateMinor, lineMinor: Math.round(line.hours * hourlyRateMinor) };
  });
  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineMinor, 0);
  const contingencyMinor = Math.round((subtotalMinor * contingencyPct) / 100);
  const taxableMinor = subtotalMinor + contingencyMinor;
  const taxMinor = args.taxPct === undefined || args.taxPct === null ? 0 : Math.round((taxableMinor * args.taxPct) / 100);
  return {
    lines,
    subtotalMinor,
    contingencyPct,
    contingencyMinor,
    taxPct: args.taxPct ?? null,
    taxMinor,
    totalMinor: taxableMinor + taxMinor,
    currency: args.currency,
  };
}

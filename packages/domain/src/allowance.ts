// Change allowance pool math. A pool is a pre-agreed budget of hours or money
// that approved changes draw down — but the pool itself is only ever granted
// by a recorded client approval decision (see the grant flow in the API).
// Remaining balances are always DERIVED (total minus active draw-downs),
// never stored, so released draw-downs credit back automatically.
//
// HOURS pools convert impact effort at 8 hours per effort-day.

import { DomainError } from "./errors.js";
import { assertMinorUnits } from "./money.js";

export const HOURS_PER_EFFORT_DAY = 8;

export type AllowanceKind = "HOURS" | "AMOUNT";
export type DrawDownStatus = "NOTIFIED" | "OBJECTED" | "FINAL" | "RELEASED";

export interface DrawDownInput {
  hours: number | null;
  amountMinor: number | null;
  status: DrawDownStatus;
}

export interface PoolBalance {
  kind: AllowanceKind;
  remainingHours: number | null;
  remainingMinor: number | null;
  exhausted: boolean;
}

/** RELEASED draw-downs credit back; every other status counts as drawn. */
export function poolBalance(args: {
  kind: AllowanceKind;
  totalHours: number | null;
  totalMinor: number | null;
  drawDowns: DrawDownInput[];
}): PoolBalance {
  const active = args.drawDowns.filter((d) => d.status !== "RELEASED");
  if (args.kind === "HOURS") {
    if (args.totalHours === null) throw new Error("HOURS pool needs totalHours");
    const drawn = active.reduce((sum, d) => sum + (d.hours ?? 0), 0);
    const remaining = Math.round((args.totalHours - drawn) * 100) / 100;
    return { kind: "HOURS", remainingHours: remaining, remainingMinor: null, exhausted: remaining <= 0 };
  }
  if (args.totalMinor === null) throw new Error("AMOUNT pool needs totalMinor");
  assertMinorUnits(args.totalMinor, "total");
  const drawn = active.reduce((sum, d) => sum + (d.amountMinor ?? 0), 0);
  const remaining = args.totalMinor - drawn;
  return { kind: "AMOUNT", remainingHours: null, remainingMinor: remaining, exhausted: remaining <= 0 };
}

export interface DrawAmount {
  hours: number | null;
  amountMinor: number | null;
}

/** Resolve what a change draws from a pool of the given kind. */
export function drawAmountFor(args: { kind: AllowanceKind; priceMinor: number | null; effortDays: number | null }): DrawAmount {
  if (args.kind === "AMOUNT") {
    if (args.priceMinor === null) throw DomainError.unprocessable("An AMOUNT pool needs a priced impact to draw from");
    assertMinorUnits(args.priceMinor, "price");
    return { hours: null, amountMinor: args.priceMinor };
  }
  if (args.effortDays === null) throw DomainError.unprocessable("An HOURS pool needs estimated effort days to draw from");
  if (!Number.isFinite(args.effortDays) || args.effortDays < 0) throw DomainError.unprocessable("Effort days must be a non-negative number");
  return { hours: Math.round(args.effortDays * HOURS_PER_EFFORT_DAY * 100) / 100, amountMinor: null };
}

/** Coverage check with a human reason. Returns null when the draw fits. */
export function drawBlocker(args: {
  kind: AllowanceKind;
  totalHours: number | null;
  totalMinor: number | null;
  drawDowns: DrawDownInput[];
  draw: DrawAmount;
}): string | null {
  const balance = poolBalance({ kind: args.kind, totalHours: args.totalHours, totalMinor: args.totalMinor, drawDowns: args.drawDowns });
  if (args.kind === "HOURS") {
    const need = args.draw.hours ?? 0;
    if ((balance.remainingHours ?? 0) < need) {
      return `Allowance pool covers ${balance.remainingHours}h but this change needs ${need}h`;
    }
    return null;
  }
  const need = args.draw.amountMinor ?? 0;
  if ((balance.remainingMinor ?? 0) < need) {
    return "Allowance pool balance does not cover this change's price";
  }
  return null;
}

export function objectionDeadline(notifiedAt: string, windowHours: number): string {
  if (!Number.isFinite(windowHours) || windowHours <= 0 || windowHours > 24 * 90) {
    throw new Error("objectionWindowHours must be within (0, 2160]");
  }
  return new Date(Date.parse(notifiedAt) + windowHours * 3_600_000).toISOString();
}

/** Objections land only while NOTIFIED and before the deadline. */
export function objectionBlocker(args: { status: DrawDownStatus; deadline: string; now: string }): string | null {
  if (args.status !== "NOTIFIED") return `This draw-down is ${args.status} and can no longer be objected to`;
  if (Date.parse(args.now) > Date.parse(args.deadline)) return "The objection window for this draw-down has lapsed";
  return null;
}

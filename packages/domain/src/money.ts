// Price math in integer minor units (cents). Never use floats for money.

export function assertMinorUnits(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer in minor units`);
  }
}

export function sumMinorUnits(values: Array<number | null | undefined>): number {
  let total = 0;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    assertMinorUnits(v, "price");
    total += v;
  }
  return total;
}

const CURRENCY_RE = /^[A-Z]{3}$/;

export function assertCurrency(code: string): void {
  if (!CURRENCY_RE.test(code)) throw new Error(`Invalid ISO currency code: ${code}`);
}

export function assertSameCurrency(expected: string, actual: string): void {
  assertCurrency(expected);
  assertCurrency(actual);
  if (expected !== actual) {
    throw new Error(`Currency mismatch: expected ${expected}, got ${actual}`);
  }
}

export function formatMinorUnits(minor: number, currency: string): string {
  assertMinorUnits(minor, "price");
  assertCurrency(currency);
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

/** Combined bundle price with an explicit adjustment (discounts/overlap), preventing double counting. */
export function combineBundlePrice(memberPrices: Array<number | null | undefined>, adjustmentMinor = 0): number {
  const subtotal = sumMinorUnits(memberPrices);
  if (!Number.isInteger(adjustmentMinor)) throw new Error("adjustment must be integer minor units");
  const total = subtotal + adjustmentMinor;
  if (total < 0) throw new Error("Bundle total cannot be negative");
  return total;
}

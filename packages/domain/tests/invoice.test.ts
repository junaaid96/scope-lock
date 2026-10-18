import { describe, expect, it } from "vitest";
import { buildInvoiceLines, invoiceLinesToCsv, invoiceTotals, type InvoiceLineInput } from "../src/invoice.js";

const line = (over: Partial<InvoiceLineInput>): InvoiceLineInput => ({
  number: "CHG-001",
  title: "Work",
  status: "APPROVED",
  decidedAt: "2026-03-10T12:00:00.000Z",
  priceMinor: 120000,
  currency: "USD",
  pricingMode: "MANUAL",
  overrideReason: null,
  allowancePoolName: null,
  drawStatus: null,
  ...over,
});

const PERIOD = { from: "2026-03-01", to: "2026-03-31T23:59:59.999Z" };

describe("invoice export", () => {
  it("includes approved and implemented changes decided in the period", () => {
    const lines = buildInvoiceLines(
      [
        line({ number: "CHG-001" }),
        line({ number: "CHG-002", status: "IMPLEMENTED", priceMinor: 5000 }),
        line({ number: "CHG-003", status: "REJECTED" }),
        line({ number: "CHG-004", status: "PENDING_APPROVAL", decidedAt: null }),
        line({ number: "CHG-005", decidedAt: "2026-04-01T00:00:00.000Z" }),
      ],
      PERIOD,
    );
    expect(lines.map((l) => l.number)).toEqual(["CHG-001", "CHG-002"]);
    expect(lines[0]).toMatchObject({ priceMinor: 120000, price: "1200.00", currency: "USD" });
  });

  it("covers the whole calendar day for a date-only end", () => {
    const lines = buildInvoiceLines([line({ decidedAt: "2026-03-31T18:30:00.000Z" })], { from: "2026-03-01", to: "2026-03-31" });
    expect(lines).toHaveLength(1);
  });

  it("rejects inverted or invalid periods", () => {
    expect(() => buildInvoiceLines([line({})], { from: "2026-04-01", to: "2026-03-01" })).toThrow(/start must not be after/);
    expect(() => buildInvoiceLines([line({})], { from: "not-a-date", to: "2026-03-01" })).toThrow(/valid dates/);
  });

  it("totals per currency without conversion", () => {
    const lines = buildInvoiceLines(
      [line({ currency: "USD", priceMinor: 100 }), line({ currency: "EUR", priceMinor: 200 }), line({ currency: "USD", priceMinor: 50 })],
      PERIOD,
    );
    expect(invoiceTotals(lines)).toEqual([
      { currency: "EUR", totalMinor: 200, total: "2.00", lines: 1 },
      { currency: "USD", totalMinor: 150, total: "1.50", lines: 2 },
    ]);
  });

  it("escapes CSV cells per RFC 4180", () => {
    const csv = invoiceLinesToCsv(
      buildInvoiceLines(
        [line({ title: 'Fixed "login", retry\nflow', overrideReason: "a,b" }), line({ number: "CHG-002", title: "Plain" })],
        PERIOD,
      ),
    );
    const rows = csv.split("\n");
    expect(rows[0]).toBe("number,title,decided_at,price_minor,price,currency,pricing_mode,override_reason,allowance_pool,draw_status");
    expect(csv).toContain('"Fixed ""login"", retry\nflow"');
    expect(csv).toContain('"a,b"');
    expect(csv.endsWith("\n")).toBe(true);
  });
});

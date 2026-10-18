import { describe, expect, it } from "vitest";
import {
  buildCertificateModel,
  certificateFilename,
  verifyPackageChecksum,
  type CertificateInput,
} from "../src/certificate.js";
import { checksumOf } from "../src/checksum.js";

const base: CertificateInput = {
  title: "Seller wallet ledger",
  status: "DECIDED",
  checksum: "abc123",
  kind: "CHANGE",
  headline: "CHG-001 Seller wallet ledger",
  description: "Wallet ledger for sellers.",
  impact: { effortDays: 6, priceMinor: 8000000, currency: "BDT", timelineDays: 8 },
  options: [],
  decisions: [
    {
      verdict: "APPROVED",
      comment: "Ship it",
      approver: "tanvir@haat.test",
      typedName: "Tanvir Haat",
      optionLabel: null,
      decidedAt: "2026-10-18T10:00:00.000Z",
    },
  ],
  outcome: "APPROVED",
  sentAt: "2026-10-18T09:00:00.000Z",
  expiresAt: null,
  verifyUrl: "http://localhost:5100/verify/apr_123",
  deliverables: [],
};

describe("change-order certificate", () => {
  it("builds a stable, ordered content model", () => {
    const model = buildCertificateModel(base);
    expect(model.title).toBe("Seller wallet ledger");
    expect(model.sections.map((s) => s.heading)).toEqual(["Change order", "Assessed impact", "Recorded decisions"]);
    expect(model.sections[1]?.lines).toContain("Price: BDT 80000.00");
    expect(model.sections[2]?.lines[0]).toContain("APPROVED — Tanvir Haat");
    expect(model.checksum).toBe("abc123");
    // Deterministic: same input, same model.
    expect(buildCertificateModel(structuredClone(base))).toEqual(model);
  });

  it("marks the chosen option and falls back to the approver email", () => {
    const model = buildCertificateModel({
      ...base,
      options: [
        { label: "Full", priceMinor: 6000000, currency: "BDT", effortDays: 8, timelineDays: 10, chosen: false },
        { label: "Reduced", priceMinor: 2800000, currency: "BDT", effortDays: 4, timelineDays: 5, chosen: true },
      ],
      decisions: [{ ...base.decisions[0]!, typedName: null, optionLabel: "Reduced" }],
    });
    const options = model.sections.find((s) => s.heading === "Proposal options");
    expect(options?.lines[1]).toMatch(/^\[chosen\] Reduced/);
    expect(model.sections.at(-1)?.lines[0]).toContain("tanvir@haat.test");
  });

  it("handles open packages and missing money", () => {
    const model = buildCertificateModel({
      ...base,
      status: "SENT",
      outcome: null,
      impact: null,
      description: null,
      decisions: [],
    });
    expect(model.sections.map((s) => s.heading)).toEqual(["Change order", "Decision"]);
    expect(model.sections.at(-1)?.lines).toEqual(["Awaiting decision."]);
  });

  it("skips the headline when the send title restates it", () => {
    const dupe = buildCertificateModel({ ...base, title: "CHG-001: Seller wallet ledger", headline: "CHG-001 Seller wallet ledger" });
    const first = dupe.sections[0]?.lines ?? [];
    expect(first.filter((l) => l.includes("Seller wallet ledger"))).toHaveLength(1);
    const distinct = buildCertificateModel({ ...base, title: "Q3 review batch", headline: "CHG-001 Seller wallet ledger" });
    expect(distinct.sections[0]?.lines.slice(0, 2)).toEqual(["Q3 review batch", "CHG-001 Seller wallet ledger"]);
    expect(buildCertificateModel(base).standfirst).toMatch(/Record of a client decision/);
    expect(buildCertificateModel({ ...base, decisions: [] }).standfirst).toMatch(/no decision recorded yet/);
  });

  it("recomputes checksums for match/mismatch", () => {
    const pkg = { a: 1, b: [2, 3] };
    const sum = checksumOf(pkg);
    expect(verifyPackageChecksum(pkg, sum)).toEqual({ recomputed: sum, match: true });
    expect(verifyPackageChecksum({ a: 1, b: [2, 4] }, sum).match).toBe(false);
  });

  it("derives safe filenames from approval ids", () => {
    expect(certificateFilename("apr_Ab12Cd34")).toBe("change-order-Ab12Cd34.pdf");
    expect(certificateFilename("../../etc/passwd")).toBe("change-order-tcpasswd.pdf");
  });

  it("renders delivery acceptance with a deemed outcome and no client decision", () => {
    const model = buildCertificateModel({
      ...base,
      kind: "ACCEPTANCE",
      status: "DEEMED",
      impact: null,
      decisions: [],
      deliverables: [{ stableKey: "REQ-001", title: "Homepage" }],
    });
    expect(model.sections.map((s) => s.heading)).toEqual(["Delivery acceptance", "Accepted deliverables", "Decision"]);
    expect(model.sections[1]?.lines).toEqual(["REQ-001 — Homepage"]);
    expect(model.sections.at(-1)?.lines).toEqual([
      "Deemed accepted by policy at the deadline. No client decision was recorded.",
    ]);
    expect(model.standfirst).toMatch(/Record of a policy outcome/);
  });
});

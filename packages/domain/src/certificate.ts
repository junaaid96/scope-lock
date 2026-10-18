import { checksumOf } from "./checksum.js";
import { formatMinorUnits } from "./money.js";

export interface CertificateDecision {
  verdict: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  comment: string | null;
  approver: string;
  typedName: string | null;
  optionLabel: string | null;
  decidedAt: string;
}

export interface CertificateInput {
  title: string | null;
  status: string;
  checksum: string;
  kind: "CHANGE" | "BUNDLE" | "ALLOWANCE";
  headline: string;
  description: string | null;
  impact: {
    effortDays: number | null;
    priceMinor: number | null;
    currency: string | null;
    timelineDays: number | null;
  } | null;
  options: Array<{
    label: string;
    priceMinor: number | null;
    currency: string | null;
    effortDays: number | null;
    timelineDays: number | null;
    chosen: boolean;
  }>;
  decisions: CertificateDecision[];
  outcome: string | null;
  sentAt: string;
  expiresAt: string | null;
  verifyUrl: string;
}

export interface CertificateSection {
  heading: string;
  lines: string[];
}

export interface CertificateModel {
  title: string;
  standfirst: string;
  sections: CertificateSection[];
  checksum: string;
  verifyUrl: string;
}

/** Recompute the package checksum and compare — the verify page's whole job. */
export function verifyPackageChecksum(pkg: unknown, checksum: string): { recomputed: string; match: boolean } {
  const recomputed = checksumOf(pkg);
  return { recomputed, match: recomputed === checksum };
}

function money(priceMinor: number | null, currency: string | null): string {
  if (priceMinor === null || !currency) return "—";
  return formatMinorUnits(priceMinor, currency);
}

/**
 * Deterministic change-order content model: same input, same sections, same
 * order — the PDF renderer draws these lines verbatim, so byte stability
 * follows from content stability. No legal-enforceability language anywhere.
 */
export function buildCertificateModel(input: CertificateInput): CertificateModel {
  const sections: CertificateSection[] = [];
  const kindLabel = input.kind === "CHANGE" ? "Change order" : input.kind === "BUNDLE" ? "Bundle change order" : "Allowance grant";

  const title = input.title ?? input.headline;
  sections.push({
    heading: kindLabel,
    lines: [
      title,
      // Send titles often restate the headline; don't print both.
      ...(input.headline !== title && input.headline !== title.replace(/^(\S+):\s*/, "$1 ") ? [input.headline] : []),
      ...(input.description ? ["", input.description] : []),
      "",
      `Status: ${input.status}${input.outcome ? ` (${input.outcome})` : ""}`,
      `Sent: ${input.sentAt}`,
      `Expires: ${input.expiresAt ?? "never"}`,
    ],
  });

  if (input.impact) {
    sections.push({
      heading: "Assessed impact",
      lines: [
        `Price: ${money(input.impact.priceMinor, input.impact.currency)}`,
        `Effort: ${input.impact.effortDays ?? "—"} days`,
        `Timeline: ${input.impact.timelineDays ?? "—"} days`,
      ],
    });
  }

  if (input.options.length > 0) {
    sections.push({
      heading: "Proposal options",
      lines: input.options.map(
        (o) =>
          `${o.chosen ? "[chosen] " : ""}${o.label} — ${money(o.priceMinor, o.currency)}, ${o.effortDays ?? "—"} days effort, ${o.timelineDays ?? "—"} days`,
      ),
    });
  }

  sections.push({
    heading: input.decisions.length > 0 ? "Recorded decisions" : "Decision",
    lines:
      input.decisions.length > 0
        ? input.decisions.flatMap((d) => [
            `${d.verdict} — ${d.typedName ?? d.approver} (${d.decidedAt})`,
            ...(d.optionLabel ? [`  Option: ${d.optionLabel}`] : []),
            ...(d.comment ? [`  Comment: ${d.comment}`] : []),
          ])
        : ["Awaiting decision."],
  });

  return {
    title,
    standfirst:
      input.decisions.length > 0
        ? "Record of a client decision on the package below. Verify it at the link on the last page."
        : "Open review package — no decision recorded yet. Verify its contents at the link on the last page.",
    sections,
    checksum: input.checksum,
    verifyUrl: input.verifyUrl,
  };
}

/** Stable download name derived from the approval id (no user input in paths). */
export function certificateFilename(approvalId: string): string {
  const suffix = approvalId.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "order";
  return `change-order-${suffix}.pdf`;
}

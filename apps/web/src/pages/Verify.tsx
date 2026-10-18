import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import type { ReviewPackage } from "../lib/types.js";
import { Badge, Card, Empty, ErrorBanner, PageTitle, Spinner, statusTone } from "../components/ui.js";

interface VerifyData {
  approval: {
    id: string;
    title: string | null;
    status: string;
    checksum: string;
    sentAt: string;
    expiresAt: string | null;
  };
  package: ReviewPackage;
  decisions: Array<{
    decision: string;
    comment: string | null;
    approverEmail: string | null;
    typedName: string | null;
    optionLabel: string | null;
    createdAt: string;
  }>;
  recomputedChecksum: string;
  match: boolean;
}

/** Public decision-certificate page: recomputed checksum + match/mismatch, nothing beyond the package. */
export function VerifyPage(): JSX.Element {
  const { approvalId } = useParams<{ approvalId: string }>();
  const verify = useQuery({
    queryKey: ["verify", approvalId],
    queryFn: () => api.get<VerifyData>(`/verify/${approvalId}`),
    retry: false,
  });

  if (verify.isLoading) return <Centered><Spinner /></Centered>;
  if (verify.isError || !verify.data) {
    const notFound = errorMessage(verify.error).toLowerCase().includes("not found");
    return (
      <Centered>
        {notFound ? (
          <Empty title="Certificate not found" hint="Check the link — it comes from the change-order PDF." />
        ) : (
          <ErrorBanner message={errorMessage(verify.error)} />
        )}
      </Centered>
    );
  }
  const v = verify.data;
  const pkg = v.package;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <PageTitle title="Decision certificate" subtitle={v.approval.title ?? "Review package"} />
      <Card>
        <div
          role={v.match ? "status" : "alert"}
          className={`rounded-md p-3 text-sm font-medium ${v.match ? "bg-teal-50 text-teal-900" : "bg-red-50 text-red-900"}`}
        >
          {v.match
            ? "Checksum match — this page recomputed the checksum over the stored package bytes and it matches the certificate."
            : "Checksum MISMATCH — the stored bytes no longer match the certificate. Treat this package as suspect and contact the agency."}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <dt className="text-slate-500">Status</dt>
          <dd><Badge tone={statusTone(v.approval.status)}>{v.approval.status}</Badge></dd>
          <dt className="text-slate-500">Sent</dt>
          <dd>{v.approval.sentAt}</dd>
          <dt className="text-slate-500">Certificate checksum</dt>
          <dd className="break-all font-mono text-xs">{v.approval.checksum}</dd>
          <dt className="text-slate-500">Recomputed just now</dt>
          <dd className="break-all font-mono text-xs">{v.recomputedChecksum}</dd>
        </dl>

        {pkg.request ? (
          <section className="mt-4" aria-label="Request">
            <h2 className="font-medium">{pkg.request.number} {pkg.request.title}</h2>
            <p className="mt-1 text-sm text-slate-700">{pkg.request.description}</p>
          </section>
        ) : null}

        {pkg.impact ? (
          <section className="mt-4" aria-label="Impact">
            <h2 className="font-medium">Assessed impact</h2>
            <p className="mt-1 text-sm">
              {pkg.impact.currency} {((pkg.impact.priceMinor ?? 0) / 100).toFixed(2)} · {pkg.impact.effortDays ?? "—"} days effort · {pkg.impact.timelineDays ?? "—"} days
            </p>
          </section>
        ) : null}

        {(pkg.options ?? []).length > 0 ? (
          <section className="mt-4" aria-label="Proposal options">
            <h2 className="font-medium">Proposal options</h2>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {(pkg.options ?? []).map((o) => (
                <li key={o.optionId}>{o.label} — {o.currency} {((o.priceMinor ?? 0) / 100).toFixed(2)}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-4" aria-label="Decisions">
          <h2 className="font-medium">Recorded decisions</h2>
          {v.decisions.length === 0 ? (
            <p className="mt-1 text-sm text-slate-600">Awaiting decision.</p>
          ) : (
            <ul className="mt-1 space-y-1 text-sm">
              {v.decisions.map((d, i) => (
                <li key={i}>
                  <Badge tone={statusTone(d.decision)}>{d.decision}</Badge>
                  <span className="ml-2">{d.typedName ?? d.approverEmail ?? "Approver"}</span>
                  {d.optionLabel ? <span className="ml-2 font-medium">Option “{d.optionLabel}”</span> : null}
                  <span className="ml-2 text-slate-500">{d.createdAt}</span>
                  {d.comment ? <p className="mt-0.5 text-slate-700">{d.comment}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-md px-4 py-16">{children}</div>;
}

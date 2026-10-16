import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, ApiError } from "../lib/api.js";
import type { ReviewPackage } from "../lib/types.js";
import { LoadingScreen } from "../components/layout.js";
import { Badge, Button, Card, ErrorBanner, Field, Textarea, formatDate, statusTone } from "../components/ui.js";

interface ReviewData {
  status: string;
  title: string | null;
  package: ReviewPackage;
  checksum: string;
  expiresAt: string | null;
  decisions: Array<{ decision: string; comment: string | null; approverEmail: string | null; createdAt: string }>;
  invalidatedReason: string | null;
  branding?: { displayName: string; logoUrl?: string; primaryColor?: string } | null;
  organizationName?: string;
  projectName?: string;
}

export function ReviewPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const client = useQueryClient();
  const review = useQuery({
    queryKey: ["review", token],
    queryFn: () => api.get<ReviewData>(`/approval-requests/${token}`),
    retry: false,
  });

  if (review.isLoading) {
    return <LoadingScreen message="Loading the review package…" />;
  }
  if (review.isError || !review.data) {
    return (
      <Centered>
        <Card>
          <h1 className="mb-1 text-xl font-semibold">Review unavailable</h1>
          <p className="text-sm text-slate-600">{errorMessage(review.error)}</p>
          <p className="mt-3 text-sm"><Link to="/login" className="underline">Log in</Link> if you have an account.</p>
        </Card>
      </Centered>
    );
  }
  const r = review.data;
  const pkg = r.package;
  const accent = r.branding?.primaryColor ?? "#0f766e";

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        {r.branding?.logoUrl ? <img src={r.branding.logoUrl} alt="" className="h-8 w-8 rounded" /> : null}
        <div>
          <p className="text-lg font-semibold" style={{ color: accent }}>{r.branding?.displayName ?? r.organizationName ?? "ScopeLock"}</p>
          <p className="text-sm text-slate-600">{r.projectName ?? "Proposal"} · review</p>
        </div>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{r.title ?? "Review package"}</h1>
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Sent {formatDate(pkg.sentAt)} · expires {formatDate(r.expiresAt)} · checksum {r.checksum.slice(0, 12)}…
        </p>
        {r.status !== "SENT" ? (
          <div className="mt-3 rounded-md bg-slate-100 p-3 text-sm">
            {r.status === "DECIDED" && r.decisions.length > 0 ? (
              <p>Decided: <strong>{r.decisions[0]?.decision}</strong>{r.decisions[0]?.comment ? ` — ${r.decisions[0]?.comment}` : ""}</p>
            ) : r.status === "EXPIRED" ? (
              <p>This package expired without a decision. Ask the agency to send a fresh one.</p>
            ) : r.status === "INVALIDATED" ? (
              <p>Withdrawn{r.invalidatedReason ? `: ${r.invalidatedReason}` : ""}. A new package will follow if the proposal continues.</p>
            ) : null}
          </div>
        ) : null}

        {pkg.request ? (
          <section className="mt-4">
            <h2 className="font-medium">{pkg.request.number}: {pkg.request.title}</h2>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{pkg.request.description}</p>
          </section>
        ) : null}
        {pkg.members.length > 0 ? (
          <section className="mt-4">
            <h2 className="font-medium">Bundled requests ({pkg.members.length})</h2>
            <ul className="mt-1 space-y-2">
              {pkg.members.map((m) => (
                <li key={m.changeId} className="rounded-md border border-slate-200 p-2 text-sm">
                  <p className="font-medium">{m.number}: {m.title}</p>
                  <p className="text-slate-700">{m.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pkg.impact ? (
          <section className="mt-4">
            <h2 className="font-medium">Agreed impact</h2>
            <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Price</dt>
              <dd className="font-medium">
                {pkg.impact.priceMinor !== null && pkg.impact.priceMinor !== undefined
                  ? `${pkg.impact.currency} ${(pkg.impact.priceMinor / 100).toFixed(2)}`
                  : "—"}
              </dd>
              <dt className="text-slate-500">Effort</dt>
              <dd>{pkg.impact.effortDays ?? "—"} days</dd>
              <dt className="text-slate-500">Timeline</dt>
              <dd>{pkg.impact.timelineDays ?? "—"} days{pkg.impact.milestoneEffect ? ` · ${pkg.impact.milestoneEffect}` : ""}</dd>
              <dt className="text-slate-500">Confidence</dt>
              <dd>{pkg.impact.confidence}</dd>
            </dl>
            {pkg.impact.risks.length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">Risks</p><ul className="list-disc pl-5">{pkg.impact.risks.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {pkg.impact.exclusions.length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">Excluded</p><ul className="list-disc pl-5">{pkg.impact.exclusions.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {pkg.impact.notes ? <p className="mt-2 text-sm">{pkg.impact.notes}</p> : null}
          </section>
        ) : null}

        {pkg.requirements.length > 0 ? (
          <section className="mt-4">
            <h2 className="font-medium">Related agreed scope</h2>
            <ul className="mt-1 space-y-2 text-sm">
              {pkg.requirements.map((q) => (
                <li key={q.requirementId} className="rounded-md border border-slate-200 p-2">
                  <p className="font-medium">{q.stableKey} · {q.title} {q.versionSequence ? `(baseline v${q.versionSequence})` : ""}</p>
                  <p className="text-slate-700">{q.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {(pkg.assumptions.length > 0 || pkg.exclusions.length > 0) ? (
          <section className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <h2 className="font-medium">Assumptions</h2>
              <ul className="list-disc pl-5 text-slate-700">{pkg.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div>
              <h2 className="font-medium">Out of scope</h2>
              <ul className="list-disc pl-5 text-slate-700">{pkg.exclusions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          </section>
        ) : null}

        {r.status === "SENT" ? (
          <DecisionForm
            refParam={token as string}
            accent={accent}
            onDecided={() => void client.invalidateQueries({ queryKey: ["review", token] })}
          />
        ) : null}
      </Card>
      <Card className="mt-4">
        <h2 className="mb-1 font-medium">What happens next</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li><strong>Approve</strong> — the agency folds this work into the agreed scope and schedules it. You will see it in the next published version.</li>
          <li><strong>Reject</strong> — nothing changes; the current agreement stands. Your comment tells the agency why.</li>
          <li><strong>Request changes</strong> — the proposal goes back for revision and you will receive a fresh package to review.</li>
        </ul>
      </Card>
      <p className="mt-4 text-center text-xs text-slate-500">
        You are deciding on exactly the package above (checksum {r.checksum.slice(0, 12)}…). First decision is binding.
      </p>
    </div>
  );
}

function DecisionForm({ refParam, accent, onDecided }: { refParam: string; accent: string; onDecided: () => void }): JSX.Element {
  const [decision, setDecision] = useState("APPROVED");
  const [comment, setComment] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post(`/approval-requests/${refParam}/decisions`, { decision, comment: comment || undefined, confirm: true });
      onDecided();
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-6 border-t border-slate-200 pt-4">
      <h2 className="font-medium">Your decision</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Decision">
        {(["APPROVED", "REJECTED", "CHANGES_REQUESTED"] as const).map((d) => (
          <label
            key={d}
            className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${
              decision === d ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
            }`}
          >
            <input type="radio" name="decision" value={d} checked={decision === d} onChange={() => setDecision(d)} className="accent-teal-700" />
            {d.replace("_", " ")}
          </label>
        ))}
      </div>
      <div className="mt-3">
        <Field label={decision === "APPROVED" ? "Comment (optional)" : "Comment (required)"} htmlFor="decision-comment">
          <Textarea id="decision-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required={decision !== "APPROVED"} />
        </Field>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required className="mt-1" />
        I confirm this decision on the exact package above. I understand the first decision is binding.
      </label>
      {error ? <div className="mt-3"><ErrorBanner message={error.message} correlationId={error.correlationId} /></div> : null}
      <Button type="submit" disabled={saving || !confirm} className="mt-3 w-full" style={{ backgroundColor: accent }}>
        {saving ? "Recording…" : "Record decision"}
      </Button>
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-md px-4 py-16">{children}</div>;
}

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { LocaleProvider, isLocale } from "../lib/i18n/index.js";
import type { ReviewPackage } from "../lib/types.js";
import { LoadingScreen } from "../components/layout.js";
import { Badge, Button, Card, ErrorBanner, Field, Input, Textarea, formatDate, statusTone } from "../components/ui.js";

interface PolicyState {
  outcome: { state: "PENDING" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED"; deciding: { tokenId: string; approverKey: string; decision: string } | null };
  yourTurn: boolean;
  yourDecision: string | null;
  approvers: Array<{ approverKey: string; email: string | null; decision: string | null; turn: boolean }>;
}

interface ReviewData {
  status: string;
  title: string | null;
  package: ReviewPackage;
  checksum: string;
  expiresAt: string | null;
  policy?: { mode: "ANY" | "ALL" | "SEQUENTIAL"; approverOrder: string[] } | null;
  chosenOptionId?: string | null;
  policyState?: PolicyState | null;
  stepUp?: { otp: boolean; typedName: boolean } | null;
  decisions: Array<{ decision: string; comment: string | null; approverEmail: string | null; optionId?: string | null; optionLabel?: string | null; typedName?: string | null; createdAt: string }>;
  invalidatedReason: string | null;
  branding?: { displayName: string; logoUrl?: string; primaryColor?: string } | null;
  organizationName?: string;
  projectName?: string;
  locale?: string;
}

const POLICY_LABEL: Record<string, string> = {
  ANY: "Any approver can decide this package.",
  ALL: "Every approver must approve; the first rejection or change request decides it.",
  SEQUENTIAL: "Approvers decide in the order shown below.",
};

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
  const locale = isLocale(r.locale) ? r.locale : "en";

  return (
    <LocaleProvider locale={locale}>
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
              <div>
                <p>Decided: <strong>{r.policyState?.outcome.state ?? r.decisions[0]?.decision}</strong>
                  {r.chosenOptionId ? ` — option “${(pkg.options ?? []).find((o) => o.optionId === r.chosenOptionId)?.label ?? "?"}”` : ""}
                </p>
                {r.decisions.length > 1 ? (
                  <ul className="mt-1 list-disc pl-5">
                    {r.decisions.map((d, i) => (
                      <li key={i}>{d.typedName ?? d.approverEmail ?? "Approver"} — {d.decision}{d.optionLabel ? ` (option “${d.optionLabel}”)` : ""}{d.comment ? ` — ${d.comment}` : ""}</li>
                    ))}
                  </ul>
                ) : r.decisions[0]?.optionLabel || r.decisions[0]?.comment || r.decisions[0]?.typedName ? (
                  <p>
                    {r.decisions[0]?.typedName ? `Confirmed by ${r.decisions[0]?.typedName}. ` : ""}
                    {r.decisions[0]?.optionLabel ? `Option “${r.decisions[0]?.optionLabel}”. ` : ""}
                    {r.decisions[0]?.comment ?? ""}
                  </p>
                ) : null}
              </div>
            ) : r.status === "EXPIRED" ? (
              <p>This package expired without a decision. Ask the agency to send a fresh one.</p>
            ) : r.status === "DEEMED" ? (
              <p>Deemed accepted by policy at the deadline — no objections were raised in time. No client decision was recorded.</p>
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
        {pkg.allowance ? (
          <section className="mt-4" aria-label="Allowance grant terms">
            <h2 className="font-medium">Allowance grant terms</h2>
            <p className="mt-1 text-sm text-slate-700">
              Approving grants a pre-agreed pool that later approved changes draw from. Each draw notifies you and can be
              objected to within the window below.
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">Pool</dt>
              <dd className="font-medium">
                {pkg.allowance.kind === "HOURS" ? `${pkg.allowance.totalHours} hours` : `${pkg.allowance.currency} ${((pkg.allowance.totalMinor ?? 0) / 100).toFixed(2)}`}
              </dd>
              <dt className="text-slate-500">Objection window</dt>
              <dd>{pkg.allowance.objectionWindowHours} hours after each draw</dd>
            </dl>
          </section>
        ) : null}
        {pkg.acceptance ? (
          <section className="mt-4" aria-label="Deliverables for acceptance">
            <h2 className="font-medium">Deliverables for acceptance ({pkg.acceptance.requirements.length})</h2>
            <p className="mt-1 text-sm text-slate-600">
              The agency marks this work delivered. Approving accepts it; rejecting sends it back for rework.
            </p>
            <ul className="mt-2 space-y-2 text-sm">
              {pkg.acceptance.requirements.map((q) => (
                <li key={q.requirementId} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium">{q.stableKey} · {q.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{q.description}</p>
                  {q.acceptanceCriteria.length > 0 ? (
                    <div className="mt-2">
                      <p className="font-medium">Acceptance criteria</p>
                      <ul className="list-disc pl-5 text-slate-700">{q.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
                    </div>
                  ) : null}
                  {q.evidence.length > 0 ? (
                    <div className="mt-2">
                      <p className="font-medium">Delivery evidence</p>
                      <ul className="mt-1 space-y-1">
                        {q.evidence.map((e) => (
                          <li key={e.evidenceId} className="text-slate-700">
                            <Badge tone={e.status === "ACCEPTED" ? "green" : e.status === "REVIEWED" ? "blue" : "slate"}>{e.status}</Badge>{" "}
                            <span className="font-medium">{e.title}</span>{" "}
                            <span className="text-xs text-slate-500">({e.type})</span>
                            {e.url ? <> · <a className="underline" href={e.url} target="_blank" rel="noreferrer">open</a></> : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
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

        {(pkg.options ?? []).length > 0 ? (
          <section className="mt-4" aria-label="Proposal options">
            <h2 className="font-medium">Proposal options — approve exactly one</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {(pkg.options ?? []).map((o) => (
                <li key={o.optionId} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium">
                    {o.label} · {o.currency} {((o.priceMinor ?? 0) / 100).toFixed(2)} · {o.effortDays ?? "—"} days effort · {o.timelineDays ?? "—"} days
                    {r.chosenOptionId === o.optionId ? " · chosen" : ""}
                  </p>
                  {o.description ? <p className="mt-1 text-slate-700">{o.description}</p> : null}
                  {o.milestoneEffect ? <p className="mt-1 text-slate-700">Milestone effect: {o.milestoneEffect}</p> : null}
                  {o.risks.length > 0 ? <p className="mt-1 text-slate-700">Risks: {o.risks.join("; ")}</p> : null}
                  {o.exclusions.length > 0 ? <p className="mt-1 text-slate-700">Excluded: {o.exclusions.join("; ")}</p> : null}
                  {o.notes ? <p className="mt-1 text-slate-700">{o.notes}</p> : null}
                </li>
              ))}
            </ul>
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

        {r.policyState && r.policyState.approvers.length > 1 ? (
          <section className="mt-4" aria-label="Approvers">
            <h2 className="font-medium">Approvers</h2>
            <p className="mt-1 text-sm text-slate-600">{POLICY_LABEL[r.policy?.mode ?? "ANY"]}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {r.policyState.approvers.map((a) => (
                <li key={a.approverKey} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5">
                  <span className="font-medium">{a.email ?? "Approver"}{a.turn && r.status === "SENT" ? " · deciding now" : ""}</span>
                  <Badge tone={a.decision ? statusTone(a.decision) : "slate"}>{a.decision ?? "WAITING"}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {r.status === "SENT" ? (
          <DecisionForm
            refParam={token as string}
            accent={accent}
            policyState={r.policyState ?? null}
            options={pkg.options ?? []}
            stepUp={r.stepUp ?? { otp: false, typedName: false }}
            onDecided={() => void client.invalidateQueries({ queryKey: ["review", token] })}
          />
        ) : null}
      </Card>
      <Card className="mt-4">
        <h2 className="mb-1 font-medium">What happens next</h2>
        {pkg.acceptance ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>Approve</strong> — the deliverables above are accepted as done.</li>
            <li><strong>Reject</strong> — the work goes back to the agency for rework. Your comment tells them why.</li>
            <li><strong>Request changes</strong> — the delivery stays in place while the agency revises it.</li>
          </ul>
        ) : pkg.allowance ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>Approve</strong> — the pool activates and approved changes linked to it draw from it. You are notified of every draw.</li>
            <li><strong>Reject</strong> — no pool is created; each change still needs its own approval as before.</li>
            <li><strong>Request changes</strong> — the proposal goes back for revision and you will receive a fresh package to review.</li>
          </ul>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>Approve</strong> — {(pkg.options ?? []).length > 0 ? "you pick exactly one option and " : ""}the agency folds this work into the agreed scope and schedules it. You will see it in the next published version.</li>
            <li><strong>Reject</strong> — nothing changes; the current agreement stands. Your comment tells the agency why.</li>
            <li><strong>Request changes</strong> — the proposal goes back for revision and you will receive a fresh package to review.</li>
          </ul>
        )}
      </Card>
      {(r.status === "SENT" || r.status === "DECIDED" || r.status === "DEEMED") ? (
        <p className="mt-4 text-center text-sm">
          <a className="font-medium text-teal-800 underline" href={`/api/v1/approval-requests/${token}/pdf`} download>
            Download {pkg.acceptance ? "acceptance record" : "change order"} (PDF)
          </a>
        </p>
      ) : null}
      <p className="mt-4 text-center text-xs text-slate-600">
        You are deciding on exactly the package above (checksum {r.checksum.slice(0, 12)}…). Recorded decisions are final.
      </p>
    </div>
    </LocaleProvider>
  );
}

function DecisionForm({ refParam, accent, policyState, options, stepUp, onDecided }: {
  refParam: string;
  accent: string;
  policyState: PolicyState | null;
  options: ReviewPackage["options"];
  stepUp: { otp: boolean; typedName: boolean };
  onDecided: () => void;
}): JSX.Element {
  const [decision, setDecision] = useState("APPROVED");
  const [optionId, setOptionId] = useState("");
  const [comment, setComment] = useState("");
  const [otp, setOtp] = useState("");
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [sendingCode, setSendingCode] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const optionList = options ?? [];
  const needsPick = decision === "APPROVED" && optionList.length > 0;
  const ready = confirm && (!needsPick || optionId) && (!stepUp.otp || /^\d{6}$/.test(otp)) && (!stepUp.typedName || typedName.trim().length >= 2);

  if (policyState?.yourDecision) {
    return (
      <div className="mt-6 border-t border-slate-200 pt-4">
        <h2 className="font-medium">Your decision</h2>
        <p className="mt-2 rounded-md bg-slate-100 p-3 text-sm">
          You decided <strong>{policyState.yourDecision}</strong>. {policyState.outcome.state === "PENDING" ? "Waiting on the other approvers." : ""}
        </p>
      </div>
    );
  }
  if (policyState && !policyState.yourTurn) {
    const current = policyState.approvers.find((a) => a.turn);
    return (
      <div className="mt-6 border-t border-slate-200 pt-4">
        <h2 className="font-medium">Your decision</h2>
        <p className="mt-2 rounded-md bg-slate-100 p-3 text-sm">
          Approvers decide in order{current?.email ? ` — currently waiting on ${current.email}` : ""}. Your form unlocks when it is your turn.
        </p>
      </div>
    );
  }

  const requestCode = async (): Promise<void> => {
    setError(null);
    setSendingCode(true);
    try {
      const res = await api.post<{ email: string }>(`/approval-requests/${refParam}/step-up`, {});
      setCodeSentTo(res.email);
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post(`/approval-requests/${refParam}/decisions`, {
        decision,
        comment: comment || undefined,
        ...(needsPick ? { optionId } : {}),
        ...(stepUp.otp ? { otp } : {}),
        ...(stepUp.typedName ? { typedName: typedName.trim() } : {}),
        confirm: true,
      });
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
      {needsPick ? (
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-slate-900">Pick exactly one option to approve</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Proposal option">
            {optionList.map((o) => (
              <label
                key={o.optionId}
                className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2.5 text-sm font-medium transition-colors ${
                  optionId === o.optionId ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-700 hover:border-slate-300"
                }`}
              >
                <input
                  type="radio"
                  name="option"
                  value={o.optionId}
                  checked={optionId === o.optionId}
                  onChange={() => setOptionId(o.optionId)}
                  required
                  className="accent-teal-700"
                />
                {o.label} · {o.currency} {((o.priceMinor ?? 0) / 100).toFixed(2)}
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      <div className="mt-3">
        <Field label={decision === "APPROVED" ? "Comment (optional)" : "Comment (required)"} htmlFor="decision-comment">
          <Textarea id="decision-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required={decision !== "APPROVED"} />
        </Field>
      </div>
      {stepUp.otp || stepUp.typedName ? (
        <fieldset className="mt-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-900">Verify it is you</legend>
          {stepUp.otp ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {codeSentTo
                  ? `We emailed a 6-digit code to ${codeSentTo}. It expires in 10 minutes.`
                  : "This review asks for an email code before you can decide."}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label="6-digit code" htmlFor="decision-otp">
                  <Input
                    id="decision-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    className="w-32"
                  />
                </Field>
                <Button type="button" variant="secondary" disabled={sendingCode} onClick={() => void requestCode()}>
                  {sendingCode ? "Sending…" : codeSentTo ? "Resend code" : "Email me a code"}
                </Button>
              </div>
            </div>
          ) : null}
          {stepUp.typedName ? (
            <div className={stepUp.otp ? "mt-3" : undefined}>
              <Field label="Type your full name" htmlFor="decision-typed-name" hint="Recorded with your decision to show who confirmed it.">
                <Input
                  id="decision-typed-name"
                  autoComplete="name"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                />
              </Field>
            </div>
          ) : null}
        </fieldset>
      ) : null}
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} required className="mt-1" />
        I confirm this decision on the exact package above. I understand recorded decisions are final.
      </label>
      {error ? <div className="mt-3"><ErrorBanner message={error.message} correlationId={error.correlationId} /></div> : null}
      <Button type="submit" disabled={saving || !ready} className="mt-3 w-full" style={{ backgroundColor: accent }}>
        {saving ? "Recording…" : "Record decision"}
      </Button>
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-md px-4 py-16">{children}</div>;
}

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { LocaleProvider, isLocale, useLocale } from "../lib/i18n/index.js";
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

const POLICY_LABEL: Record<string, "review.policyAny" | "review.policyAll" | "review.policySequential"> = {
  ANY: "review.policyAny",
  ALL: "review.policyAll",
  SEQUENTIAL: "review.policySequential",
};

export function ReviewPage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const review = useQuery({
    queryKey: ["review", token],
    queryFn: () => api.get<ReviewData>(`/approval-requests/${token}`),
    retry: false,
  });
  // The provider must sit ABOVE the component that calls useLocale(): a hook
  // reads the context from its parent tree, never from a provider it renders.
  const locale = review.data && isLocale(review.data.locale) ? review.data.locale : undefined;
  return (
    <LocaleProvider locale={locale}>
      <ReviewBody token={token ?? ""} review={review} />
    </LocaleProvider>
  );
}

function ReviewBody({ token, review }: { token: string; review: UseQueryResult<ReviewData> }): JSX.Element {
  const client = useQueryClient();
  const { t } = useLocale();

  if (review.isLoading) {
    return <LoadingScreen message={t("review.loadingPackage")} />;
  }
  if (review.isError || !review.data) {
    return (
      <Centered>
        <Card>
          <h1 className="mb-1 text-xl font-semibold">{t("review.unavailableTitle")}</h1>
          <p className="text-sm text-slate-600">{errorMessage(review.error)}</p>
          <p className="mt-3 text-sm"><Link to="/login" className="underline">{t("review.loginLink")}</Link> {t("review.loginSuffix")}</p>
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
          <p className="text-sm text-slate-600">{t("review.projectReview", { project: r.projectName ?? t("review.defaultProject") })}</p>
        </div>
      </header>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">{r.title ?? t("review.defaultTitle")}</h1>
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {t("review.sentMeta", { sent: formatDate(pkg.sentAt), expires: formatDate(r.expiresAt), checksum: `${r.checksum.slice(0, 12)}…` })}
        </p>
        {r.status !== "SENT" ? (
          <div className="mt-3 rounded-md bg-slate-100 p-3 text-sm">
            {r.status === "DECIDED" && r.decisions.length > 0 ? (
              <div>
                <p>{t("review.decidedLabel")} <strong>{r.policyState?.outcome.state ?? r.decisions[0]?.decision}</strong>
                  {r.chosenOptionId ? t("review.chosenOption", { label: (pkg.options ?? []).find((o) => o.optionId === r.chosenOptionId)?.label ?? "?" }) : ""}
                </p>
                {r.decisions.length > 1 ? (
                  <ul className="mt-1 list-disc pl-5">
                    {r.decisions.map((d, i) => (
                      <li key={i}>{d.typedName ?? d.approverEmail ?? t("review.approverFallback")} — {d.decision}{d.optionLabel ? t("review.decisionOption", { label: d.optionLabel }) : ""}{d.comment ? ` — ${d.comment}` : ""}</li>
                    ))}
                  </ul>
                ) : r.decisions[0]?.optionLabel || r.decisions[0]?.comment || r.decisions[0]?.typedName ? (
                  <p>
                    {r.decisions[0]?.typedName ? t("review.confirmedBy", { name: r.decisions[0]?.typedName }) : ""}
                    {r.decisions[0]?.optionLabel ? t("review.decisionOptionSentence", { label: r.decisions[0]?.optionLabel }) : ""}
                    {r.decisions[0]?.comment ?? ""}
                  </p>
                ) : null}
              </div>
            ) : r.status === "EXPIRED" ? (
              <p>{t("review.expiredNote")}</p>
            ) : r.status === "DEEMED" ? (
              <p>{t("review.deemedNote")}</p>
            ) : r.status === "INVALIDATED" ? (
              <p>{t("review.withdrawnNote", { reason: r.invalidatedReason ? `: ${r.invalidatedReason}` : "" })}</p>
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
          <section className="mt-4" aria-label={t("review.allowanceTerms")}>
            <h2 className="font-medium">{t("review.allowanceTerms")}</h2>
            <p className="mt-1 text-sm text-slate-700">
              {t("review.allowanceBlurb")}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">{t("review.poolLabel")}</dt>
              <dd className="font-medium">
                {pkg.allowance.kind === "HOURS" ? t("review.hoursValue", { hours: pkg.allowance.totalHours ?? 0 }) : `${pkg.allowance.currency} ${((pkg.allowance.totalMinor ?? 0) / 100).toFixed(2)}`}
              </dd>
              <dt className="text-slate-500">{t("review.objectionWindowLabel")}</dt>
              <dd>{t("review.objectionWindowValue", { hours: pkg.allowance.objectionWindowHours })}</dd>
            </dl>
          </section>
        ) : null}
        {pkg.acceptance ? (
          <section className="mt-4" aria-label={t("review.deliverablesAria")}>
            <h2 className="font-medium">{t("review.deliverablesTitle", { count: pkg.acceptance.requirements.length })}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {t("review.acceptanceBlurb")}
            </p>
            <ul className="mt-2 space-y-2 text-sm">
              {pkg.acceptance.requirements.map((q) => (
                <li key={q.requirementId} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium">{q.stableKey} · {q.title}</p>
                  <p className="mt-1 whitespace-pre-wrap text-slate-700">{q.description}</p>
                  {q.acceptanceCriteria.length > 0 ? (
                    <div className="mt-2">
                      <p className="font-medium">{t("review.acceptanceCriteria")}</p>
                      <ul className="list-disc pl-5 text-slate-700">{q.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
                    </div>
                  ) : null}
                  {q.evidence.length > 0 ? (
                    <div className="mt-2">
                      <p className="font-medium">{t("review.deliveryEvidence")}</p>
                      <ul className="mt-1 space-y-1">
                        {q.evidence.map((e) => (
                          <li key={e.evidenceId} className="text-slate-700">
                            <Badge tone={e.status === "ACCEPTED" ? "green" : e.status === "REVIEWED" ? "blue" : "slate"}>{e.status}</Badge>{" "}
                            <span className="font-medium">{e.title}</span>{" "}
                            <span className="text-xs text-slate-500">({e.type})</span>
                            {e.url ? <> · <a className="underline" href={e.url} target="_blank" rel="noreferrer">{t("review.openEvidence")}</a></> : null}
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
            <h2 className="font-medium">{t("review.bundledTitle", { count: pkg.members.length })}</h2>
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
            <h2 className="font-medium">{t("review.agreedImpact")}</h2>
            <dl className="mt-1 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">{t("review.priceLabel")}</dt>
              <dd className="font-medium">
                {pkg.impact.priceMinor !== null && pkg.impact.priceMinor !== undefined
                  ? `${pkg.impact.currency} ${(pkg.impact.priceMinor / 100).toFixed(2)}`
                  : "—"}
              </dd>
              <dt className="text-slate-500">{t("review.effortLabel")}</dt>
              <dd>{t("review.daysValue", { days: pkg.impact.effortDays ?? "—" })}</dd>
              <dt className="text-slate-500">{t("review.timelineLabel")}</dt>
              <dd>{t("review.daysValue", { days: pkg.impact.timelineDays ?? "—" })}{pkg.impact.milestoneEffect ? ` · ${pkg.impact.milestoneEffect}` : ""}</dd>
              <dt className="text-slate-500">{t("review.confidenceLabel")}</dt>
              <dd>{pkg.impact.confidence}</dd>
            </dl>
            {pkg.impact.risks.length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">{t("review.risksLabel")}</p><ul className="list-disc pl-5">{pkg.impact.risks.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {pkg.impact.exclusions.length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">{t("review.excludedLabel")}</p><ul className="list-disc pl-5">{pkg.impact.exclusions.map((x) => <li key={x}>{x}</li>)}</ul></div>
            ) : null}
            {pkg.impact.notes ? <p className="mt-2 text-sm">{pkg.impact.notes}</p> : null}
          </section>
        ) : null}

        {(pkg.options ?? []).length > 0 ? (
          <section className="mt-4" aria-label={t("review.optionsAria")}>
            <h2 className="font-medium">{t("review.optionsTitle")}</h2>
            <ul className="mt-2 space-y-2 text-sm">
              {(pkg.options ?? []).map((o) => (
                <li key={o.optionId} className="rounded-md border border-slate-200 p-3">
                  <p className="font-medium">
                    {o.label} · {o.currency} {((o.priceMinor ?? 0) / 100).toFixed(2)} · {t("review.optionEffort", { effort: o.effortDays ?? "—", timeline: o.timelineDays ?? "—" })}
                    {r.chosenOptionId === o.optionId ? t("review.optionChosen") : ""}
                  </p>
                  {o.description ? <p className="mt-1 text-slate-700">{o.description}</p> : null}
                  {o.milestoneEffect ? <p className="mt-1 text-slate-700">{t("review.milestoneEffect", { effect: o.milestoneEffect })}</p> : null}
                  {o.risks.length > 0 ? <p className="mt-1 text-slate-700">{t("review.risksValue", { risks: o.risks.join("; ") })}</p> : null}
                  {o.exclusions.length > 0 ? <p className="mt-1 text-slate-700">{t("review.excludedValue", { items: o.exclusions.join("; ") })}</p> : null}
                  {o.notes ? <p className="mt-1 text-slate-700">{o.notes}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {pkg.requirements.length > 0 ? (
          <section className="mt-4">
            <h2 className="font-medium">{t("review.relatedScope")}</h2>
            <ul className="mt-1 space-y-2 text-sm">
              {pkg.requirements.map((q) => (
                <li key={q.requirementId} className="rounded-md border border-slate-200 p-2">
                  <p className="font-medium">{q.stableKey} · {q.title} {q.versionSequence ? t("review.baselineVersion", { version: q.versionSequence }) : ""}</p>
                  <p className="text-slate-700">{q.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {(pkg.assumptions.length > 0 || pkg.exclusions.length > 0) ? (
          <section className="mt-4 grid gap-3 text-sm md:grid-cols-2">
            <div>
              <h2 className="font-medium">{t("review.assumptionsTitle")}</h2>
              <ul className="list-disc pl-5 text-slate-700">{pkg.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
            <div>
              <h2 className="font-medium">{t("review.outOfScopeTitle")}</h2>
              <ul className="list-disc pl-5 text-slate-700">{pkg.exclusions.map((a) => <li key={a}>{a}</li>)}</ul>
            </div>
          </section>
        ) : null}

        {r.policyState && r.policyState.approvers.length > 1 ? (
          <section className="mt-4" aria-label={t("review.approversTitle")}>
            <h2 className="font-medium">{t("review.approversTitle")}</h2>
            <p className="mt-1 text-sm text-slate-600">{t(POLICY_LABEL[r.policy?.mode ?? "ANY"])}</p>
            <ul className="mt-2 space-y-1 text-sm">
              {r.policyState.approvers.map((a) => (
                <li key={a.approverKey} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-2 py-1.5">
                  <span className="font-medium">{a.email ?? t("review.approverFallback")}{a.turn && r.status === "SENT" ? t("review.decidingNow") : ""}</span>
                  <Badge tone={a.decision ? statusTone(a.decision) : "slate"}>{a.decision ?? "WAITING"}</Badge>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {r.status === "SENT" ? (
          <DecisionForm
            refParam={token}
            accent={accent}
            policyState={r.policyState ?? null}
            options={pkg.options ?? []}
            stepUp={r.stepUp ?? { otp: false, typedName: false }}
            onDecided={() => void client.invalidateQueries({ queryKey: ["review", token] })}
          />
        ) : null}
      </Card>
      <Card className="mt-4">
        <h2 className="mb-1 font-medium">{t("review.nextTitle")}</h2>
        {pkg.acceptance ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>{t("review.decideApprove")}</strong> {t("review.nextAcceptApprove")}</li>
            <li><strong>{t("review.decideReject")}</strong> {t("review.nextAcceptReject")}</li>
            <li><strong>{t("review.decideRequestChanges")}</strong> {t("review.nextAcceptRevise")}</li>
          </ul>
        ) : pkg.allowance ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>{t("review.decideApprove")}</strong> {t("review.nextAllowApprove")}</li>
            <li><strong>{t("review.decideReject")}</strong> {t("review.nextAllowReject")}</li>
            <li><strong>{t("review.decideRequestChanges")}</strong> {t("review.nextReviseBack")}</li>
          </ul>
        ) : (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li><strong>{t("review.decideApprove")}</strong> {t("review.nextDefaultApprove", { pick: (pkg.options ?? []).length > 0 ? t("review.nextPickOption") : "" })}</li>
            <li><strong>{t("review.decideReject")}</strong> {t("review.nextDefaultReject")}</li>
            <li><strong>{t("review.decideRequestChanges")}</strong> {t("review.nextReviseBack")}</li>
          </ul>
        )}
      </Card>
      {(r.status === "SENT" || r.status === "DECIDED" || r.status === "DEEMED") ? (
        <p className="mt-4 text-center text-sm">
          <a className="font-medium text-teal-800 underline" href={`/api/v1/approval-requests/${token}/pdf`} download>
            {t("review.downloadPdf", { doc: pkg.acceptance ? t("review.acceptanceRecord") : t("review.changeOrder") })}
          </a>
        </p>
      ) : null}
      <p className="mt-4 text-center text-xs text-slate-600">
        {t("review.decidingFooter", { checksum: `${r.checksum.slice(0, 12)}…` })}
      </p>
    </div>
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
  const { t } = useLocale();
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
        <h2 className="font-medium">{t("review.yourDecision")}</h2>
        <p className="mt-2 rounded-md bg-slate-100 p-3 text-sm">
          {t("review.youDecidedPrefix")} <strong>{policyState.yourDecision}</strong>. {policyState.outcome.state === "PENDING" ? t("review.waitingOthers") : ""}
        </p>
      </div>
    );
  }
  if (policyState && !policyState.yourTurn) {
    const current = policyState.approvers.find((a) => a.turn);
    return (
      <div className="mt-6 border-t border-slate-200 pt-4">
        <h2 className="font-medium">{t("review.yourDecision")}</h2>
        <p className="mt-2 rounded-md bg-slate-100 p-3 text-sm">
          {t("review.sequentialWait", { extra: current?.email ? t("review.sequentialWaitExtra", { email: current.email }) : "" })}
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
      <h2 className="font-medium">{t("review.yourDecision")}</h2>
      <div className="mt-2 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("review.decisionGroupLabel")}>
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
          <legend className="text-sm font-medium text-slate-900">{t("review.pickOptionLegend")}</legend>
          <div className="mt-2 grid gap-2" role="radiogroup" aria-label={t("review.optionGroupLabel")}>
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
        <Field label={decision === "APPROVED" ? t("review.commentOptional") : t("review.commentRequired")} htmlFor="decision-comment">
          <Textarea id="decision-comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} required={decision !== "APPROVED"} />
        </Field>
      </div>
      {stepUp.otp || stepUp.typedName ? (
        <fieldset className="mt-3 rounded-md border border-slate-200 p-3">
          <legend className="px-1 text-sm font-medium text-slate-900">{t("review.verifyTitle")}</legend>
          {stepUp.otp ? (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">
                {codeSentTo
                  ? t("review.codeSent", { email: codeSentTo })
                  : t("review.codeNeeded")}
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t("review.codeLabel")} htmlFor="decision-otp">
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
                  {sendingCode ? t("review.sending") : codeSentTo ? t("review.resendCode") : t("review.emailCode")}
                </Button>
              </div>
            </div>
          ) : null}
          {stepUp.typedName ? (
            <div className={stepUp.otp ? "mt-3" : undefined}>
              <Field label={t("review.typedNameLabel")} htmlFor="decision-typed-name" hint={t("review.typedNameHint")}>
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
        {t("review.confirmLabel")}
      </label>
      {error ? <div className="mt-3"><ErrorBanner message={error.message} correlationId={error.correlationId} /></div> : null}
      <Button type="submit" disabled={saving || !ready} className="mt-3 w-full" style={{ backgroundColor: accent }}>
        {saving ? t("review.recording") : t("review.recordDecision")}
      </Button>
    </form>
  );
}

function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="mx-auto max-w-md px-4 py-16">{children}</div>;
}

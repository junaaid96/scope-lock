import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { AllowancePoolView, ChangeDetail, EstimateTemplate, ProjectDetail, RateCard, RequirementRow } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Textarea, cn, formatDate, statusTone } from "../components/ui.js";
import { DownloadButton, UploadBox } from "../components/upload.js";
import { OptionsCard } from "../components/options.js";
import { ActualsCard, PriceSuggestions } from "../components/actuals.js";

const MANUAL_STATUSES = ["DRAFT", "SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION", "ESTIMATING", "PARKED", "WITHDRAWN"];

export function ChangePage(): JSX.Element {
  const { id, changeId } = useParams<{ id: string; changeId: string }>();
  const projectId = id as string;
  const client = useQueryClient();
  const detail = useQuery({
    queryKey: ["change", changeId],
    queryFn: () => api.get<ChangeDetail>(`/change-requests/${changeId}`),
  });
  const [showImpact, setShowImpact] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [showQuestion, setShowQuestion] = useState(false);
  const [showTriage, setShowTriage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, money } = useLocale();

  const refresh = (): void => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["change", changeId] });
    void client.invalidateQueries({ queryKey: ["changes", projectId] });
    void client.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const patch = useMutation({
    mutationFn: (values: Record<string, unknown>) =>
      api.patch(`/change-requests/${changeId}`, { expectedVersion: detail.data?.version, ...values }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = useMutation({
    mutationFn: () => api.post(`/change-requests/${changeId}/submit`, { expectedVersion: detail.data?.version }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const convert = useMutation({
    mutationFn: () => api.post(`/change-requests/${changeId}/convert-to-scope`, {}),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const implement = useMutation({
    mutationFn: () => api.post(`/change-requests/${changeId}/implement`, { expectedVersion: detail.data?.version }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  if (detail.isLoading) return <Spinner />;
  if (detail.isError || !detail.data) return <ErrorBanner message={errorMessage(detail.error)} />;
  const c = detail.data;

  return (
    <div>
      <PageTitle
        title={`${c.number}: ${c.title}`}
        subtitle={t("change.governingBaseline", { value: c.governingVersion ? t("change.versionSeq", { seq: c.governingVersion.sequence }) : t("change.noBaseline") })}
      />
      <ProjectSubnav projectId={projectId} />
      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
        {c.classification ? <Badge>{c.classification}</Badge> : null}
        <Badge>{t("change.sourceLabel", { source: c.source })}</Badge>
        {c.unverifiedSubmitter ? <Badge tone="amber">{t("change.unverifiedSubmitter")}</Badge> : null}
      </div>
      {c.unverifiedSubmitter ? (
        <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {t("change.unverifiedBlurb")}
          {" "}{c.submitterName || c.submitterEmail ? t("change.unverifiedContact", { contact: [c.submitterName, c.submitterEmail].filter(Boolean).join(" · ") }) : t("change.noContact")}
          {" "}{t("change.confirmIdentity")}
        </p>
      ) : null}
      <WorkflowStepper status={c.status} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="mb-1 font-medium">{t("change.request")}</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{c.description}</p>
            {c.classificationRationale ? <p className="mt-2 text-sm text-slate-600">{t("change.classificationText", { rationale: c.classificationRationale })}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === "DRAFT" ? <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>{t("change.submitForTriage")}</Button> : null}
              <StatusPicker current={c.status} onPick={(status) => patch.mutate({ status })} />
              <Button size="sm" variant="secondary" onClick={() => setShowTriage(true)}>{t("change.classify")}</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowQuestion(true)}>{t("change.askClarification")}</Button>
            </div>
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{t("change.impactTitle")}</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowImpact(true)}>{t("change.recordImpact")}</Button>
            </div>
            {!c.impact ? <Empty title={t("change.noImpact")} /> : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">{t("change.price")}</dt>
                <dd className="font-medium">{money(c.impact.priceMinor, c.impact.currency ?? "USD")}</dd>
                <dt className="text-slate-500">{t("change.effort")}</dt>
                <dd>{t("change.daysValue", { value: c.impact.effortDays ?? "—" })}</dd>
                <dt className="text-slate-500">{t("change.timeline")}</dt>
                <dd>{t("change.daysValue", { value: c.impact.timelineDays ?? "—" })}{c.impact.milestoneEffect ? ` · ${c.impact.milestoneEffect}` : ""}</dd>
                <dt className="text-slate-500">{t("change.confidence")}</dt>
                <dd>{c.impact.confidence}</dd>
              </dl>
            )}
            {(c.impact?.risks ?? []).length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">{t("change.risks")}</p><ul className="list-disc pl-5">{c.impact?.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>
            ) : null}
            {c.impact?.notes ? <p className="mt-2 text-sm text-slate-700">{c.impact.notes}</p> : null}
            {c.impact?.pricing ? <PricingBreakdown impact={c.impact} /> : null}
          </Card>

          {c.status === "ESTIMATING" || c.status === "PENDING_APPROVAL" ? <PriceSuggestions changeId={c.id} /> : null}
          <ActualsCard
            changeId={c.id}
            impact={c.impact}
            status={c.status}
            currency={c.impact?.currency ?? "USD"}
            onDone={refresh}
          />

          <OptionsCard
            changeId={c.id}
            currency={c.impact?.currency ?? (c.options ?? []).find((o) => o.currency)?.currency ?? "USD"}
            status={c.status}
            options={c.options ?? []}
            chosenOptionIds={c.approvals.map((a) => a.chosenOptionId).filter((id): id is string => !!id)}
            onDone={refresh}
          />

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{t("change.linkedTitle")}</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowLink(true)}>{t("change.addLink")}</Button>
            </div>
            {c.links.length === 0 ? <Empty title={t("change.noLinks")} hint={t("change.noLinksHint")} /> : (
              <ul className="space-y-2 text-sm">
                {c.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
                    <span>
                      <Badge>{l.kind}</Badge> {l.targetTitle ?? l.targetRequirementId ?? l.targetChangeId}
                      {l.condition ? <span className="text-slate-500">{" "}{t("change.needsCondition", { condition: l.condition })}</span> : null}
                      {l.overrideRationale ? <span className="text-slate-500">{" "}{t("change.overrideDetail", { rationale: l.overrideRationale })}</span> : null}
                    </span>
                    <RemoveLink changeId={c.id} linkId={l.id} onDone={refresh} />
                  </li>
                ))}
              </ul>
            )}
            <DriftPanel changeId={c.id} projectId={projectId} onDone={refresh} />
            <AiAssistPanel changeId={c.id} onDone={refresh} />
          </Card>

          <Card>
            <h2 className="mb-2 font-medium">{t("change.clarifications")}</h2>
            {c.clarifications.length === 0 ? <Empty title={t("change.noQuestions")} /> : (
              <ul className="space-y-2 text-sm">
                {c.clarifications.map((q) => (
                  <li key={q.id} className="rounded-md border border-slate-200 p-2">
                    <p className="font-medium">{t("change.questionPrefix", { question: q.question })}</p>
                    {q.answer ? <p className="mt-1">{t("change.answerPrefix", { answer: q.answer })}</p> : <AnswerBox changeId={c.id} clarId={q.id} onDone={refresh} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">{t("change.attachments")}</h2>
              <UploadBox projectId={projectId} linked={{ linkedType: "CHANGE", linkedId: c.id }} onDone={refresh} />
            </div>
            {(c.attachments ?? []).length === 0 ? <Empty title={t("change.noAttachments")} /> : (
              <ul className="space-y-2 text-sm">
                {(c.attachments ?? []).map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
                    <span>{a.fileName} <span className="text-slate-500">({Math.round(a.sizeBytes / 1024)} KB)</span></span>
                    <span className="flex items-center gap-2">
                      <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                      {a.status === "READY" ? <DownloadButton attachmentId={a.id} fileName={a.fileName} /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-2 font-medium">{t("change.externalTitle")}</h2>
            {c.externalLinks.length === 0 ? <p className="text-sm text-slate-600">{t("change.noneLinked")}</p> : (
              <ul className="space-y-1 text-sm">
                {c.externalLinks.map((e) => (
                  <li key={e.id}>{e.provider} · {e.externalId} {e.url ? <a className="underline" href={e.url}>{t("change.openLink")}</a> : null}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-2 font-medium">{t("change.decision")}</h2>
            {c.sendBlockers.length > 0 && c.status !== "PENDING_APPROVAL" ? (
              <ul className="mb-3 list-disc pl-5 text-xs text-amber-800">
                {c.sendBlockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : null}
            {c.drawPool || c.drawDown ? (
              <p className="mb-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                {t("change.allowanceLine", { detail: c.drawPool ? t("change.drawsFromPool", { name: c.drawPool.name }) : t("change.linkedPoolRemoved") })}
                {c.drawDown ? ` ${t("change.drewDetail", { amount: c.drawDown.hours !== null && c.drawDown.hours !== undefined ? `${c.drawDown.hours}h` : money(c.drawDown.amountMinor, c.impact?.currency ?? "USD"), status: c.drawDown.status.replace(/_/g, " ").toLowerCase() })}` : ""}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={c.sendBlockers.length > 0} onClick={() => setShowSend(true)}>{t("change.sendForApproval")}</Button>
              {c.status === "APPROVED" ? (
                <>
                  <Button size="sm" variant="secondary" disabled={convert.isPending} onClick={() => convert.mutate()}>{t("change.convertToScope")}</Button>
                  <Button size="sm" variant="secondary" disabled={implement.isPending} onClick={() => implement.mutate()}>{t("change.markImplemented")}</Button>
                </>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {c.approvals.map((a) => (
                <li key={a.id} className="rounded-md border border-slate-200 p-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.title ?? t("change.reviewPackage")}</span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </span>
                  <span className="text-xs text-slate-500">{t("change.expiresOn", { date: formatDate(a.expiresAt) })}</span>
                  {a.invalidatedReason ? <p className="text-xs text-red-700">{t("change.invalidated", { reason: a.invalidatedReason })}</p> : null}
                  {a.chosenOptionId ? <p className="text-xs text-teal-800">{t("change.choseOption", { label: (a.package?.options ?? []).find((o) => o.optionId === a.chosenOptionId)?.label ?? "?" })}</p> : null}
                  {(a.status === "SENT" || a.status === "DECIDED") ? (
                    <p className="text-xs">
                      <a className="font-medium text-teal-800 underline" href={`/api/v1/approval-requests/${a.id}/pdf`} download>
                        {t("change.changeOrderPdf")}
                      </a>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
            {c.decisions.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm">
                {c.decisions.map((d) => (
                  <li key={d.id} className="rounded-md bg-slate-50 p-2">
                    <Badge tone={statusTone(d.decision)}>{d.decision}</Badge>
                    {d.optionLabel ? <span className="ml-2 text-sm font-medium">{t("change.optionChosen", { label: d.optionLabel })}</span> : null}
                    {d.typedName ? <span className="ml-2 text-sm text-slate-600">{t("change.confirmedBy", { name: d.typedName })}</span> : null}
                    <p className="mt-1">{d.comment ?? t("change.noComment")}</p>
                    <p className="text-xs text-slate-500">{d.approverEmail} · {formatDate(d.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card>
            <h2 className="mb-2 font-medium">{t("change.export")}</h2>
            <ExportButton projectId={projectId} changeId={c.id} />
          </Card>
        </div>
      </div>

      {showImpact ? <ImpactDialog change={c} projectId={projectId} onClose={() => setShowImpact(false)} onDone={refresh} /> : null}
      {showLink ? <LinkDialog change={c} projectId={projectId} onClose={() => setShowLink(false)} onDone={refresh} /> : null}
      {showSend ? <SendDialog change={c} projectId={projectId} onClose={() => setShowSend(false)} onDone={refresh} /> : null}
      {showQuestion ? <QuestionDialog changeId={c.id} onClose={() => setShowQuestion(false)} onDone={refresh} /> : null}
      {showTriage ? (
        <TriageDialog
          change={c}
          onClose={() => setShowTriage(false)}
          onSave={(classification, rationale) => {
            patch.mutate({ classification, classificationRationale: rationale || null });
            setShowTriage(false);
          }}
        />
      ) : null}
    </div>
  );
}

const CLASSIFICATIONS = ["IN_SCOPE", "POTENTIAL_CHANGE", "DUPLICATE", "NEEDS_CLARIFICATION"] as const;

function TriageDialog({ change, onClose, onSave }: { change: ChangeDetail; onClose: () => void; onSave: (c: string | null, r: string) => void }): JSX.Element {
  const { t } = useLocale();
  const [classification, setClassification] = useState(change.classification ?? "POTENTIAL_CHANGE");
  const [rationale, setRationale] = useState(change.classificationRationale ?? "");
  return (
    <Dialog title={t("change.triageTitle")} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {t("change.triageBlurb")}
        </p>
        <Field label={t("change.classificationLabel")} htmlFor="triage-class">
          <Select id="triage-class" value={classification} onChange={(e) => setClassification(e.target.value)}>
            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label={t("change.rationaleLabel")} htmlFor="triage-rationale">
          <Textarea id="triage-rationale" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t("change.rationalePlaceholder")} />
        </Field>
        <Button className="w-full" onClick={() => onSave(classification, rationale)}>{t("change.saveClassification")}</Button>
      </div>
    </Dialog>
  );
}

/** Linear workflow progress: Draft → Submitted → Triage → Estimating → Approval → Approved → Implemented. */
function WorkflowStepper({ status }: { status: string }): JSX.Element {
  const { t } = useLocale();
  const steps = [
    { id: "DRAFT", label: t("change.stepDraft") },
    { id: "SUBMITTED", label: t("change.stepSubmitted") },
    { id: "TRIAGING", label: t("change.stepTriage") },
    { id: "ESTIMATING", label: t("change.stepEstimating") },
    { id: "PENDING_APPROVAL", label: t("change.stepApproval") },
    { id: "APPROVED", label: t("change.stepApproved") },
    { id: "IMPLEMENTED", label: t("change.stepImplemented") },
  ];
  const current = steps.findIndex((s) => s.id === status);
  const sideNote =
    status === "NEEDS_CLARIFICATION"
      ? t("change.sideNoteClarification")
      : status === "REJECTED"
        ? t("change.sideNoteRejected")
        : status === "WITHDRAWN"
          ? t("change.sideNoteWithdrawn")
          : status === "PARKED"
            ? t("change.sideNoteParked")
            : null;
  return (
    <div className="mb-5">
      <ol className="flex flex-wrap items-center gap-y-2" aria-label={t("change.workflowProgress")}>
        {steps.map((s, i) => {
          const state = current === -1 ? "todo" : i < current ? "done" : i === current ? "current" : "todo";
          return (
            <li key={s.id} className="flex items-center" aria-current={state === "current" ? "step" : undefined}>
              {i > 0 ? <span aria-hidden="true" className={cn("mx-1.5 h-px w-4 sm:w-6", i <= current ? "bg-teal-600" : "bg-slate-300")} /> : null}
              <span
                className={cn(
                  "whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium",
                  state === "done" && "bg-teal-100 text-teal-900",
                  state === "current" && "bg-teal-700 text-white",
                  state === "todo" && "bg-slate-100 text-slate-600",
                )}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
      {sideNote ? <p className="mt-2 text-xs text-slate-600">{sideNote}</p> : null}
    </div>
  );
}

function StatusPicker({ current, onPick }: { current: string; onPick: (s: string) => void }): JSX.Element {
  const { t } = useLocale();
  const [value, setValue] = useState(current);
  return (
    <span className="flex items-center gap-2">
      <Select aria-label={t("change.statusPickerLabel")} value={value} onChange={(e) => setValue(e.target.value)} className="w-auto">
        {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={value === current} onClick={() => onPick(value)}>{t("change.move")}</Button>
    </span>
  );
}

function ImpactDialog({ change, projectId, onClose, onDone }: { change: ChangeDetail; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t, money } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const project = useQuery({ queryKey: ["project", projectId], queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`) });
  const orgId = project.data?.organizationId;
  const cards = useQuery({
    queryKey: ["rate-cards", orgId],
    queryFn: () => fetchAll<RateCard>(`/organizations/${orgId}/rate-cards`),
    enabled: orgId !== undefined,
  });
  const templates = useQuery({
    queryKey: ["templates", orgId],
    queryFn: () => fetchAll<EstimateTemplate>(`/organizations/${orgId}/estimate-templates`),
    enabled: orgId !== undefined,
  });
  const matching = (cards.data ?? []).filter((c) => c.currency === project.data?.currency);
  const [mode, setMode] = useState<"manual" | "card">(change.impact?.pricing ? "card" : "manual");
  const [cardId, setCardId] = useState(change.impact?.rateCardId ?? "");
  const [templateId, setTemplateId] = useState(change.impact?.templateId ?? "");
  const [lines, setLines] = useState<Array<{ label: string; role: string; hours: string }>>(
    change.impact?.pricing ? change.impact.pricing.lines.map((l) => ({ label: l.label, role: l.role, hours: String(l.hours) })) : [{ label: "", role: "", hours: "" }],
  );
  const [overrideOn, setOverrideOn] = useState(change.impact?.overrideReason !== null && change.impact?.overrideReason !== undefined);
  const defaultCard = matching.find((c) => c.isDefault) ?? matching[0] ?? null;
  const effectiveCardId = cardId !== "" ? cardId : (defaultCard?.id ?? "");
  const activeCard = matching.find((c) => c.id === effectiveCardId) ?? null;
  const { register, handleSubmit } = useForm({
    defaultValues: {
      effortDays: change.impact?.effortDays ?? "",
      priceMinor: change.impact?.pricing ? "" : (change.impact?.priceMinor ?? ""),
      overridePrice: "",
      overrideReason: change.impact?.overrideReason ?? "",
      timelineDays: change.impact?.timelineDays ?? "",
      milestoneEffect: change.impact?.milestoneEffect ?? "",
      risks: (change.impact?.risks ?? []).join("\n"),
      notes: change.impact?.notes ?? "",
      confidence: change.impact?.confidence ?? "MEDIUM",
    },
  });
  function pickTemplate(id: string): void {
    setTemplateId(id);
    const tpl = (templates.data ?? []).find((x) => x.id === id);
    if (tpl) setLines(tpl.items.map((i) => ({ label: i.label, role: i.role, hours: String(i.hours) })));
  }
  const save = useMutation({
    mutationFn: (v: Record<string, string>) => {
      const base = {
        effortDays: v.effortDays === "" ? undefined : Number(v.effortDays),
        timelineDays: v.timelineDays === "" ? undefined : Number(v.timelineDays),
        milestoneEffect: v.milestoneEffect || undefined,
        risks: String(v.risks ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        notes: v.notes || undefined,
        confidence: v.confidence,
      };
      if (mode === "manual") {
        return api.post(`/change-requests/${change.id}/impact`, {
          ...base,
          priceMinor: v.priceMinor === "" ? undefined : Math.round(Number(v.priceMinor) * 100),
        });
      }
      return api.post(`/change-requests/${change.id}/impact`, {
        ...base,
        pricing: {
          rateCardId: effectiveCardId,
          templateId: templateId === "" ? undefined : templateId,
          lineItems: lines.map((l) => ({ label: l.label.trim(), role: l.role, hours: Number(l.hours) })),
        },
        override: overrideOn
          ? { priceMinor: Math.round(Number(v.overridePrice) * 100), reason: String(v.overrideReason ?? "").trim() }
          : undefined,
      });
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("change.recordImpact")} onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v as unknown as Record<string, string>))(e)} className="grid grid-cols-2 gap-4">
        <fieldset className="col-span-2">
          <legend className="mb-1 text-sm font-medium text-slate-700">{t("change.price")}</legend>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="price-mode" checked={mode === "manual"} onChange={() => setMode("manual")} />
              {t("pricing.manualPrice")}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="price-mode" checked={mode === "card"} onChange={() => setMode("card")} />
              {t("pricing.fromRateCard")}
            </label>
          </div>
        </fieldset>
        {mode === "manual" ? (
          <Field label={t("change.priceMajorLabel")} htmlFor="imp-price">
            <Input id="imp-price" inputMode="decimal" {...register("priceMinor")} />
          </Field>
        ) : (
          <div className="col-span-2 space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="grid grid-cols-2 gap-4">
              <Field label={t("pricing.rateCard")} htmlFor="imp-card">
                <Select id="imp-card" value={effectiveCardId} onChange={(e) => setCardId(e.target.value)}>
                  {matching.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}{c.isDefault ? ` (${t("pricing.defaultCard")})` : ""}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t("pricing.template")} htmlFor="imp-template">
                <Select id="imp-template" value={templateId} onChange={(e) => pickTemplate(e.target.value)}>
                  <option value="">{t("pricing.noTemplate")}</option>
                  {(templates.data ?? []).map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                  ))}
                </Select>
              </Field>
            </div>
            {matching.length === 0 ? <p className="text-sm text-slate-600">{t("pricing.staffOnly")}</p> : null}
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-slate-700">{t("pricing.lineLabel")} / {t("pricing.role")} / {t("pricing.hours")}</legend>
              <ul className="space-y-2">
                {lines.map((line, i) => (
                  <li key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] items-center gap-2">
                    <Input aria-label={`${t("pricing.lineLabel")} ${i + 1}`} placeholder={t("pricing.lineLabel")} value={line.label} onChange={(e) => setLines(lines.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))} />
                    <Select aria-label={`${t("pricing.role")} ${i + 1}`} value={line.role} onChange={(e) => setLines(lines.map((row, j) => (j === i ? { ...row, role: e.target.value } : row)))}>
                      <option value="">{t("pricing.role")}</option>
                      {(activeCard?.rates ?? []).map((r) => (
                        <option key={r.id} value={r.role}>{r.role} ({activeCard ? money(r.hourlyRateMinor, activeCard.currency) : ""}/h)</option>
                      ))}
                    </Select>
                    <Input aria-label={`${t("pricing.hours")} ${i + 1}`} placeholder="8" inputMode="decimal" value={line.hours} onChange={(e) => setLines(lines.map((row, j) => (j === i ? { ...row, hours: e.target.value } : row)))} />
                    <Button type="button" size="sm" variant="secondary" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t("pricing.remove")}</Button>
                  </li>
                ))}
              </ul>
              <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setLines([...lines, { label: "", role: "", hours: "" }])}>{t("pricing.addLine")}</Button>
            </fieldset>
            <p className="text-sm text-slate-600">{t("pricing.totalComputedOnSave")}</p>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={overrideOn} onChange={(e) => setOverrideOn(e.target.checked)} />
              {t("pricing.overridePrice")}
            </label>
            {overrideOn ? (
              <div className="grid grid-cols-2 gap-4">
                <Field label={t("pricing.overridePriceLabel")} htmlFor="imp-override-price">
                  <Input id="imp-override-price" inputMode="decimal" {...register("overridePrice")} />
                </Field>
                <Field label={t("pricing.overrideReason")} htmlFor="imp-override-reason">
                  <Input id="imp-override-reason" {...register("overrideReason")} />
                </Field>
              </div>
            ) : null}
          </div>
        )}
        <Field label={t("options.effortDays")} htmlFor="imp-effort">
          <Input id="imp-effort" inputMode="decimal" {...register("effortDays")} />
        </Field>
        <Field label={t("change.timelineEffectLabel")} htmlFor="imp-timeline">
          <Input id="imp-timeline" inputMode="numeric" {...register("timelineDays")} />
        </Field>
        <Field label={t("change.confidence")} htmlFor="imp-confidence">
          <Select id="imp-confidence" {...register("confidence")}>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label={t("options.milestoneEffect")} htmlFor="imp-milestone">
            <Input id="imp-milestone" {...register("milestoneEffect")} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label={t("change.risksLabel")} htmlFor="imp-risks">
            <Textarea id="imp-risks" rows={2} {...register("risks")} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label={t("options.notes")} htmlFor="imp-notes">
            <Textarea id="imp-notes" rows={2} {...register("notes")} />
          </Field>
        </div>
        {error ? <div className="col-span-2"><ErrorBanner message={error} /></div> : null}
        <div className="col-span-2"><Button type="submit" disabled={save.isPending} className="w-full">{t("change.saveImpact")}</Button></div>
      </form>
    </Dialog>
  );
}

function PricingBreakdown({ impact }: { impact: NonNullable<ChangeDetail["impact"]> }): JSX.Element | null {
  const { t, money, number } = useLocale();
  const pricing = impact.pricing;
  if (!pricing) return null;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 p-3 text-sm">
      <p className="font-medium text-slate-900">{t("pricing.breakdown")}</p>
      <p className="text-slate-600">
        {pricing.mode === "OVERRIDE" && impact.overrideReason
          ? t("pricing.overridden", { reason: impact.overrideReason })
          : t("pricing.computedVia", { card: pricing.rateCardName })}
      </p>
      <ul className="mt-2 space-y-1">
        {pricing.lines.map((l, i) => (
          <li key={i} className="flex justify-between gap-2 tabular-nums">
            <span>{l.label} — {l.role}, {number(l.hours)}h</span>
            <span>{money(l.lineMinor, pricing.currency)}</span>
          </li>
        ))}
      </ul>
      <dl className="mt-2 space-y-1 border-t border-slate-100 pt-2 tabular-nums">
        <div className="flex justify-between gap-2"><dt>{t("pricing.subtotal")}</dt><dd>{money(pricing.subtotalMinor, pricing.currency)}</dd></div>
        <div className="flex justify-between gap-2"><dt>{t("pricing.contingencyLine", { pct: pricing.contingencyPct })}</dt><dd>{money(pricing.contingencyMinor, pricing.currency)}</dd></div>
        {pricing.taxPct !== null ? (
          <div className="flex justify-between gap-2"><dt>{t("pricing.taxLine", { pct: pricing.taxPct })}</dt><dd>{money(pricing.taxMinor, pricing.currency)}</dd></div>
        ) : null}
        <div className="flex justify-between gap-2 font-medium"><dt>{t("pricing.total")}</dt><dd>{money(pricing.computedMinor, pricing.currency)}</dd></div>
      </dl>
    </div>
  );
}

function LinkDialog({ change, projectId, onClose, onDone }: { change: ChangeDetail; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const requirements = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.get<{ data: RequirementRow[] }>(`/projects/${projectId}/requirements`),
  });
  const changes = useQuery({
    queryKey: ["changes", projectId],
    queryFn: () => fetchAll<{ id: string; number: string; title: string }>(`/projects/${projectId}/change-requests`),
  });
  const { register, handleSubmit, watch } = useForm({ defaultValues: { targetType: "REQUIREMENT", kind: "AFFECTS", targetRequirementId: "", targetChangeId: "", condition: "PREREQ_APPROVED", overrideRationale: "" } });
  const targetType = watch("targetType");
  const kind = watch("kind");
  const save = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api.post(`/change-requests/${change.id}/links`, {
        targetType: v.targetType,
        targetRequirementId: v.targetType === "REQUIREMENT" ? v.targetRequirementId || undefined : undefined,
        targetChangeId: v.targetType === "CHANGE" ? v.targetChangeId || undefined : undefined,
        kind: v.kind,
        condition: v.kind === "DEPENDS_ON" ? v.condition : undefined,
        overrideRationale: v.overrideRationale || undefined,
      }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("change.addLink")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v as unknown as Record<string, string>))(e)} className="space-y-4">
        <Field label={t("change.targetTypeLabel")} htmlFor="link-type">
          <Select id="link-type" {...register("targetType")}>
            <option value="REQUIREMENT">{t("change.requirementWord")}</option>
            <option value="CHANGE">{t("change.changeRequestWord")}</option>
          </Select>
        </Field>
        {targetType === "REQUIREMENT" ? (
          <Field label={t("change.requirementWord")} htmlFor="link-req">
            <Select id="link-req" {...register("targetRequirementId")}>
              <option value="">{t("change.selectOption")}</option>
              {(requirements.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.stableKey} · {(r.published ?? r.draft)?.title ?? r.status}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label={t("change.changeRequestWord")} htmlFor="link-change">
            <Select id="link-change" {...register("targetChangeId")}>
              <option value="">{t("change.selectOption")}</option>
              {(changes.data ?? []).filter((c) => c.id !== change.id).map((c) => <option key={c.id} value={c.id}>{c.number}: {c.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t("change.kindLabel")} htmlFor="link-kind">
          <Select id="link-kind" {...register("kind")}>
            <option value="AFFECTS">AFFECTS</option>
            <option value="RELATED">RELATED</option>
            <option value="DUPLICATE_OF">DUPLICATE_OF</option>
            <option value="DEPENDS_ON">DEPENDS_ON</option>
          </Select>
        </Field>
        {kind === "DEPENDS_ON" ? (
          <>
            <Field label={t("change.conditionLabel")} htmlFor="link-condition">
              <Select id="link-condition" {...register("condition")}>
                <option value="PREREQ_APPROVED">PREREQ_APPROVED</option>
                <option value="PREREQ_IMPLEMENTED">PREREQ_IMPLEMENTED</option>
              </Select>
            </Field>
            <Field label={t("change.overrideRationaleLabel")} htmlFor="link-override">
              <Input id="link-override" {...register("overrideRationale")} />
            </Field>
          </>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("change.addLink")}</Button>
      </form>
    </Dialog>
  );
}

function RemoveLink({ changeId, linkId, onDone }: { changeId: string; linkId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const remove = useMutation({
    mutationFn: () => api.delete(`/change-requests/${changeId}/links/${linkId}`),
    onSuccess: onDone,
  });
  return <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>{t("pricing.remove")}</Button>;
}

function SendDialog({ change, projectId, onClose, onDone }: { change: ChangeDetail; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<string[] | null>(null);
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => fetchAll<{ userId: string; role: string; user: { name: string } | null }>(`/projects/${projectId}/members`),
  });
  const [approvers, setApprovers] = useState<string[]>([]);
  const [extraEmails, setExtraEmails] = useState("");
  const [expiry, setExpiry] = useState("");
  const pools = useQuery({
    queryKey: ["allowance-pools", projectId],
    queryFn: () => fetchAll<AllowancePoolView>(`/projects/${projectId}/allowance-pools`),
  });
  const [poolId, setPoolId] = useState(change.drawAllowancePoolId ?? "");
  const [policyMode, setPolicyMode] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api.post<{ approval: { id: string }; reviewUrls?: string[] }>(`/change-requests/${change.id}/approval-requests`, {
        approverUserIds: approvers,
        approverEmails: extraEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
        expiresAt: new Date(expiry).toISOString(),
        allowancePoolId: poolId || null,
        ...(policyMode ? { policyMode } : {}),
      }),
    onSuccess: (res) => {
      setLinks(res.reviewUrls ?? []);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("change.sendTitle")} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {t("change.sendBlurb")}
      </p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name} ({m.role})
        </label>
      ))}
      <div className="mt-3">
        <Field label={t("change.extraEmailsLabel")} htmlFor="send-emails" hint={t("change.extraEmailsHint")}>
          <Input id="send-emails" type="text" inputMode="email" placeholder="client@example.com" value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label={t("change.poolLabel")}
          htmlFor="send-pool"
          hint={t("change.poolHint")}
        >
          <select id="send-pool" value={poolId} onChange={(e) => setPoolId(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">{t("change.noPool")}</option>
            {(pools.data ?? []).filter((p) => p.enabled && p.status === "ACTIVE").map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.kind.toLowerCase()})</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label={t("change.decisionRuleLabel")}
          htmlFor="send-policy"
          hint={t("change.decisionRuleHint")}
        >
          <select id="send-policy" value={policyMode} onChange={(e) => setPolicyMode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">{t("change.projectDefault")}</option>
            <option value="ANY">{t("policy.modeANY")}</option>
            <option value="ALL">{t("policy.modeALL")}</option>
            <option value="SEQUENTIAL">{t("policy.modeSEQUENTIAL")}</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t("change.expiresAtLabel")} htmlFor="send-expiry">
          <Input id="send-expiry" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {links ? (
        <ul className="mt-3 space-y-1 text-sm">
          {links.map((l) => <li key={l}><Link className="underline" to={l.replace(/^https?:\/\/[^/]+/, "")}>{t("change.openReviewLink")}</Link></li>)}
        </ul>
      ) : (
        <Button className="mt-3 w-full" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>
          {t("change.sendPackage")}
        </Button>
      )}
    </Dialog>
  );
}

function QuestionDialog({ changeId, onClose, onDone }: { changeId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ question: string }>();
  const save = useMutation({
    mutationFn: (v: { question: string }) => api.post(`/change-requests/${changeId}/clarifications`, v),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("change.askClarification")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("change.questionLabel")} error={formState.errors.question?.message} htmlFor="q-text">
          <Textarea id="q-text" rows={3} {...register("question", { required: t("change.questionRequired") })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" className="w-full">{t("change.sendQuestion")}</Button>
      </form>
    </Dialog>
  );
}

function AnswerBox({ changeId, clarId, onDone }: { changeId: string; clarId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [answer, setAnswer] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/change-requests/${changeId}/clarifications/${clarId}/answer`, { answer }),
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Input aria-label={t("change.answerWord")} value={answer} onChange={(e) => setAnswer(e.target.value)} required />
      <Button size="sm" type="submit" disabled={save.isPending}>{t("change.answerWord")}</Button>
    </form>
  );
}

interface DriftOutput {
  links: Array<{ requirementId: string; confidence: number; explanation: string }>;
  missingContext: string[];
  suggestedClassification?: string;
  droppedInventedIds?: number;
  note?: string;
}

function DriftPanel({ changeId, projectId, onDone }: { changeId: string; projectId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [result, setResult] = useState<{
    deterministic: Array<{ stableKey: string; score: number; explanation: string }>;
    status: string;
    output: DriftOutput;
  } | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const requirements = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.get<{ data: RequirementRow[] }>(`/projects/${projectId}/requirements`),
  });
  const run = useMutation({
    mutationFn: () =>
      api.post<{
        deterministic: Array<{ stableKey: string; score: number; explanation: string }>;
        analysis: { status: string; output: DriftOutput };
      }>(`/change-requests/${changeId}/ai/scope-analysis`, {}),
    onSuccess: (res) => {
      setDismissed([]);
      setResult({ deterministic: res.deterministic, status: res.analysis.status, output: res.analysis.output });
    },
  });
  const accept = useMutation({
    mutationFn: (requirementId: string) =>
      api.post(`/change-requests/${changeId}/links`, { targetType: "REQUIREMENT", targetRequirementId: requirementId, kind: "AFFECTS" }),
    onSuccess: onDone,
  });
  const keyById = new Map((requirements.data?.data ?? []).map((r) => [r.id, r]));
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">{t("change.driftTitle")}</p>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? t("change.checking") : t("change.runCheck")}
        </Button>
      </div>
      {run.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(run.error)}</p> : null}
      {result ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-xs text-slate-500">
            {t("change.aiStatus", { status: result.status })}
            {result.output.suggestedClassification ? ` ${t("change.suggestedValue", { value: result.output.suggestedClassification })}` : ""}
            {(result.output.droppedInventedIds ?? 0) > 0 ? ` ${t("change.inventedRejected", { count: result.output.droppedInventedIds ?? 0 })}` : ""}
          </p>
          {result.output.note ? <p className="text-xs text-slate-500">{result.output.note}</p> : null}
          {result.output.links.filter((l) => !dismissed.includes(l.requirementId)).map((l) => (
            <div key={l.requirementId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span>
                <Badge>{t("change.aiBadge")}</Badge> {keyById.get(l.requirementId)?.stableKey ?? l.requirementId}
                {" "}({Math.round(l.confidence * 100)}%): {l.explanation}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={accept.isPending} onClick={() => accept.mutate(l.requirementId)}>{t("change.acceptLink")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setDismissed([...dismissed, l.requirementId])}>{t("change.dismiss")}</Button>
              </span>
            </div>
          ))}
          {result.output.missingContext.length > 0 ? (
            <p className="text-xs text-slate-500">{t("change.missingContext", { items: result.output.missingContext.join(" · ") })}</p>
          ) : null}
          <div>
            <p className="text-xs font-medium text-slate-500">{t("change.deterministicTitle")}</p>
            {result.deterministic.length === 0 ? <p className="text-xs">{t("change.noOverlap")}</p> : (
              <ul className="text-xs text-slate-600">
                {result.deterministic.map((d) => <li key={d.stableKey}>{t("change.matchScore", { key: d.stableKey, score: d.score, explanation: d.explanation })}</li>)}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiAssistPanel({ changeId, onDone }: { changeId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [questions, setQuestions] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<{ subject: string; summary: string; bullets: string[]; nextSteps?: string } | null>(null);
  const [draftText, setDraftText] = useState("");
  const clarify = useMutation({
    mutationFn: () => api.post<{ analysis: { output: { questions: string[] } } }>(`/change-requests/${changeId}/ai/clarifications`, { maxQuestions: 5 }),
    onSuccess: (res) => setQuestions(res.analysis.output.questions),
  });
  const proposal = useMutation({
    mutationFn: () => api.post<{ analysis: { output: { subject: string; summary: string; bullets: string[]; nextSteps?: string } } }>(
      `/change-requests/${changeId}/ai/proposal-draft`, { tone: "neutral" },
    ),
    onSuccess: (res) => {
      setDraft(res.analysis.output);
      setDraftText(`${res.analysis.output.subject}\n\n${res.analysis.output.summary}`);
    },
  });
  const useQuestion = useMutation({
    mutationFn: (question: string) => api.post(`/change-requests/${changeId}/clarifications`, { question }),
    onSuccess: () => {
      setQuestions(null);
      onDone();
    },
  });
  return (
    <div className="mt-3 rounded-md bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{t("change.aiAssistTitle")}</p>
        <Button size="sm" variant="secondary" disabled={clarify.isPending} onClick={() => clarify.mutate()}>
          {clarify.isPending ? t("change.thinking") : t("change.suggestQuestions")}
        </Button>
        <Button size="sm" variant="secondary" disabled={proposal.isPending} onClick={() => proposal.mutate()}>
          {proposal.isPending ? t("change.drafting") : t("change.draftProposal")}
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">{t("change.aiDisclaimer")}</p>
      {clarify.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(clarify.error)}</p> : null}
      {proposal.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(proposal.error)}</p> : null}
      {questions ? (
        <ul className="mt-2 space-y-1 text-sm">
          {questions.map((q) => (
            <li key={q} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span>{q}</span>
              <Button size="sm" variant="secondary" disabled={useQuestion.isPending} onClick={() => useQuestion.mutate(q)}>{t("change.useAsQuestion")}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {draft ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
          <Textarea aria-label={t("change.proposalDraftAria")} rows={6} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          {draft.bullets.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{draft.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : null}
          {draft.nextSteps ? <p className="mt-1 text-xs text-slate-600">{t("change.nextSteps", { steps: draft.nextSteps })}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ExportButton({ projectId, changeId }: { projectId: string; changeId: string }): JSX.Element {
  const { t } = useLocale();
  const [downloading, setDownloading] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={downloading}
      onClick={() => {
        setDownloading(true);
        api.get<unknown>(`/projects/${projectId}/export/change/${changeId}`)
          .then((data) => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `change-export-${changeId}.json`;
            a.click();
            URL.revokeObjectURL(url);
          })
          .catch(() => undefined)
          .finally(() => setDownloading(false));
      }}
    >
      {t("change.downloadSummary")}
    </Button>
  );
}

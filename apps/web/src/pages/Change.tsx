import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { ChangeDetail, RequirementRow } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Textarea, cn, formatDate, formatMoney, statusTone } from "../components/ui.js";
import { DownloadButton, UploadBox } from "../components/upload.js";

const MANUAL_STATUSES = ["DRAFT", "SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION", "ESTIMATING", "WITHDRAWN"];

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
        subtitle={`Governing baseline: ${c.governingVersion ? `v${c.governingVersion.sequence}` : "none published yet"}`}
      />
      <ProjectSubnav projectId={projectId} />
      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(c.status)}>{c.status}</Badge>
        {c.classification ? <Badge>{c.classification}</Badge> : null}
        <Badge>Source: {c.source}</Badge>
      </div>
      <WorkflowStepper status={c.status} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <h2 className="mb-1 font-medium">Request</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-800">{c.description}</p>
            {c.classificationRationale ? <p className="mt-2 text-sm text-slate-600">Classification: {c.classificationRationale}</p> : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {c.status === "DRAFT" ? <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate()}>Submit for triage</Button> : null}
              <StatusPicker current={c.status} onPick={(status) => patch.mutate({ status })} />
              <Button size="sm" variant="secondary" onClick={() => setShowTriage(true)}>Classify…</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowQuestion(true)}>Ask clarification</Button>
            </div>
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">Impact assessment</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowImpact(true)}>Record impact</Button>
            </div>
            {!c.impact ? <Empty title="No impact recorded" /> : (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Price</dt>
                <dd className="font-medium">{formatMoney(c.impact.priceMinor, c.impact.currency ?? "USD")}</dd>
                <dt className="text-slate-500">Effort</dt>
                <dd>{c.impact.effortDays ?? "—"} days</dd>
                <dt className="text-slate-500">Timeline</dt>
                <dd>{c.impact.timelineDays ?? "—"} days{c.impact.milestoneEffect ? ` · ${c.impact.milestoneEffect}` : ""}</dd>
                <dt className="text-slate-500">Confidence</dt>
                <dd>{c.impact.confidence}</dd>
              </dl>
            )}
            {(c.impact?.risks ?? []).length > 0 ? (
              <div className="mt-2 text-sm"><p className="font-medium">Risks</p><ul className="list-disc pl-5">{c.impact?.risks.map((r) => <li key={r}>{r}</li>)}</ul></div>
            ) : null}
            {c.impact?.notes ? <p className="mt-2 text-sm text-slate-700">{c.impact.notes}</p> : null}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">Linked requirements & dependencies</h2>
              <Button size="sm" variant="secondary" onClick={() => setShowLink(true)}>Add link</Button>
            </div>
            {c.links.length === 0 ? <Empty title="No links yet" hint="Link the baseline requirements this request affects." /> : (
              <ul className="space-y-2 text-sm">
                {c.links.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2">
                    <span>
                      <Badge>{l.kind}</Badge> {l.targetTitle ?? l.targetRequirementId ?? l.targetChangeId}
                      {l.condition ? <span className="text-slate-500"> · needs {l.condition}</span> : null}
                      {l.overrideRationale ? <span className="text-slate-500"> · override: {l.overrideRationale}</span> : null}
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
            <h2 className="mb-2 font-medium">Clarifications</h2>
            {c.clarifications.length === 0 ? <Empty title="No questions yet" /> : (
              <ul className="space-y-2 text-sm">
                {c.clarifications.map((q) => (
                  <li key={q.id} className="rounded-md border border-slate-200 p-2">
                    <p className="font-medium">Q: {q.question}</p>
                    {q.answer ? <p className="mt-1">A: {q.answer}</p> : <AnswerBox changeId={c.id} clarId={q.id} onDone={refresh} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="font-medium">Attachments</h2>
              <UploadBox projectId={projectId} linked={{ linkedType: "CHANGE", linkedId: c.id }} onDone={refresh} />
            </div>
            {(c.attachments ?? []).length === 0 ? <Empty title="No attachments" /> : (
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
            <h2 className="mb-2 font-medium">External work items</h2>
            {c.externalLinks.length === 0 ? <p className="text-sm text-slate-600">None linked.</p> : (
              <ul className="space-y-1 text-sm">
                {c.externalLinks.map((e) => (
                  <li key={e.id}>{e.provider} · {e.externalId} {e.url ? <a className="underline" href={e.url}>open</a> : null}</li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <h2 className="mb-2 font-medium">Decision</h2>
            {c.sendBlockers.length > 0 && c.status !== "PENDING_APPROVAL" ? (
              <ul className="mb-3 list-disc pl-5 text-xs text-amber-800">
                {c.sendBlockers.map((b) => <li key={b}>{b}</li>)}
              </ul>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={c.sendBlockers.length > 0} onClick={() => setShowSend(true)}>Send for approval…</Button>
              {c.status === "APPROVED" ? (
                <>
                  <Button size="sm" variant="secondary" disabled={convert.isPending} onClick={() => convert.mutate()}>Convert to scope draft</Button>
                  <Button size="sm" variant="secondary" disabled={implement.isPending} onClick={() => implement.mutate()}>Mark implemented</Button>
                </>
              ) : null}
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {c.approvals.map((a) => (
                <li key={a.id} className="rounded-md border border-slate-200 p-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-medium">{a.title ?? "Review package"}</span>
                    <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                  </span>
                  <span className="text-xs text-slate-500">expires {formatDate(a.expiresAt)}</span>
                  {a.invalidatedReason ? <p className="text-xs text-red-700">Invalidated: {a.invalidatedReason}</p> : null}
                </li>
              ))}
            </ul>
            {c.decisions.length > 0 ? (
              <ul className="mt-2 space-y-2 text-sm">
                {c.decisions.map((d) => (
                  <li key={d.id} className="rounded-md bg-slate-50 p-2">
                    <Badge tone={statusTone(d.decision)}>{d.decision}</Badge>
                    <p className="mt-1">{d.comment ?? "No comment"}</p>
                    <p className="text-xs text-slate-500">{d.approverEmail} · {formatDate(d.createdAt)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>
          <Card>
            <h2 className="mb-2 font-medium">Export</h2>
            <ExportButton projectId={projectId} changeId={c.id} />
          </Card>
        </div>
      </div>

      {showImpact ? <ImpactDialog change={c} onClose={() => setShowImpact(false)} onDone={refresh} /> : null}
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
  const [classification, setClassification] = useState(change.classification ?? "POTENTIAL_CHANGE");
  const [rationale, setRationale] = useState(change.classificationRationale ?? "");
  return (
    <Dialog title="Classify request" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          A considered triage call with a rationale — not a legal declaration. It guides estimation and review.
        </p>
        <Field label="Classification" htmlFor="triage-class">
          <Select id="triage-class" value={classification} onChange={(e) => setClassification(e.target.value)}>
            {CLASSIFICATIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Rationale" htmlFor="triage-rationale">
          <Textarea id="triage-rationale" rows={3} value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why is this in or out of the agreed scope?" />
        </Field>
        <Button className="w-full" onClick={() => onSave(classification, rationale)}>Save classification</Button>
      </div>
    </Dialog>
  );
}

/** Linear workflow progress: Draft → Submitted → Triage → Estimating → Approval → Approved → Implemented. */
function WorkflowStepper({ status }: { status: string }): JSX.Element {
  const steps = [
    { id: "DRAFT", label: "Draft" },
    { id: "SUBMITTED", label: "Submitted" },
    { id: "TRIAGING", label: "Triage" },
    { id: "ESTIMATING", label: "Estimating" },
    { id: "PENDING_APPROVAL", label: "Approval" },
    { id: "APPROVED", label: "Approved" },
    { id: "IMPLEMENTED", label: "Implemented" },
  ];
  const current = steps.findIndex((s) => s.id === status);
  const sideNote =
    status === "NEEDS_CLARIFICATION"
      ? "Waiting on answers — the workflow resumes at triage or estimation."
      : status === "REJECTED"
        ? "Rejected by the client — revise the estimate or withdraw it."
        : status === "WITHDRAWN"
          ? "Withdrawn — reopen it as a draft to continue."
          : null;
  return (
    <div className="mb-5">
      <ol className="flex flex-wrap items-center gap-y-2" aria-label="Workflow progress">
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
                  state === "todo" && "bg-slate-100 text-slate-500",
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
  const [value, setValue] = useState(current);
  return (
    <span className="flex items-center gap-2">
      <Select aria-label="Change status" value={value} onChange={(e) => setValue(e.target.value)} className="w-auto">
        {MANUAL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
      <Button size="sm" variant="secondary" disabled={value === current} onClick={() => onPick(value)}>Move</Button>
    </span>
  );
}

function ImpactDialog({ change, onClose, onDone }: { change: ChangeDetail; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm({
    defaultValues: {
      effortDays: change.impact?.effortDays ?? "",
      priceMinor: change.impact?.priceMinor ?? "",
      timelineDays: change.impact?.timelineDays ?? "",
      milestoneEffect: change.impact?.milestoneEffect ?? "",
      risks: (change.impact?.risks ?? []).join("\n"),
      notes: change.impact?.notes ?? "",
      confidence: change.impact?.confidence ?? "MEDIUM",
    },
  });
  const save = useMutation({
    mutationFn: (v: Record<string, string>) =>
      api.post(`/change-requests/${change.id}/impact`, {
        effortDays: v.effortDays === "" ? undefined : Number(v.effortDays),
        priceMinor: v.priceMinor === "" ? undefined : Math.round(Number(v.priceMinor) * 100),
        timelineDays: v.timelineDays === "" ? undefined : Number(v.timelineDays),
        milestoneEffect: v.milestoneEffect || undefined,
        risks: String(v.risks ?? "").split("\n").map((s) => s.trim()).filter(Boolean),
        notes: v.notes || undefined,
        confidence: v.confidence,
      }),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Record impact" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v as unknown as Record<string, string>))(e)} className="grid grid-cols-2 gap-4">
        <Field label="Price (major units, e.g. 1200.00)" htmlFor="imp-price">
          <Input id="imp-price" inputMode="decimal" {...register("priceMinor")} />
        </Field>
        <Field label="Effort (days)" htmlFor="imp-effort">
          <Input id="imp-effort" inputMode="decimal" {...register("effortDays")} />
        </Field>
        <Field label="Timeline effect (days)" htmlFor="imp-timeline">
          <Input id="imp-timeline" inputMode="numeric" {...register("timelineDays")} />
        </Field>
        <Field label="Confidence" htmlFor="imp-confidence">
          <Select id="imp-confidence" {...register("confidence")}>
            <option value="LOW">LOW</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="HIGH">HIGH</option>
          </Select>
        </Field>
        <div className="col-span-2">
          <Field label="Milestone effect" htmlFor="imp-milestone">
            <Input id="imp-milestone" {...register("milestoneEffect")} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Risks (one per line)" htmlFor="imp-risks">
            <Textarea id="imp-risks" rows={2} {...register("risks")} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Notes" htmlFor="imp-notes">
            <Textarea id="imp-notes" rows={2} {...register("notes")} />
          </Field>
        </div>
        {error ? <div className="col-span-2"><ErrorBanner message={error} /></div> : null}
        <div className="col-span-2"><Button type="submit" disabled={save.isPending} className="w-full">Save impact</Button></div>
      </form>
    </Dialog>
  );
}

function LinkDialog({ change, projectId, onClose, onDone }: { change: ChangeDetail; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
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
    <Dialog title="Add link" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v as unknown as Record<string, string>))(e)} className="space-y-4">
        <Field label="Target type" htmlFor="link-type">
          <Select id="link-type" {...register("targetType")}>
            <option value="REQUIREMENT">Requirement</option>
            <option value="CHANGE">Change request</option>
          </Select>
        </Field>
        {targetType === "REQUIREMENT" ? (
          <Field label="Requirement" htmlFor="link-req">
            <Select id="link-req" {...register("targetRequirementId")}>
              <option value="">Select…</option>
              {(requirements.data?.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.stableKey} · {(r.published ?? r.draft)?.title ?? r.status}</option>)}
            </Select>
          </Field>
        ) : (
          <Field label="Change request" htmlFor="link-change">
            <Select id="link-change" {...register("targetChangeId")}>
              <option value="">Select…</option>
              {(changes.data ?? []).filter((c) => c.id !== change.id).map((c) => <option key={c.id} value={c.id}>{c.number}: {c.title}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Kind" htmlFor="link-kind">
          <Select id="link-kind" {...register("kind")}>
            <option value="AFFECTS">AFFECTS</option>
            <option value="RELATED">RELATED</option>
            <option value="DUPLICATE_OF">DUPLICATE_OF</option>
            <option value="DEPENDS_ON">DEPENDS_ON</option>
          </Select>
        </Field>
        {kind === "DEPENDS_ON" ? (
          <>
            <Field label="Condition" htmlFor="link-condition">
              <Select id="link-condition" {...register("condition")}>
                <option value="PREREQ_APPROVED">PREREQ_APPROVED</option>
                <option value="PREREQ_IMPLEMENTED">PREREQ_IMPLEMENTED</option>
              </Select>
            </Field>
            <Field label="Override rationale (leads only, optional)" htmlFor="link-override">
              <Input id="link-override" {...register("overrideRationale")} />
            </Field>
          </>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Add link</Button>
      </form>
    </Dialog>
  );
}

function RemoveLink({ changeId, linkId, onDone }: { changeId: string; linkId: string; onDone: () => void }): JSX.Element {
  const remove = useMutation({
    mutationFn: () => api.delete(`/change-requests/${changeId}/links/${linkId}`),
    onSuccess: onDone,
  });
  return <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>;
}

function SendDialog({ change, projectId, onClose, onDone }: { change: ChangeDetail; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<string[] | null>(null);
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => fetchAll<{ userId: string; role: string; user: { name: string } | null }>(`/projects/${projectId}/members`),
  });
  const [approvers, setApprovers] = useState<string[]>([]);
  const [extraEmails, setExtraEmails] = useState("");
  const [expiry, setExpiry] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api.post<{ approval: { id: string }; reviewUrls?: string[] }>(`/change-requests/${change.id}/approval-requests`, {
        approverUserIds: approvers,
        approverEmails: extraEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
        expiresAt: new Date(expiry).toISOString(),
      }),
    onSuccess: (res) => {
      setLinks(res.reviewUrls ?? []);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Send for approval" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        This freezes the request, impact, and linked requirements into an immutable review package. Any later edit invalidates it.
      </p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name} ({m.role})
        </label>
      ))}
      <div className="mt-3">
        <Field label="Extra approver emails (comma-separated, optional)" htmlFor="send-emails" hint="External reviewers get a secure review link without a workspace account.">
          <Input id="send-emails" type="text" inputMode="email" placeholder="client@example.com" value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Expires at" htmlFor="send-expiry">
          <Input id="send-expiry" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {links ? (
        <ul className="mt-3 space-y-1 text-sm">
          {links.map((l) => <li key={l}><Link className="underline" to={l.replace(/^https?:\/\/[^/]+/, "")}>Open review link</Link></li>)}
        </ul>
      ) : (
        <Button className="mt-3 w-full" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>
          Send package
        </Button>
      )}
    </Dialog>
  );
}

function QuestionDialog({ changeId, onClose, onDone }: { changeId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ question: string }>();
  const save = useMutation({
    mutationFn: (v: { question: string }) => api.post(`/change-requests/${changeId}/clarifications`, v),
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Ask for clarification" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Question" error={formState.errors.question?.message} htmlFor="q-text">
          <Textarea id="q-text" rows={3} {...register("question", { required: "Question is required" })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" className="w-full">Send question</Button>
      </form>
    </Dialog>
  );
}

function AnswerBox({ changeId, clarId, onDone }: { changeId: string; clarId: string; onDone: () => void }): JSX.Element {
  const [answer, setAnswer] = useState("");
  const save = useMutation({
    mutationFn: () => api.post(`/change-requests/${changeId}/clarifications/${clarId}/answer`, { answer }),
    onSuccess: onDone,
  });
  return (
    <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Input aria-label="Answer" value={answer} onChange={(e) => setAnswer(e.target.value)} required />
      <Button size="sm" type="submit" disabled={save.isPending}>Answer</Button>
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
        <p className="text-sm font-medium">Scope drift check</p>
        <Button size="sm" variant="secondary" disabled={run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? "Checking…" : "Run check"}
        </Button>
      </div>
      {run.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(run.error)}</p> : null}
      {result ? (
        <div className="mt-2 space-y-2 text-sm">
          <p className="text-xs text-slate-500">
            AI status: {result.status}
            {result.output.suggestedClassification ? ` · suggested: ${result.output.suggestedClassification}` : ""}
            {(result.output.droppedInventedIds ?? 0) > 0 ? ` · ${result.output.droppedInventedIds} invented reference(s) rejected` : ""}
          </p>
          {result.output.note ? <p className="text-xs text-slate-500">{result.output.note}</p> : null}
          {result.output.links.filter((l) => !dismissed.includes(l.requirementId)).map((l) => (
            <div key={l.requirementId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span>
                <Badge>AI</Badge> {keyById.get(l.requirementId)?.stableKey ?? l.requirementId}
                {" "}({Math.round(l.confidence * 100)}%): {l.explanation}
              </span>
              <span className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={accept.isPending} onClick={() => accept.mutate(l.requirementId)}>Accept link</Button>
                <Button size="sm" variant="ghost" onClick={() => setDismissed([...dismissed, l.requirementId])}>Dismiss</Button>
              </span>
            </div>
          ))}
          {result.output.missingContext.length > 0 ? (
            <p className="text-xs text-slate-500">Missing context: {result.output.missingContext.join(" · ")}</p>
          ) : null}
          <div>
            <p className="text-xs font-medium text-slate-500">Deterministic matches (always shown)</p>
            {result.deterministic.length === 0 ? <p className="text-xs">No overlapping requirements found.</p> : (
              <ul className="text-xs text-slate-600">
                {result.deterministic.map((d) => <li key={d.stableKey}>{d.stableKey} (score {d.score}): {d.explanation}</li>)}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiAssistPanel({ changeId, onDone }: { changeId: string; onDone: () => void }): JSX.Element {
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
        <p className="text-sm font-medium">AI assistance</p>
        <Button size="sm" variant="secondary" disabled={clarify.isPending} onClick={() => clarify.mutate()}>
          {clarify.isPending ? "Thinking…" : "Suggest questions"}
        </Button>
        <Button size="sm" variant="secondary" disabled={proposal.isPending} onClick={() => proposal.mutate()}>
          {proposal.isPending ? "Drafting…" : "Draft proposal"}
        </Button>
      </div>
      <p className="mt-1 text-xs text-slate-500">Suggestions only — nothing is sent or published automatically.</p>
      {clarify.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(clarify.error)}</p> : null}
      {proposal.isError ? <p className="mt-2 text-sm text-red-700">{errorMessage(proposal.error)}</p> : null}
      {questions ? (
        <ul className="mt-2 space-y-1 text-sm">
          {questions.map((q) => (
            <li key={q} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span>{q}</span>
              <Button size="sm" variant="secondary" disabled={useQuestion.isPending} onClick={() => useQuestion.mutate(q)}>Use as question</Button>
            </li>
          ))}
        </ul>
      ) : null}
      {draft ? (
        <div className="mt-2 rounded-md border border-slate-200 bg-white p-2">
          <Textarea aria-label="Proposal draft (editable)" rows={6} value={draftText} onChange={(e) => setDraftText(e.target.value)} />
          {draft.bullets.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">{draft.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
          ) : null}
          {draft.nextSteps ? <p className="mt-1 text-xs text-slate-600">Next: {draft.nextSteps}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ExportButton({ projectId, changeId }: { projectId: string; changeId: string }): JSX.Element {
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
      Download summary (JSON)
    </Button>
  );
}

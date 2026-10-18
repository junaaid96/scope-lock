import { useState } from "react";
import { useLocale } from "../lib/i18n/index.js";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { ChangeListItem, ProjectDetail } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { ChangeBoard } from "../components/change-board.js";
import { ContractTab } from "../components/contract.js";
import { EstimateVsActual } from "../components/actuals.js";
import { AllowanceTab } from "../components/allowance.js";
import { IntakeTab } from "../components/intake.js";
import { PolicyTab } from "../components/policy.js";
import { IntegrationsTab } from "../components/github.js";
import { ScopeCheckPanel, type ScopeMatch } from "../components/scope-check.js";
import { ImportDialog } from "../components/import.js";

import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Tabs, Textarea, formatMoney, statusTone, PageSkeleton, SkeletonCards } from "../components/ui.js";
import { uploadFile } from "../components/upload.js";

export function ProjectPage(): JSX.Element {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
  const changes = useQuery({
    queryKey: ["changes", id],
    queryFn: () => fetchAll<ChangeListItem>(`/projects/${id}/change-requests`),
  });
  const [showChange, setShowChange] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [parkedOnly, setParkedOnly] = useState(false);
  const [tab, setTab] = useState<"changes" | "board" | "contract" | "allowance" | "actuals" | "intake" | "policy" | "integrations" | "members" | "bundles" | "notes">("changes");

  if (project.isLoading) return <PageSkeleton />;
  if (project.isError || !project.data) return <ErrorBanner message={errorMessage(project.error)} />;
  const p = project.data;
  const canManage = p.myRole === "LEAD" || p.myRole === null; // org admins see null role but can manage

  return (
    <div>
      <PageTitle
        title={p.name}
        subtitle={t("project.subtitle", { client: p.client?.name ?? t("project.noClient"), currency: p.currency, baseline: p.counts.publishedSequence ? t("project.baselineVersion", { seq: p.counts.publishedSequence }) : t("project.noneYet") })}
        actions={
          <>
            {canManage ? <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>{t("project.editProject")}</Button> : null}
            <Button variant="secondary" size="sm" onClick={() => setShowImport(true)}>{t("project.importFromText")}</Button>
            <Button size="sm" onClick={() => setShowChange(true)}>{t("project.newChangeRequest")}</Button>
          </>
        }
      />
      <ProjectSubnav projectId={p.id} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">{t("project.openChanges", { count: p.counts.openChanges })}</span>
        <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">{t("project.awaitingDecision", { count: p.counts.pendingApprovals })}</span>
        {p.budgetMinor ? <span className="rounded-full bg-surface px-3 py-1 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">{t("project.budget", { amount: formatMoney(p.budgetMinor, p.currency) })}</span> : null}
      </div>

      <Tabs
        label={t("project.sectionsLabel")}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "changes" as const, label: t("project.tabChanges", { count: (changes.data ?? []).length }) },
          { id: "board" as const, label: t("project.tabBoard") },
          { id: "contract" as const, label: t("project.tabContract") },
          { id: "allowance" as const, label: t("project.tabAllowance") },
          { id: "actuals" as const, label: t("project.tabActuals") },
          ...(canManage ? [{ id: "intake" as const, label: t("project.tabIntake") }] : []),
          ...(canManage ? [{ id: "policy" as const, label: t("project.tabPolicy") }] : []),
          { id: "integrations" as const, label: t("project.tabIntegrations") },
          { id: "members" as const, label: t("project.tabMembers") },
          { id: "bundles" as const, label: t("project.tabBundles") },
          { id: "notes" as const, label: t("project.tabNotes") },
        ]}
      />

      {tab === "changes" ? (
        changes.isLoading ? <SkeletonCards count={3} /> : (changes.data ?? []).length === 0 ? (
          <Empty title={t("project.noChanges")} hint={t("project.noChangesHint")} />
        ) : (
          <div>
            {(changes.data ?? []).some((c) => c.status === "PARKED") ? (
              <div className="mb-3 flex items-center gap-2 text-sm">
                <Button size="sm" variant={parkedOnly ? "primary" : "secondary"} onClick={() => setParkedOnly((v) => !v)} aria-pressed={parkedOnly}>
                  {t("project.parked", { count: (changes.data ?? []).filter((c) => c.status === "PARKED").length })}
                </Button>
                {parkedOnly ? <span className="text-slate-600">{t("project.shelvedHint")}</span> : null}
              </div>
            ) : null}
            <ul className="space-y-3">
              {(changes.data ?? []).filter((c) => !parkedOnly || c.status === "PARKED").map((c) => (
              <li key={c.id}>
                <Link to={`/projects/${p.id}/changes/${c.id}`} className="lift block rounded-xl border border-slate-200 bg-surface p-4 shadow-card hover:border-teal-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{c.number}: {c.title}</span>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
                    {c.classification ? <span>{c.classification}</span> : null}
                    {c.impact?.priceMinor !== null && c.impact?.priceMinor !== undefined ? (
                      <span className="font-medium tabular-nums text-slate-800">{formatMoney(c.impact.priceMinor, c.impact.currency ?? p.currency)}</span>
                    ) : null}
                    <span>{c.linkCount === 1 ? t("project.linkOne", { count: c.linkCount }) : t("project.links", { count: c.linkCount })}</span>
                  </div>
                </Link>
              </li>
            ))}
            </ul>
          </div>
        )
      ) : null}
      {tab === "board" ? <ChangeBoard projectId={p.id} changes={changes.data ?? []} loading={changes.isLoading} /> : null}
      {tab === "contract" ? <ContractTab projectId={p.id} /> : null}
      {tab === "allowance" ? <AllowanceTab projectId={p.id} currency={p.currency} myRole={p.myRole} canManage={canManage} /> : null}
      {tab === "actuals" ? <EstimateVsActual projectId={p.id} /> : null}
      {tab === "intake" && canManage ? <IntakeTab projectId={p.id} /> : null}
      {tab === "policy" && canManage ? <PolicyTab project={p} /> : null}
      {tab === "integrations" ? <IntegrationsTab project={p} canManage={canManage} /> : null}
      {tab === "members" ? <MembersTab projectId={p.id} canManage={canManage} /> : null}
      {tab === "bundles" ? <BundlesTab projectId={p.id} canManage={canManage} /> : null}
      {tab === "notes" ? <NotesTab projectId={p.id} /> : null}
      {showChange ? <ChangeDialog projectId={p.id} onClose={() => setShowChange(false)} /> : null}
      {showImport ? <ImportDialog projectId={p.id} onClose={() => setShowImport(false)} /> : null}
      {showEdit ? <ProjectEditDialog project={p} onClose={() => setShowEdit(false)} /> : null}
    </div>
  );
}

function ChangeDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const { register, handleSubmit, formState, watch } = useForm<{ title: string; description: string; source: string }>({
    defaultValues: { source: "CLIENT" },
  });
  const save = useMutation({
    mutationFn: async (v: { title: string; description: string; source: string }) => {
      const created = await api.post<{ id: string }>(`/projects/${projectId}/change-requests`, {
        ...v,
        suggestedRequirementIds: suggestedIds,
      });
      // Attach selected files to the new request (best effort after create).
      if (files.length > 0) {
        setUploading(true);
        try {
          for (const file of files) await uploadFile(projectId, file, { linkedType: "CHANGE", linkedId: created.id });
        } finally {
          setUploading(false);
        }
      }
      return created;
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["changes", projectId] });
      void client.invalidateQueries({ queryKey: ["project", projectId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("project.newChangeRequest")} onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("project.titleLabel")} error={formState.errors.title?.message} htmlFor="change-title">
          <Input id="change-title" {...register("title", { required: t("project.titleRequired") })} />
        </Field>
        <Field label={t("project.descriptionLabel")} error={formState.errors.description?.message} htmlFor="change-description">
          <Textarea id="change-description" rows={4} {...register("description", { required: t("project.descriptionRequired") })} />
        </Field>
        <ScopeCheckPanel
          title={watch("title") ?? ""}
          description={watch("description") ?? ""}
          onMatches={setSuggestedIds}
          onCheck={async (title, desc) => {
            const res = await api.post<{ deterministic: ScopeMatch[]; analysis: { status: string; output?: { links?: unknown[] } } }>(
              `/projects/${projectId}/ai/scope-check`,
              { title, description: desc },
            );
            const aiLinks = res.analysis.status === "SUCCEEDED" ? (res.analysis.output?.links ?? []) : [];
            return {
              deterministic: res.deterministic,
              aiNote: res.analysis.status === "SUCCEEDED" ? t("project.aiRefinementAgrees", { count: aiLinks.length }) : null,
            };
          }}
        />
        <Field label={t("project.sourceLabel")} htmlFor="change-source">
          <Select id="change-source" {...register("source")}>
            <option value="CLIENT">{t("project.sourceClient")}</option>
            <option value="AGENCY">{t("project.sourceAgency")}</option>
          </Select>
        </Field>
        <Field label={t("project.attachmentsLabel")} htmlFor="change-files" hint={t("project.attachmentsHint")}>
          <Input
            id="change-files"
            type="file"
            multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </Field>
        {files.length > 0 ? <p className="text-xs text-slate-500">{t("project.filesWillAttach", { count: files.length })}</p> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending || uploading} className="w-full">
          {uploading ? t("project.attachingFiles") : t("project.createAsDraft")}
        </Button>
      </form>
    </Dialog>
  );
}

const PROJECT_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function ProjectEditDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{
    name: string; status: string; startDate: string; targetDate: string; budget: string;
  }>({
    defaultValues: {
      name: project.name,
      status: project.status,
      startDate: project.startDate ? project.startDate.slice(0, 10) : "",
      targetDate: project.targetDate ? project.targetDate.slice(0, 10) : "",
      budget: project.budgetMinor !== null && project.budgetMinor !== undefined ? String(project.budgetMinor / 100) : "",
    },
  });
  const save = useMutation({
    mutationFn: (v: { name: string; status: string; startDate: string; targetDate: string; budget: string }) =>
      api.patch(`/projects/${project.id}`, {
        name: v.name,
        status: v.status,
        startDate: v.startDate ? new Date(v.startDate).toISOString() : null,
        targetDate: v.targetDate ? new Date(v.targetDate).toISOString() : null,
        budgetMinor: v.budget === "" ? null : Math.round(Number(v.budget) * 100),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["project", project.id] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("project.editProject")} onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("project.projectName")} htmlFor="pe-name">
          <Input id="pe-name" {...register("name")} />
        </Field>
        <Field label={t("project.statusLabel")} htmlFor="pe-status">
          <Select id="pe-status" {...register("status")}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("project.startDate")} htmlFor="pe-start">
            <Input id="pe-start" type="date" {...register("startDate")} />
          </Field>
          <Field label={t("project.targetDate")} htmlFor="pe-target">
            <Input id="pe-target" type="date" {...register("targetDate")} />
          </Field>
        </div>
        <Field label={t("project.budgetCurrency", { currency: project.currency })} htmlFor="pe-budget">
          <Input id="pe-budget" inputMode="decimal" placeholder={t("project.budgetPlaceholder")} {...register("budget")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("project.saveProject")}</Button>
      </form>
    </Dialog>
  );
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  user: { name: string; email: string } | null;
}

function MembersTab({ projectId, canManage }: { projectId: string; canManage: boolean }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => fetchAll<MemberRow>(`/projects/${projectId}/members`) });
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("CLIENT_VIEWER");
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/members`, { email, role }),
    onSuccess: () => {
      setEmail("");
      setError(null);
      void client.invalidateQueries({ queryKey: ["members", projectId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.delete(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["members", projectId] }),
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card>
      {members.isLoading ? <Spinner /> : (
        <ul className="divide-y divide-slate-100">
          {(members.data ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span>{m.user?.name ?? m.userId} <span className="text-slate-500">({m.user?.email})</span></span>
              <span className="flex items-center gap-2">
                <Badge>{m.role}</Badge>
                {canManage ? (
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)}>{t("project.remove")}</Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canManage ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <div className="min-w-52 flex-1">
            <Field label={t("project.memberEmailLabel")} htmlFor="member-email">
              <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          </div>
          <div>
            <Field label={t("project.roleLabel")} htmlFor="member-role">
              <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="LEAD">LEAD</option>
                <option value="MEMBER">MEMBER</option>
                <option value="CLIENT_ADMIN">CLIENT_ADMIN</option>
                <option value="CLIENT_APPROVER">CLIENT_APPROVER</option>
                <option value="CLIENT_VIEWER">CLIENT_VIEWER</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={add.isPending}>{t("project.addMember")}</Button>
        </form>
      ) : null}
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
    </Card>
  );
}

interface BundleRow {
  id: string;
  name: string;
  status: string;
  adjustmentMinor: number;
  members: Array<{ id: string; number: string; title: string }>;
  combined: { priceMinor: number | null; currency: string | null; missingImpact: string[] };
  sendBlockers: string[];
}

function BundlesTab({ projectId, canManage }: { projectId: string; canManage: boolean }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const bundles = useQuery({ queryKey: ["bundles", projectId], queryFn: () => fetchAll<BundleRow>(`/projects/${projectId}/bundles`) });
  const changes = useQuery({ queryKey: ["changes", projectId], queryFn: () => fetchAll<ChangeListItem>(`/projects/${projectId}/change-requests`) });
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [expiry, setExpiry] = useState("");
  const create = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/bundles`, { name, changeRequestIds: selected }),
    onSuccess: () => {
      setName("");
      setSelected([]);
      setError(null);
      void client.invalidateQueries({ queryKey: ["bundles", projectId] });
      void client.invalidateQueries({ queryKey: ["changes", projectId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      {(bundles.data ?? []).map((b) => (
        <Card key={b.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{b.name}</span>
            <Badge tone={statusTone(b.status)}>{b.status}</Badge>
          </div>
          <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
            {b.members.map((m) => (
              <li key={m.id}><Link className="underline" to={`/projects/${projectId}/changes/${m.id}`}>{m.number}: {m.title}</Link></li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-slate-600">
            {t("project.combined", { amount: formatMoney(b.combined.priceMinor, b.combined.currency ?? "USD") })}
            {b.combined.missingImpact.length > 0 ? t("project.missingImpact", { items: b.combined.missingImpact.join(", ") }) : ""}
          </p>
          {b.sendBlockers.length > 0 ? (
            <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{b.sendBlockers.map((s) => <li key={s}>{s}</li>)}</ul>
          ) : null}
          {canManage && b.status === "DRAFT" ? (
            <div className="mt-3">
              {sending === b.id ? (
                <SendBundleForm
                  projectId={projectId}
                  bundleId={b.id}
                  expiry={expiry}
                  setExpiry={setExpiry}
                  onDone={() => {
                    setSending(null);
                    void client.invalidateQueries({ queryKey: ["bundles", projectId] });
                  }}
                />
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setSending(b.id)}>{t("project.sendForApproval")}</Button>
              )}
            </div>
          ) : null}
        </Card>
      ))}
      {canManage ? (
        <Card>
          <h3 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("project.newBundle")}</h3>
          <div className="space-y-3">
            <Field label={t("project.bundleName")} htmlFor="bundle-name">
              <Input id="bundle-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <fieldset>
              <legend className="text-sm font-medium">{t("project.bundleMembersLegend")}</legend>
              {(changes.data ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(c.id)}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, c.id] : selected.filter((s) => s !== c.id))}
                  />
                  {c.number}: {c.title} ({c.status})
                </label>
              ))}
            </fieldset>
            {error ? <ErrorBanner message={error} /> : null}
            <Button size="sm" disabled={create.isPending || !name || selected.length === 0} onClick={() => create.mutate()}>
              {t("project.createBundle")}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SendBundleForm({ projectId, bundleId, expiry, setExpiry, onDone }: { projectId: string; bundleId: string; expiry: string; setExpiry: (v: string) => void; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => fetchAll<MemberRow>(`/projects/${projectId}/members`) });
  const [approvers, setApprovers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<string[] | null>(null);
  const [policyMode, setPolicyMode] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api.post<{ approval: { id: string }; reviewUrls?: string[] }>(`/bundles/${bundleId}/approval-requests`, {
        approverUserIds: approvers,
        expiresAt: new Date(expiry).toISOString(),
        ...(policyMode ? { policyMode } : {}),
      }),
    onSuccess: (res) => {
      setLinks(res.reviewUrls ?? []);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-medium">{t("project.approvers")}</p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name} ({m.role})
        </label>
      ))}
      <Field
        label={t("project.decisionRule")}
        htmlFor={`bundle-policy-${bundleId}`}
        hint={t("project.decisionRuleHint")}
      >
        <select id={`bundle-policy-${bundleId}`} value={policyMode} onChange={(e) => setPolicyMode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="">{t("project.projectDefault")}</option>
          <option value="ANY">{t("policy.modeANY")}</option>
          <option value="ALL">{t("policy.modeALL")}</option>
          <option value="SEQUENTIAL">{t("policy.modeSEQUENTIAL")}</option>
        </select>
      </Field>
      <Field label={t("project.expiresAt")} htmlFor={`bundle-expiry-${bundleId}`}>
        <Input id={`bundle-expiry-${bundleId}`} type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </Field>
      {error ? <ErrorBanner message={error} /> : null}
      {links ? (
        <ul className="text-sm">{links.map((l) => <li key={l}><a className="underline" href={l}>{l}</a></li>)}</ul>
      ) : (
        <Button size="sm" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>{t("project.sendBundle")}</Button>
      )}
    </div>
  );
}

interface NoteRow {
  id: string;
  targetType: string;
  body: string;
  authorId: string;
  createdAt: string;
  editHistory?: Array<{ body: string; editedAt: string }>;
}

function NotesTab({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const notes = useQuery({ queryKey: ["notes", projectId], queryFn: () => fetchAll<NoteRow>(`/projects/${projectId}/decision-notes`) });
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.post(`/projects/${projectId}/decision-notes`, { targetType: "PROJECT", targetId: projectId, body }),
    onSuccess: () => {
      setBody("");
      void client.invalidateQueries({ queryKey: ["notes", projectId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const update = useMutation({
    mutationFn: (vars: { id: string; note: string }) => api.patch(`/decision-notes/${vars.id}`, { body: vars.note }),
    onSuccess: () => {
      setEditingId(null);
      void client.invalidateQueries({ queryKey: ["notes", projectId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Card>
      <ul className="space-y-3">
        {(notes.data ?? []).map((n) => (
          <li key={n.id} className="rounded-md bg-slate-50 p-3 text-sm">
            {editingId === n.id ? (
              <div className="space-y-2">
                <Textarea aria-label={t("project.editNoteLabel")} rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <span className="flex gap-2">
                  <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: n.id, note: editBody })}>{t("project.save")}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>{t("project.cancel")}</Button>
                </span>
              </div>
            ) : (
              <>
                <p className="text-slate-900">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {n.targetType} · {new Date(n.createdAt).toLocaleString()}
                  {(n.editHistory ?? []).length > 0 ? t("project.editedCount", { count: (n.editHistory ?? []).length }) : ""}
                  {" · "}<button type="button" className="underline" onClick={() => { setEditingId(n.id); setEditBody(n.body); }}>{t("project.edit")}</button>
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
      {(notes.data ?? []).length === 0 ? <Empty title={t("project.noNotes")} /> : null}
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label={t("project.recordRationale")} htmlFor="note-body">
          <Textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button size="sm" type="submit" disabled={save.isPending}>{t("project.saveNote")}</Button>
      </form>
    </Card>
  );
}

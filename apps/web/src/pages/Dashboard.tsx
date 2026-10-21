import { useState } from "react";
import { useLocale } from "../lib/i18n/index.js";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { useSession } from "../lib/auth.js";
import type { Client, ProjectListItem } from "../lib/types.js";
import { Button, Card, ConfirmButton, Dialog, Empty, ErrorBanner, Field, ICONS, Icon, Input, PageTitle, Select, Skeleton, SkeletonCards, Spinner, StatusBadge, Textarea, cn, formatStatus, PageSkeleton } from "../components/ui.js";
import { OrgContractStrip } from "../components/contract.js";
import { MemorySearchPanel } from "../components/memory.js";

export function DashboardPage(): JSX.Element {
  const { t } = useLocale();
  const { session } = useSession();
  const [orgId, setOrgId] = useState<string | null>(null);
  const activeOrg = session?.organizations.find((o) => o.id === orgId) ?? session?.organizations[0] ?? null;

  const projects = useQuery({
    queryKey: ["projects", activeOrg?.id],
    queryFn: () => fetchAll<ProjectListItem>(`/projects?organizationId=${activeOrg?.id}`),
    enabled: Boolean(activeOrg),
  });
  const clients = useQuery({
    queryKey: ["clients", activeOrg?.id],
    queryFn: () => fetchAll<Client>(`/clients?organizationId=${activeOrg?.id}`),
    enabled: Boolean(activeOrg),
  });

  // Deep-linkable dialogs for the command palette (`/?create=project|client`).
  const [params, setParams] = useSearchParams();
  const [showClient, setShowClient] = useState(params.get("create") === "client");
  const [showProject, setShowProject] = useState(params.get("create") === "project");
  const closeDialogs = (): void => {
    setShowClient(false);
    setShowProject(false);
    void setParams({}, { replace: true });
  };

  if (!session) return <PageSkeleton />;
  if (!activeOrg) return <Empty title={t("dashboard.noOrgs")} hint={t("dashboard.noOrgsHint")} />;

  return (
    <div>
      <PageTitle
        title={t("dashboard.title")}
        subtitle={t("dashboard.subtitle", { name: activeOrg.name, role: activeOrg.role ? formatStatus(activeOrg.role) : "" })}
        actions={
          <>
            <Select aria-label={t("dashboard.orgSelectLabel")} value={activeOrg.id} onChange={(e) => setOrgId(e.target.value)} className="w-auto">
              {session.organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
            <Link to={`/orgs/${activeOrg.id}/settings`}>
              <Button variant="secondary" size="sm">{t("dashboard.workspaceSettings")}</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => setShowClient(true)}>{t("dashboard.newClient")}</Button>
            <Button size="sm" onClick={() => setShowProject(true)}>{t("dashboard.newProject")}</Button>
          </>
        }
      />
      <StatRow projects={projects.data ?? []} loading={projects.isLoading} />
      <OrgContractStrip organizationId={activeOrg.id} />
      <MemorySearchPanel organizationId={activeOrg.id} />
      {projects.isLoading ? (
        <div className="mt-6"><SkeletonCards count={3} /></div>
      ) : projects.isError ? (
        <ErrorBanner message={errorMessage(projects.error)} />
      ) : (projects.data ?? []).length === 0 ? (
        <Empty
          title={t("dashboard.noProjects")}
          hint={t("dashboard.noProjectsHint")}
          action={<Button onClick={() => setShowProject(true)}>{t("dashboard.newProject")}</Button>}
        />
      ) : (
        <ProjectGroups projects={projects.data ?? []} clients={clients.data ?? []} />
      )}
      <ClientsCard orgId={activeOrg.id} clients={clients.data ?? []} loading={clients.isLoading} />
      {showClient && activeOrg ? <ClientDialog orgId={activeOrg.id} onClose={closeDialogs} /> : null}
      {showProject && activeOrg ? (
        <ProjectDialog orgId={activeOrg.id} clients={clients.data ?? []} onClose={closeDialogs} />
      ) : null}
    </div>
  );
}

function StatRow({ projects, loading }: { projects: ProjectListItem[]; loading: boolean }): JSX.Element {
  const { t, number } = useLocale();
  const sum = (pick: (p: ProjectListItem) => number): number => projects.reduce((n, p) => n + pick(p), 0);
  const stats = [
    { label: t("dashboard.statProjects"), value: projects.length, icon: ICONS.folder, tone: "text-teal-700 bg-teal-50 ring-teal-200/70" },
    { label: t("dashboard.statOpen"), value: sum((p) => p.openChanges), icon: ICONS.git, tone: "text-sky-700 bg-sky-50 ring-sky-200/70" },
    { label: t("dashboard.statAwaiting"), value: sum((p) => p.pendingApprovals), icon: ICONS.clock, tone: "text-amber-700 bg-amber-50 ring-amber-200/70" },
    { label: t("dashboard.statMine"), value: sum((p) => p.myInbox), icon: ICONS.inbox, tone: "text-emerald-700 bg-emerald-50 ring-emerald-200/70" },
  ];
  return (
    <dl className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="lift grid grid-cols-[auto_1fr] items-center gap-x-3 rounded-xl border border-slate-200 bg-surface p-4 shadow-card">
          <span aria-hidden="true" className={cn("row-span-2 flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset", s.tone)}>
            <Icon d={s.icon} className="size-5" />
          </span>
          <dt className="min-w-0 truncate text-xs font-medium text-slate-500">{s.label}</dt>
          <dd className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">
            {loading ? <Skeleton className="mt-1 h-6 w-10" /> : number(s.value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Projects grouped under their client, so a full workspace stays scannable. */
function ProjectGroups({ projects, clients }: { projects: ProjectListItem[]; clients: Client[] }): JSX.Element {
  const { t } = useLocale();
  const nameOf = new Map(
    clients.map((c) => [
      c.id,
      c.company && c.company.toLowerCase() !== c.name.toLowerCase() ? `${c.name} · ${c.company}` : c.name,
    ]),
  );
  const groups = new Map<string, ProjectListItem[]>();
  for (const p of projects) {
    const key = p.clientId;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    (nameOf.get(a[0]) ?? t("dashboard.other")).localeCompare(nameOf.get(b[0]) ?? t("dashboard.other")),
  );
  return (
    <div className="space-y-6">
      {ordered.map(([clientId, items]) => (
        <section key={clientId} aria-label={nameOf.get(clientId) ?? t("dashboard.other")}>
          <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
            {nameOf.get(clientId) ?? t("dashboard.other")}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="lift group block h-full rounded-xl border border-slate-200 bg-surface p-5 shadow-card hover:border-teal-600">
                  <div className="flex items-start gap-3">
                    <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-teal-50 to-sky-50 text-sm font-semibold text-link-strong ring-1 ring-inset ring-teal-200/70">
                      {p.name.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="truncate text-base font-semibold text-slate-900">{p.name}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      {p.openChanges > 0 || p.pendingApprovals > 0 ? (
                        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
                          {p.openChanges > 0 ? (
                            <span>{p.openChanges === 1 ? t("dashboard.openChangeOne", { count: p.openChanges }) : t("dashboard.openChanges", { count: p.openChanges })}</span>
                          ) : null}
                          {p.pendingApprovals > 0 ? <span>{t("dashboard.awaitingDecision", { count: p.pendingApprovals })}</span> : null}
                        </div>
                      ) : null}
                      {p.myInbox > 0 ? <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-link-strong ring-1 ring-inset ring-teal-200/70">{p.myInbox === 1 ? t("dashboard.needDecisionOne", { count: p.myInbox }) : t("dashboard.needDecisionOther", { count: p.myInbox })}</p> : null}
                    </div>
                    <Icon d={ICONS.chevron} className="mt-1 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-600" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ClientDialog({ orgId, onClose }: { orgId: string; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ name: string; company?: string }>();
  const save = useMutation({
    mutationFn: (values: { name: string; company?: string }) => api.post("/clients", { organizationId: orgId, ...values }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["clients", orgId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("dashboard.newClientTitle")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("dashboard.clientName")} error={formState.errors.name?.message} htmlFor="client-name">
          <Input id="client-name" {...register("name", { required: t("dashboard.nameRequired") })} />
        </Field>
        <Field label={t("dashboard.companyOptional")} htmlFor="client-company">
          <Input id="client-company" {...register("company")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" loading={save.isPending} className="w-full">{t("dashboard.createClient")}</Button>
      </form>
    </Dialog>
  );
}

function ClientsCard({ orgId, clients, loading }: { orgId: string; clients: Client[]; loading: boolean }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [editing, setEditing] = useState<Client | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/${id}`),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["clients", orgId] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Card className="mt-6">
      <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("dashboard.clients")}</h2>
      {loading ? <Spinner /> : clients.length === 0 ? (
        <Empty title={t("dashboard.noClients")} hint={t("dashboard.noClientsHint")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {clients.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{c.name}</span>
                {c.company ? <span className="text-slate-500"> · {c.company}</span> : null}
                {c.notes ? <span className="block text-xs text-slate-500">{c.notes}</span> : null}
              </span>
              <span className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>{t("dashboard.edit")}</Button>
                <ConfirmButton
                  label={t("dashboard.delete")}
                  confirmLabel={t("dashboard.confirmDelete")}
                  cancelLabel={t("common.cancel")}
                  pending={remove.isPending}
                  onConfirm={() => remove.mutate(c.id)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {editing ? <ClientEditDialog orgId={orgId} existing={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function ClientEditDialog({ orgId, existing, onClose }: { orgId: string; existing: Client; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{ name: string; company: string; notes: string }>({
    defaultValues: { name: existing.name, company: existing.company ?? "", notes: existing.notes ?? "" },
  });
  const save = useMutation({
    mutationFn: (v: { name: string; company: string; notes: string }) =>
      api.patch(`/clients/${existing.id}`, { name: v.name, company: v.company || undefined, notes: v.notes || undefined }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["clients", orgId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("dashboard.editClient")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("dashboard.clientName")} htmlFor="client-edit-name">
          <Input id="client-edit-name" {...register("name")} />
        </Field>
        <Field label={t("dashboard.company")} htmlFor="client-edit-company">
          <Input id="client-edit-company" {...register("company")} />
        </Field>
        <Field label={t("dashboard.notes")} htmlFor="client-edit-notes">
          <Textarea id="client-edit-notes" rows={3} {...register("notes")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" loading={save.isPending} className="w-full">{t("dashboard.saveClient")}</Button>
      </form>
    </Dialog>
  );
}

const COMMON_CURRENCIES = ["USD", "EUR", "GBP", "BDT", "INR", "CAD", "AUD", "SGD", "AED", "SAR"] as const;

function ProjectDialog({ orgId, clients, onClose }: { orgId: string; clients: Client[]; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState, watch } = useForm<{ clientId: string; name: string; currency: string; customCurrency: string; startDate: string; targetDate: string; budget: string }>({
    defaultValues: { currency: "USD", customCurrency: "" },
  });
  const currencyChoice = watch("currency");
  const save = useMutation({
    mutationFn: (values: { clientId: string; name: string; currency: string; customCurrency: string; startDate: string; targetDate: string; budget: string }) =>
      api.post("/projects", {
        organizationId: orgId,
        clientId: values.clientId,
        name: values.name,
        currency: values.currency === "OTHER" ? values.customCurrency.trim().toUpperCase() : values.currency,
        ...(values.startDate ? { startDate: new Date(values.startDate).toISOString() } : {}),
        ...(values.targetDate ? { targetDate: new Date(values.targetDate).toISOString() } : {}),
        ...(values.budget !== "" ? { budgetMinor: Math.round(Number(values.budget) * 100) } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["projects", orgId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("dashboard.newProjectTitle")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label={t("dashboard.client")} error={formState.errors.clientId?.message} htmlFor="project-client">
          <Select id="project-client" {...register("clientId", { required: t("dashboard.clientRequired") })}>
            <option value="">{t("dashboard.selectClient")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("dashboard.projectName")} error={formState.errors.name?.message} htmlFor="project-name">
          <Input id="project-name" placeholder={t("dashboard.projectNamePlaceholder")} {...register("name", { required: t("dashboard.nameRequired") })} />
        </Field>
        <Field label={t("dashboard.currency")} hint={t("dashboard.currencyHint")} htmlFor="project-currency">
          <Select id="project-currency" {...register("currency", { required: true })}>
            {COMMON_CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
            <option value="OTHER">{t("dashboard.customCurrency")}…</option>
          </Select>
        </Field>
        {currencyChoice === "OTHER" ? (
          <Field label={t("dashboard.customCurrency")} error={formState.errors.customCurrency?.message} htmlFor="project-currency-custom">
            <Input
              id="project-currency-custom"
              maxLength={3}
              placeholder="USD"
              {...register("customCurrency", {
                required: t("dashboard.nameRequired"),
                pattern: { value: /^[A-Za-z]{3}$/, message: t("dashboard.currencyHint") },
              })}
            />
          </Field>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("dashboard.startDate")} htmlFor="project-start">
            <Input id="project-start" type="date" {...register("startDate")} />
          </Field>
          <Field label={t("dashboard.targetDate")} htmlFor="project-target">
            <Input id="project-target" type="date" {...register("targetDate")} />
          </Field>
        </div>
        <Field label={t("dashboard.budgetLabel")} error={formState.errors.budget?.message} htmlFor="project-budget">
          <Input
            id="project-budget"
            inputMode="decimal"
            placeholder={t("dashboard.budgetPlaceholder")}
            {...register("budget", {
              validate: (v) => v.trim() === "" || !Number.isNaN(Number(v)) || t("dashboard.budgetNumberError"),
            })}
          />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" loading={save.isPending} className="w-full">{t("dashboard.createProject")}</Button>
      </form>
    </Dialog>
  );
}

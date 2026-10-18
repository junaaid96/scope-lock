import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { useSession } from "../lib/auth.js";
import type { Client, ProjectListItem } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Textarea, statusTone } from "../components/ui.js";
import { OrgContractStrip } from "../components/contract.js";

export function DashboardPage(): JSX.Element {
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

  if (!session) return <Spinner />;
  if (!activeOrg) return <Empty title="No organizations yet" hint="Create one to get started." />;

  return (
    <div>
      <PageTitle
        title="Projects"
        subtitle={`${activeOrg.name} · your role: ${activeOrg.role}`}
        actions={
          <>
            <Select aria-label="Organization" value={activeOrg.id} onChange={(e) => setOrgId(e.target.value)} className="w-auto">
              {session.organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </Select>
            <Link to={`/orgs/${activeOrg.id}/settings`}>
              <Button variant="secondary" size="sm">Workspace settings</Button>
            </Link>
            <Button variant="secondary" size="sm" onClick={() => setShowClient(true)}>New client</Button>
            <Button size="sm" onClick={() => setShowProject(true)}>New project</Button>
          </>
        }
      />
      <OrgContractStrip organizationId={activeOrg.id} />
      {projects.isLoading ? (
        <Spinner />
      ) : projects.isError ? (
        <ErrorBanner message={errorMessage(projects.error)} />
      ) : (projects.data ?? []).length === 0 ? (
        <Empty title="No projects yet" hint="Create a project for a client, then publish its first scope baseline." />
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

/** Projects grouped under their client, so a full workspace stays scannable. */
function ProjectGroups({ projects, clients }: { projects: ProjectListItem[]; clients: Client[] }): JSX.Element {
  const nameOf = new Map(clients.map((c) => [c.id, c.company ? `${c.name} · ${c.company}` : c.name]));
  const groups = new Map<string, ProjectListItem[]>();
  for (const p of projects) {
    const key = p.clientId;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    (nameOf.get(a[0]) ?? "Other").localeCompare(nameOf.get(b[0]) ?? "Other"),
  );
  return (
    <div className="space-y-6">
      {ordered.map(([clientId, items]) => (
        <section key={clientId} aria-label={nameOf.get(clientId) ?? "Other"}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            {nameOf.get(clientId) ?? "Other"}
          </h2>
          <ul className="space-y-3">
            {items.map((p) => (
              <li key={p.id}>
                <Link to={`/projects/${p.id}`} className="block rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition-colors hover:border-teal-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-semibold text-slate-900">{p.name}</span>
                    <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-600">
                    <span>{p.openChanges} open change{p.openChanges === 1 ? "" : "s"}</span>
                    <span>{p.pendingApprovals} awaiting decision</span>
                    {p.myInbox > 0 ? <span className="font-medium text-teal-800">{p.myInbox} need{p.myInbox === 1 ? "s" : ""} your decision</span> : null}
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
    <Dialog title="New client" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Client name" error={formState.errors.name?.message} htmlFor="client-name">
          <Input id="client-name" {...register("name", { required: "Name is required" })} />
        </Field>
        <Field label="Company (optional)" htmlFor="client-company">
          <Input id="client-company" {...register("company")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Create client</Button>
      </form>
    </Dialog>
  );
}

function ClientsCard({ orgId, clients, loading }: { orgId: string; clients: Client[]; loading: boolean }): JSX.Element {
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
      <h2 className="mb-2 font-medium">Clients</h2>
      {loading ? <Spinner /> : clients.length === 0 ? (
        <Empty title="No clients yet" hint="Add a client, then create projects under it." />
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
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete client ${c.name}? Clients with projects cannot be deleted.`)) remove.mutate(c.id);
                  }}
                >
                  Delete
                </Button>
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
    <Dialog title="Edit client" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Client name" htmlFor="client-edit-name">
          <Input id="client-edit-name" {...register("name")} />
        </Field>
        <Field label="Company" htmlFor="client-edit-company">
          <Input id="client-edit-company" {...register("company")} />
        </Field>
        <Field label="Notes" htmlFor="client-edit-notes">
          <Textarea id="client-edit-notes" rows={3} {...register("notes")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Save client</Button>
      </form>
    </Dialog>
  );
}

function ProjectDialog({ orgId, clients, onClose }: { orgId: string; clients: Client[]; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ clientId: string; name: string; currency: string; startDate: string; targetDate: string; budget: string }>({
    defaultValues: { currency: "USD" },
  });
  const save = useMutation({
    mutationFn: (values: { clientId: string; name: string; currency: string; startDate: string; targetDate: string; budget: string }) =>
      api.post("/projects", {
        organizationId: orgId,
        clientId: values.clientId,
        name: values.name,
        currency: values.currency,
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
    <Dialog title="New project" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Client" error={formState.errors.clientId?.message} htmlFor="project-client">
          <Select id="project-client" {...register("clientId", { required: "Client is required" })}>
            <option value="">Select a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Project name" error={formState.errors.name?.message} htmlFor="project-name">
          <Input id="project-name" placeholder="Website relaunch" {...register("name", { required: "Name is required" })} />
        </Field>
        <Field label="Currency" htmlFor="project-currency">
          <Input id="project-currency" maxLength={3} {...register("currency", { required: true, pattern: /^[A-Z]{3}$/ })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" htmlFor="project-start">
            <Input id="project-start" type="date" {...register("startDate")} />
          </Field>
          <Field label="Target date" htmlFor="project-target">
            <Input id="project-target" type="date" {...register("targetDate")} />
          </Field>
        </div>
        <Field label="Budget (major units)" htmlFor="project-budget">
          <Input id="project-budget" inputMode="decimal" placeholder="e.g. 12000.00" {...register("budget")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Create project</Button>
      </form>
    </Dialog>
  );
}

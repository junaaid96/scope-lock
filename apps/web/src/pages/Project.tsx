import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { ChangeListItem, ProjectDetail } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { ChangeBoard } from "../components/change-board.js";
import { ContractTab } from "../components/contract.js";

import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Tabs, Textarea, formatMoney, statusTone } from "../components/ui.js";
import { uploadFile } from "../components/upload.js";

export function ProjectPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const project = useQuery({ queryKey: ["project", id], queryFn: () => api.get<ProjectDetail>(`/projects/${id}`) });
  const changes = useQuery({
    queryKey: ["changes", id],
    queryFn: () => fetchAll<ChangeListItem>(`/projects/${id}/change-requests`),
  });
  const [showChange, setShowChange] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [tab, setTab] = useState<"changes" | "board" | "contract" | "members" | "bundles" | "notes">("changes");

  if (project.isLoading) return <Spinner />;
  if (project.isError || !project.data) return <ErrorBanner message={errorMessage(project.error)} />;
  const p = project.data;
  const canManage = p.myRole === "LEAD" || p.myRole === null; // org admins see null role but can manage

  return (
    <div>
      <PageTitle
        title={p.name}
        subtitle={`${p.client?.name ?? "No client"} · ${p.currency} · governing baseline: ${p.counts.publishedSequence ? `v${p.counts.publishedSequence}` : "none yet"}`}
        actions={
          <>
            {canManage ? <Button variant="secondary" size="sm" onClick={() => setShowEdit(true)}>Edit project</Button> : null}
            <Button size="sm" onClick={() => setShowChange(true)}>New change request</Button>
          </>
        }
      />
      <ProjectSubnav projectId={p.id} />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Badge tone={statusTone(p.status)}>{p.status}</Badge>
        <span className="text-sm text-slate-600">{p.counts.openChanges} open changes</span>
        <span className="text-sm text-slate-600">{p.counts.pendingApprovals} awaiting decision</span>
        {p.budgetMinor ? <span className="text-sm text-slate-600">Budget {formatMoney(p.budgetMinor, p.currency)}</span> : null}
      </div>

      <Tabs
        label="Project sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "changes" as const, label: `Changes (${(changes.data ?? []).length})` },
          { id: "board" as const, label: "Board" },
          { id: "contract" as const, label: "Contract" },
          { id: "members" as const, label: "Members" },
          { id: "bundles" as const, label: "Bundles" },
          { id: "notes" as const, label: "Notes" },
        ]}
      />

      {tab === "changes" ? (
        changes.isLoading ? <Spinner /> : (changes.data ?? []).length === 0 ? (
          <Empty title="No change requests" hint="When the client asks for something new, capture it here to assess it against the baseline." />
        ) : (
          <ul className="space-y-3">
            {(changes.data ?? []).map((c) => (
              <li key={c.id}>
                <Link to={`/projects/${p.id}/changes/${c.id}`} className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-teal-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-slate-900">{c.number}: {c.title}</span>
                    <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
                    {c.classification ? <span>{c.classification}</span> : null}
                    {c.impact?.priceMinor !== null && c.impact?.priceMinor !== undefined ? (
                      <span>{formatMoney(c.impact.priceMinor, c.impact.currency ?? p.currency)}</span>
                    ) : null}
                    <span>{c.linkCount} link{c.linkCount === 1 ? "" : "s"}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {tab === "board" ? <ChangeBoard projectId={p.id} changes={changes.data ?? []} loading={changes.isLoading} /> : null}
      {tab === "contract" ? <ContractTab projectId={p.id} /> : null}
      {tab === "members" ? <MembersTab projectId={p.id} canManage={canManage} /> : null}
      {tab === "bundles" ? <BundlesTab projectId={p.id} canManage={canManage} /> : null}
      {tab === "notes" ? <NotesTab projectId={p.id} /> : null}
      {showChange ? <ChangeDialog projectId={p.id} onClose={() => setShowChange(false)} /> : null}
      {showEdit ? <ProjectEditDialog project={p} onClose={() => setShowEdit(false)} /> : null}
    </div>
  );
}

function ChangeDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const { register, handleSubmit, formState } = useForm<{ title: string; description: string; source: string }>({
    defaultValues: { source: "CLIENT" },
  });
  const save = useMutation({
    mutationFn: async (v: { title: string; description: string; source: string }) => {
      const created = await api.post<{ id: string }>(`/projects/${projectId}/change-requests`, v);
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
    <Dialog title="New change request" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Title" error={formState.errors.title?.message} htmlFor="change-title">
          <Input id="change-title" {...register("title", { required: "Title is required" })} />
        </Field>
        <Field label="Description" error={formState.errors.description?.message} htmlFor="change-description">
          <Textarea id="change-description" rows={4} {...register("description", { required: "Description is required" })} />
        </Field>
        <Field label="Source" htmlFor="change-source">
          <Select id="change-source" {...register("source")}>
            <option value="CLIENT">Client</option>
            <option value="AGENCY">Agency</option>
          </Select>
        </Field>
        <Field label="Attachments (optional)" htmlFor="change-files" hint="Files are scanned before they become downloadable.">
          <Input
            id="change-files"
            type="file"
            multiple
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
          />
        </Field>
        {files.length > 0 ? <p className="text-xs text-slate-500">{files.length} file(s) will be attached after creation.</p> : null}
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending || uploading} className="w-full">
          {uploading ? "Attaching files…" : "Create as draft"}
        </Button>
      </form>
    </Dialog>
  );
}

const PROJECT_STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function ProjectEditDialog({ project, onClose }: { project: ProjectDetail; onClose: () => void }): JSX.Element {
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
    <Dialog title="Edit project" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Project name" htmlFor="pe-name">
          <Input id="pe-name" {...register("name")} />
        </Field>
        <Field label="Status" htmlFor="pe-status">
          <Select id="pe-status" {...register("status")}>
            {PROJECT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Start date" htmlFor="pe-start">
            <Input id="pe-start" type="date" {...register("startDate")} />
          </Field>
          <Field label="Target date" htmlFor="pe-target">
            <Input id="pe-target" type="date" {...register("targetDate")} />
          </Field>
        </div>
        <Field label={`Budget (${project.currency})`} htmlFor="pe-budget">
          <Input id="pe-budget" inputMode="decimal" placeholder="e.g. 12000.00" {...register("budget")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Save project</Button>
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
                  <Button variant="ghost" size="sm" onClick={() => remove.mutate(m.userId)}>Remove</Button>
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
            <Field label="Email (must already belong to the workspace)" htmlFor="member-email">
              <Input id="member-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
          </div>
          <div>
            <Field label="Role" htmlFor="member-role">
              <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="LEAD">LEAD</option>
                <option value="MEMBER">MEMBER</option>
                <option value="CLIENT_ADMIN">CLIENT_ADMIN</option>
                <option value="CLIENT_APPROVER">CLIENT_APPROVER</option>
                <option value="CLIENT_VIEWER">CLIENT_VIEWER</option>
              </Select>
            </Field>
          </div>
          <Button type="submit" disabled={add.isPending}>Add member</Button>
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
            Combined: {formatMoney(b.combined.priceMinor, b.combined.currency ?? "USD")}
            {b.combined.missingImpact.length > 0 ? ` · missing impact: ${b.combined.missingImpact.join(", ")}` : ""}
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
                <Button size="sm" variant="secondary" onClick={() => setSending(b.id)}>Send for approval…</Button>
              )}
            </div>
          ) : null}
        </Card>
      ))}
      {canManage ? (
        <Card>
          <h3 className="mb-2 font-medium">New bundle</h3>
          <div className="space-y-3">
            <Field label="Bundle name" htmlFor="bundle-name">
              <Input id="bundle-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <fieldset>
              <legend className="text-sm font-medium">Members (undecided requests only)</legend>
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
              Create bundle
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function SendBundleForm({ projectId, bundleId, expiry, setExpiry, onDone }: { projectId: string; bundleId: string; expiry: string; setExpiry: (v: string) => void; onDone: () => void }): JSX.Element {
  const members = useQuery({ queryKey: ["members", projectId], queryFn: () => fetchAll<MemberRow>(`/projects/${projectId}/members`) });
  const [approvers, setApprovers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<string[] | null>(null);
  const send = useMutation({
    mutationFn: () =>
      api.post<{ approval: { id: string }; reviewUrls?: string[] }>(`/bundles/${bundleId}/approval-requests`, {
        approverUserIds: approvers,
        expiresAt: new Date(expiry).toISOString(),
      }),
    onSuccess: (res) => {
      setLinks(res.reviewUrls ?? []);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3">
      <p className="text-sm font-medium">Approvers</p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name} ({m.role})
        </label>
      ))}
      <Field label="Expires at" htmlFor={`bundle-expiry-${bundleId}`}>
        <Input id={`bundle-expiry-${bundleId}`} type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
      </Field>
      {error ? <ErrorBanner message={error} /> : null}
      {links ? (
        <ul className="text-sm">{links.map((l) => <li key={l}><a className="underline" href={l}>{l}</a></li>)}</ul>
      ) : (
        <Button size="sm" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>Send bundle</Button>
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
                <Textarea aria-label="Edit note" rows={3} value={editBody} onChange={(e) => setEditBody(e.target.value)} />
                <span className="flex gap-2">
                  <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ id: n.id, note: editBody })}>Save</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                </span>
              </div>
            ) : (
              <>
                <p className="text-slate-900">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {n.targetType} · {new Date(n.createdAt).toLocaleString()}
                  {(n.editHistory ?? []).length > 0 ? ` · edited ${(n.editHistory ?? []).length}×` : ""}
                  {" · "}<button type="button" className="underline" onClick={() => { setEditingId(n.id); setEditBody(n.body); }}>Edit</button>
                </p>
              </>
            )}
          </li>
        ))}
      </ul>
      {(notes.data ?? []).length === 0 ? <Empty title="No decision notes yet" /> : null}
      <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Record rationale" htmlFor="note-body">
          <Textarea id="note-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} required />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button size="sm" type="submit" disabled={save.isPending}>Save note</Button>
      </form>
    </Card>
  );
}

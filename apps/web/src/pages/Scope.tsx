import { useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll, ApiError } from "../lib/api.js";
import type { AttachmentRow, EvidenceRow, RequirementRow, Revision, ScopeVersion } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, PageTitle, Select, Spinner, Textarea, formatDate, statusTone } from "../components/ui.js";

interface Diff {
  added: Array<{ stableKey: string; title: string }>;
  removed: Array<{ stableKey: string; title: string }>;
  modified: Array<{ stableKey: string; changes: Array<{ field: string; before: unknown; after: unknown }> }>;
  assumptionsChanged: boolean;
  exclusionsChanged: boolean;
  beforeAssumptions: string[];
  afterAssumptions: string[];
  beforeExclusions: string[];
  afterExclusions: string[];
}

export function ScopePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const projectId = id as string;
  const client = useQueryClient();
  const versions = useQuery({
    queryKey: ["versions", projectId],
    queryFn: () => fetchAll<ScopeVersion>(`/projects/${projectId}/scope-versions`),
  });
  const requirements = useQuery({
    queryKey: ["requirements", projectId],
    queryFn: () => api.get<{ data: RequirementRow[]; governingVersionId: string | null; draftVersionId: string | null }>(
      `/projects/${projectId}/requirements`,
    ),
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [showDraft, setShowDraft] = useState(false);
  const [showRequirement, setShowRequirement] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [showExtract, setShowExtract] = useState(false);
  const [editing, setEditing] = useState<Revision | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selected = (versions.data ?? []).find((v) => v.id === (selectedId ?? requirements.data?.governingVersionId ?? requirements.data?.draftVersionId)) ?? null;
  const detail = useQuery({
    queryKey: ["version", selected?.id],
    queryFn: () => api.get<ScopeVersion>(`/scope-versions/${selected?.id}`),
    enabled: Boolean(selected),
  });

  const publish = useMutation({
    mutationFn: () => api.post<ScopeVersion>(`/scope-versions/${selected?.id}/publish`, { expectedVersion: detail.data?.version }),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["versions", projectId] });
      void client.invalidateQueries({ queryKey: ["requirements", projectId] });
      void client.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (err) => setError(err instanceof ApiError && err.details ? `${err.message}` : errorMessage(err)),
  });

  const diff = useQuery({
    queryKey: ["diff", selected?.id, compareId],
    queryFn: () => api.get<{ diff: Diff }>(`/scope-versions/${compareId}/diff/${selected?.id}`),
    enabled: Boolean(selected && compareId && compareId !== selected.id),
  });

  if (versions.isLoading) return <Spinner />;
  if (versions.isError) return <ErrorBanner message={errorMessage(versions.error)} />;
  const list = versions.data ?? [];
  const draft = list.find((v) => v.status === "DRAFT") ?? null;

  return (
    <div>
      <PageTitle
        title="Scope ledger"
        subtitle="The versioned record of what was agreed. Published versions are immutable."
        actions={!draft ? <Button size="sm" onClick={() => setShowDraft(true)}>New draft</Button> : null}
      />
      <ProjectSubnav projectId={projectId} />
      {error ? <div className="mb-4"><ErrorBanner message={error} /></div> : null}
      <div className="grid gap-5 md:grid-cols-3">
        <Card className="md:col-span-1">
          <h2 className="mb-2 font-medium">Versions</h2>
          {list.length === 0 ? <Empty title="No versions yet" /> : (
            <ul className="space-y-2">
              {list.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(v.id)}
                    className={`w-full rounded-md border px-3 py-2 text-left text-sm ${selected?.id === v.id ? "border-teal-700 bg-teal-50" : "border-slate-200 hover:border-slate-300"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="font-medium">v{v.sequence}{v.title ? ` · ${v.title}` : ""}</span>
                      <Badge tone={statusTone(v.status)}>{v.status}</Badge>
                    </span>
                    <span className="text-xs text-slate-500">{v.documentName ?? ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.length > 1 && selected ? (
            <div className="mt-4">
              <Field label="Compare against" htmlFor="compare">
                <Select id="compare" value={compareId ?? ""} onChange={(e) => setCompareId(e.target.value || null)}>
                  <option value="">Select a version…</option>
                  {list.filter((v) => v.id !== selected.id).map((v) => (
                    <option key={v.id} value={v.id}>v{v.sequence} ({v.status})</option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : null}
        </Card>

        <div className="space-y-4 md:col-span-2">
          {!selected || !detail.data ? (
            <Empty title="Select a version" hint="Choose a version on the left to inspect its exact contents." />
          ) : (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">v{detail.data.sequence}{detail.data.title ? ` · ${detail.data.title}` : ""}</h2>
                  {detail.data.summary ? <p className="text-sm text-slate-600">{detail.data.summary}</p> : null}
                </div>
                <Badge tone={statusTone(detail.data.status)}>{detail.data.status}</Badge>
              </div>
              {detail.data.status === "DRAFT" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => setShowRequirement(true)}>Add requirement</Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowExtract(true)}>Extract from proposal…</Button>
                  <Button size="sm" variant="secondary" onClick={() => setShowAssumptions(true)}>Edit assumptions…</Button>
                  <Button size="sm" variant="secondary" disabled={publish.isPending} onClick={() => publish.mutate()}>
                    {list.some((v) => v.status === "PUBLISHED") ? "Publish amendment" : "Publish baseline"}
                  </Button>
                </div>
              ) : null}
              {detail.data.status === "DRAFT" && list.some((v) => v.status === "PUBLISHED") ? (
                <p className="mt-2 text-xs text-slate-500">Amendments publish only with a linked approved change — convert or link one first.</p>
              ) : null}
              <RevisionList
                projectId={projectId}
                version={detail.data}
                onChanged={() => {
                  void client.invalidateQueries({ queryKey: ["version"] });
                  void client.invalidateQueries({ queryKey: ["versions", projectId] });
                  void client.invalidateQueries({ queryKey: ["requirements", projectId] });
                }}
                onEdit={setEditing}
                onError={setError}
              />
              <Assumptions title="Assumptions" items={detail.data.assumptions} />
              <Assumptions title="Exclusions" items={detail.data.exclusions} />
            </Card>
          )}
          {diff.data ? <DiffCard diff={diff.data.diff} /> : null}
        </div>
      </div>
      {showDraft ? <DraftDialog projectId={projectId} versions={list} onClose={() => setShowDraft(false)} onCreated={setSelectedId} /> : null}
      {showRequirement && draft ? (
        <RequirementDialog projectId={projectId} draftId={draft.id} onClose={() => setShowRequirement(false)} />
      ) : null}
      {editing && draft ? (
        <EditRequirementDialog projectId={projectId} draft={draft} editing={editing} onClose={() => setEditing(null)} />
      ) : null}
      {showAssumptions && detail.data ? (
        <AssumptionsDialog version={detail.data} onClose={() => setShowAssumptions(false)} />
      ) : null}
      {showExtract ? (
        <ExtractDialog projectId={projectId} draftId={draft?.id ?? null} onClose={() => setShowExtract(false)} />
      ) : null}
    </div>
  );
}

function RevisionList({ projectId, version, onChanged, onEdit, onError }: {
  projectId: string;
  version: ScopeVersion;
  onChanged: () => void;
  onEdit: (r: Revision) => void;
  onError: (m: string) => void;
}): JSX.Element {
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revisions = [...(version.revisions ?? [])].sort((a, b) => a.order - b.order);
  const isDraft = version.status === "DRAFT";

  const move = async (rev: Revision, dir: -1 | 1): Promise<void> => {
    const idx = revisions.findIndex((r) => r.id === rev.id);
    const neighbor = revisions[idx + dir];
    if (!neighbor) return;
    setBusy(true);
    try {
      const v1 = (await api.get<ScopeVersion>(`/scope-versions/${version.id}`)).version;
      await api.post(`/scope-versions/${version.id}/requirements`, {
        requirementId: rev.requirementId, expectedVersion: v1, order: neighbor.order,
      });
      const v2 = (await api.get<ScopeVersion>(`/scope-versions/${version.id}`)).version;
      await api.post(`/scope-versions/${version.id}/requirements`, {
        requirementId: neighbor.requirementId, expectedVersion: v2, order: rev.order,
      });
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (rev: Revision): Promise<void> => {
    if (!window.confirm(`Remove ${rev.stableKey} from this draft? Published history is untouched.`)) return;
    setBusy(true);
    try {
      const v = (await api.get<ScopeVersion>(`/scope-versions/${version.id}`)).version;
      await api.delete(`/scope-versions/${version.id}/requirements/${rev.requirementId}?expectedVersion=${v}`);
      onChanged();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (revisions.length === 0) {
    return <div className="mt-3"><Empty title="Empty draft" hint="Add at least one requirement before publishing." /></div>;
  }
  return (
    <ul className="mt-4 space-y-3">
      {revisions.map((r) => (
        <li key={r.id} className="rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{r.stableKey} · {r.title}</p>
            <span className="flex flex-wrap items-center gap-1">
              {r.category ? <Badge>{r.category}</Badge> : null}
              {r.priority ? <Badge tone={r.priority === "CRITICAL" ? "red" : r.priority === "HIGH" ? "amber" : "slate"}>{r.priority}</Badge> : null}
              {r.status ? <Badge tone={statusTone(r.status)}>{r.status}</Badge> : null}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-700">{r.description}</p>
          {r.acceptanceCriteria.length > 0 ? (
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
              {r.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}
            </ul>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEvidenceFor(evidenceFor === r.requirementId ? null : r.requirementId)}>
              {evidenceFor === r.requirementId ? "Hide evidence" : "Evidence"}
            </Button>
            {isDraft ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => onEdit(r)}>Edit</Button>
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Move ${r.stableKey} up`} onClick={() => void move(r, -1)}>↑</Button>
                <Button variant="ghost" size="sm" disabled={busy} aria-label={`Move ${r.stableKey} down`} onClick={() => void move(r, 1)}>↓</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(r)}>Remove</Button>
              </>
            ) : null}
          </div>
          {evidenceFor === r.requirementId ? (
            <EvidencePanel projectId={projectId} requirementId={r.requirementId} />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Assumptions({ title, items }: { title: string; items: string[] }): JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="list-disc pl-5 text-sm text-slate-700">{items.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  );
}

function DiffCard({ diff }: { diff: Diff }): JSX.Element {
  return (
    <Card>
      <h2 className="mb-2 font-medium">Agreement diff</h2>
      {diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0 && !diff.assumptionsChanged && !diff.exclusionsChanged ? (
        <p className="text-sm text-slate-600">No differences.</p>
      ) : (
        <div className="space-y-2 text-sm">
          {diff.added.map((r) => <p key={r.stableKey}><Badge tone="green">Added</Badge> {r.stableKey} · {r.title}</p>)}
          {diff.removed.map((r) => <p key={r.stableKey}><Badge tone="red">Removed</Badge> {r.stableKey} · {r.title}</p>)}
          {diff.modified.map((r) => (
            <div key={r.stableKey}>
              <p><Badge tone="amber">Modified</Badge> {r.stableKey}</p>
              <ul className="ml-4 list-disc text-xs text-slate-600">
                {r.changes.map((c) => (
                  <li key={c.field}>{c.field}: {JSON.stringify(c.before)} → {JSON.stringify(c.after)}</li>
                ))}
              </ul>
            </div>
          ))}
          {diff.assumptionsChanged ? <p><Badge>Assumptions changed</Badge></p> : null}
          {diff.exclusionsChanged ? <p><Badge>Exclusions changed</Badge></p> : null}
        </div>
      )}
    </Card>
  );
}

function AssumptionsDialog({ version, onClose }: { version: ScopeVersion; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{ assumptions: string; exclusions: string }>({
    defaultValues: { assumptions: version.assumptions.join("\n"), exclusions: version.exclusions.join("\n") },
  });
  const save = useMutation({
    mutationFn: (v: { assumptions: string; exclusions: string }) =>
      api.patch(`/scope-versions/${version.id}`, {
        expectedVersion: version.version,
        assumptions: v.assumptions.split("\n").map((s) => s.trim()).filter(Boolean),
        exclusions: v.exclusions.split("\n").map((s) => s.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["version"] });
      void client.invalidateQueries({ queryKey: ["versions"] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Edit assumptions & exclusions" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Assumptions (one per line)" htmlFor="asm-a">
          <Textarea id="asm-a" rows={4} {...register("assumptions")} />
        </Field>
        <Field label="Exclusions (one per line)" htmlFor="asm-e">
          <Textarea id="asm-e" rows={4} {...register("exclusions")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Save in draft</Button>
      </form>
    </Dialog>
  );
}

function EvidencePanel({ projectId, requirementId }: { projectId: string; requirementId: string }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const evidence = useQuery({
    queryKey: ["evidence", requirementId],
    queryFn: () => fetchAll<EvidenceRow>(`/requirements/${requirementId}/evidence`),
  });
  const attachments = useQuery({
    queryKey: ["attachments", projectId],
    queryFn: () => fetchAll<AttachmentRow>(`/projects/${projectId}/attachments`),
  });
  const [type, setType] = useState("URL");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [attachmentId, setAttachmentId] = useState("");
  const refresh = (): void => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["evidence", requirementId] });
  };
  const attach = useMutation({
    mutationFn: () =>
      api.post(`/requirements/${requirementId}/evidence`, {
        type,
        title,
        ...(type === "URL" ? { url } : {}),
        ...(type === "NOTE" ? { note } : {}),
        ...(type === "FILE" ? { attachmentId } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      setUrl("");
      setNote("");
      setAttachmentId("");
      refresh();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const verify = useMutation({
    mutationFn: (vars: { id: string; status: string }) => api.patch(`/evidence/${vars.id}`, { status: vars.status }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const readyFiles = (attachments.data ?? []).filter((a) => a.status === "READY");
  return (
    <div className="mt-2 rounded-md bg-slate-50 p-3">
      <p className="text-sm font-medium">Delivery evidence</p>
      {evidence.isLoading ? <Spinner /> : (evidence.data ?? []).length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">No evidence attached yet.</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {(evidence.data ?? []).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white p-2">
              <span>
                <Badge>{e.type}</Badge> {e.title}
                {e.url ? <> · <a className="underline" href={e.url} target="_blank" rel="noreferrer">open</a></> : null}
                {e.note ? <span className="text-slate-600"> · {e.note}</span> : null}
                {" "}<Badge tone={statusTone(e.status)}>{e.status}</Badge>
                <span className="text-xs text-slate-500"> · {formatDate(e.createdAt)}</span>
              </span>
              {e.status === "PENDING" ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="secondary" disabled={verify.isPending} onClick={() => verify.mutate({ id: e.id, status: "REVIEWED" })}>Mark reviewed</Button>
                  <Button size="sm" variant="secondary" disabled={verify.isPending} onClick={() => verify.mutate({ id: e.id, status: "ACCEPTED" })}>Accept</Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Field label="Type" htmlFor={`ev-type-${requirementId}`}>
          <Select id={`ev-type-${requirementId}`} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="URL">URL</option>
            <option value="FILE">File</option>
            <option value="NOTE">Note</option>
          </Select>
        </Field>
        <Field label="Title" htmlFor={`ev-title-${requirementId}`}>
          <Input id={`ev-title-${requirementId}`} value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {type === "URL" ? (
          <div className="col-span-2">
            <Field label="URL" htmlFor={`ev-url-${requirementId}`}>
              <Input id={`ev-url-${requirementId}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </Field>
          </div>
        ) : null}
        {type === "NOTE" ? (
          <div className="col-span-2">
            <Field label="Note" htmlFor={`ev-note-${requirementId}`}>
              <Textarea id={`ev-note-${requirementId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
        ) : null}
        {type === "FILE" ? (
          <div className="col-span-2">
            <Field label="Ready file" htmlFor={`ev-file-${requirementId}`}>
              <Select id={`ev-file-${requirementId}`} value={attachmentId} onChange={(e) => setAttachmentId(e.target.value)}>
                <option value="">Select an uploaded file…</option>
                {readyFiles.map((a) => <option key={a.id} value={a.id}>{a.fileName}</option>)}
              </Select>
            </Field>
          </div>
        ) : null}
      </div>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      <Button size="sm" className="mt-2" disabled={attach.isPending || !title} onClick={() => attach.mutate()}>Attach evidence</Button>
    </div>
  );
}

interface ExtractedItem {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

function ExtractDialog({ projectId, draftId, onClose }: { projectId: string; draftId: string | null; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [sourceText, setSourceText] = useState("");
  const [output, setOutput] = useState<{ requirements: ExtractedItem[]; assumptions: string[]; exclusions: string[] } | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const run = useMutation({
    mutationFn: () =>
      api.post<{ analysis: { output: { requirements: ExtractedItem[]; assumptions: string[]; exclusions: string[] } } }>(
        `/projects/${projectId}/ai/extract-requirements`, { sourceText, sourceLabel: "proposal" },
      ),
    onSuccess: (res) => {
      setError(null);
      setOutput(res.analysis.output);
      setSelected(res.analysis.output.requirements.map((_, i) => i));
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const addSelected = async (): Promise<void> => {
    if (!draftId || !output) return;
    setAdding(true);
    setError(null);
    try {
      for (const i of selected) {
        const item = output.requirements[i];
        if (!item) continue;
        await api.post(`/projects/${projectId}/requirements`, {
          draftVersionId: draftId,
          title: item.title,
          description: item.description,
          acceptanceCriteria: item.acceptanceCriteria,
          ...(item.category ? { category: item.category } : {}),
          ...(item.priority ? { priority: item.priority } : {}),
        });
      }
      void client.invalidateQueries({ queryKey: ["version"] });
      void client.invalidateQueries({ queryKey: ["versions", projectId] });
      void client.invalidateQueries({ queryKey: ["requirements", projectId] });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };
  return (
    <Dialog title="Extract requirements from proposal" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">AI output is a clearly labeled draft — review every item. Only selected items are added.</p>
        <Field label="Proposal text (min 20 characters)" htmlFor="ext-text">
          <Textarea id="ext-text" rows={6} value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
        </Field>
        <Button disabled={run.isPending || sourceText.length < 20} onClick={() => run.mutate()} className="w-full">
          {run.isPending ? "Extracting…" : "Run extraction"}
        </Button>
        {output ? (
          <div>
            <p className="text-sm font-medium">Draft requirements ({output.requirements.length})</p>
            <ul className="mt-2 max-h-64 space-y-2 overflow-auto">
              {output.requirements.map((r, i) => (
                <li key={`${r.title}-${i}`}>
                  <label className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selected.includes(i)}
                      onChange={(e) => setSelected(e.target.checked ? [...selected, i] : selected.filter((s) => s !== i))}
                    />
                    <span>
                      <span className="font-medium">{r.title}</span>
                      <span className="block text-slate-600">{r.description}</span>
                      {r.acceptanceCriteria.length > 0 ? <span className="block text-xs">AC: {r.acceptanceCriteria.join(" · ")}</span> : null}
                      {(r.category ?? r.priority) ? <span className="block text-xs">{[r.category, r.priority].filter(Boolean).join(" · ")}</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {(output.assumptions.length > 0 || output.exclusions.length > 0) ? (
              <p className="mt-2 text-xs text-slate-500">
                Suggested assumptions: {output.assumptions.join(" · ") || "—"} · Exclusions: {output.exclusions.join(" · ") || "—"}
              </p>
            ) : null}
            <Button disabled={adding || selected.length === 0 || !draftId} onClick={() => void addSelected()} className="mt-3 w-full">
              {!draftId ? "Create a draft first to add items" : adding ? "Adding…" : `Add ${selected.length} selected to draft`}
            </Button>
          </div>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
      </div>
    </Dialog>
  );
}

function DraftDialog({ projectId, versions, onClose, onCreated }: { projectId: string; versions: ScopeVersion[]; onClose: () => void; onCreated: (id: string) => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{ title: string; copyFromVersionId: string }>();
  const save = useMutation({
    mutationFn: (v: { title: string; copyFromVersionId: string }) =>
      api.post<ScopeVersion>(`/projects/${projectId}/scope-versions/draft`, {
        title: v.title || undefined,
        copyFromVersionId: v.copyFromVersionId || undefined,
      }),
    onSuccess: (draft) => {
      void client.invalidateQueries({ queryKey: ["versions", projectId] });
      void client.invalidateQueries({ queryKey: ["requirements", projectId] });
      onCreated(draft.id);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="New draft" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Title (optional)" htmlFor="draft-title">
          <Input id="draft-title" placeholder="v2 amendment" {...register("title")} />
        </Field>
        <Field label="Copy from (optional)" htmlFor="draft-copy">
          <Select id="draft-copy" {...register("copyFromVersionId")}>
            <option value="">Start empty</option>
            {versions.filter((v) => v.status !== "DRAFT").map((v) => (
              <option key={v.id} value={v.id}>v{v.sequence}{v.title ? ` · ${v.title}` : ""}</option>
            ))}
          </Select>
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Create draft</Button>
      </form>
    </Dialog>
  );
}

type RequirementForm = {
  title: string;
  description: string;
  acceptanceCriteria: string;
  category: string;
  priority: string;
  order: string;
};

function RequirementDialog({ projectId, draftId, onClose }: { projectId: string; draftId: string; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<RequirementForm>();
  const save = useMutation({
    mutationFn: (v: RequirementForm) =>
      api.post(`/projects/${projectId}/requirements`, {
        draftVersionId: draftId,
        title: v.title,
        description: v.description,
        acceptanceCriteria: v.acceptanceCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
        ...(v.category ? { category: v.category } : {}),
        ...(v.priority ? { priority: v.priority } : {}),
        ...(v.order !== "" ? { order: Number(v.order) } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["requirements", projectId] });
      void client.invalidateQueries({ queryKey: ["version"] });
      void client.invalidateQueries({ queryKey: ["versions", projectId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Add requirement" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Title" error={formState.errors.title?.message} htmlFor="req-title">
          <Input id="req-title" {...register("title", { required: "Title is required" })} />
        </Field>
        <Field label="Description" error={formState.errors.description?.message} htmlFor="req-description">
          <Textarea id="req-description" rows={3} {...register("description", { required: "Description is required" })} />
        </Field>
        <Field label="Acceptance criteria (one per line)" htmlFor="req-ac">
          <Textarea id="req-ac" rows={3} {...register("acceptanceCriteria")} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Category" htmlFor="req-category">
            <Input id="req-category" placeholder="e.g. Checkout" {...register("category")} />
          </Field>
          <Field label="Priority" htmlFor="req-priority">
            <Select id="req-priority" {...register("priority")}>
              <option value="">—</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </Select>
          </Field>
          <Field label="Order" htmlFor="req-order">
            <Input id="req-order" inputMode="numeric" placeholder="0" {...register("order")} />
          </Field>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Add to draft</Button>
      </form>
    </Dialog>
  );
}

function EditRequirementDialog({ projectId, draft, editing, onClose }: { projectId: string; draft: ScopeVersion; editing: Revision; onClose: () => void }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<RequirementForm>({
    defaultValues: {
      title: editing.title,
      description: editing.description,
      acceptanceCriteria: editing.acceptanceCriteria.join("\n"),
      category: editing.category ?? "",
      priority: editing.priority ?? "",
      order: String(editing.order),
    },
  });
  const detail = useQuery({
    queryKey: ["version", draft.id],
    queryFn: () => api.get<ScopeVersion>(`/scope-versions/${draft.id}`),
  });
  const save = useMutation({
    mutationFn: (v: RequirementForm) =>
      api.post(`/scope-versions/${draft.id}/requirements`, {
        requirementId: editing.requirementId,
        expectedVersion: detail.data?.version ?? draft.version,
        title: v.title,
        description: v.description,
        acceptanceCriteria: v.acceptanceCriteria.split("\n").map((s) => s.trim()).filter(Boolean),
        ...(v.category ? { category: v.category } : {}),
        ...(v.priority ? { priority: v.priority } : {}),
        ...(v.order !== "" ? { order: Number(v.order) } : {}),
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["version"] });
      void client.invalidateQueries({ queryKey: ["requirements", projectId] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Edit requirement in draft" onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-4">
        <Field label="Title" htmlFor="edit-title">
          <Input id="edit-title" {...register("title")} />
        </Field>
        <Field label="Description" htmlFor="edit-description">
          <Textarea id="edit-description" rows={3} {...register("description")} />
        </Field>
        <Field label="Acceptance criteria (one per line)" htmlFor="edit-ac">
          <Textarea id="edit-ac" rows={3} {...register("acceptanceCriteria")} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="Category" htmlFor="edit-category">
            <Input id="edit-category" {...register("category")} />
          </Field>
          <Field label="Priority" htmlFor="edit-priority">
            <Select id="edit-priority" {...register("priority")}>
              <option value="">—</option>
              <option value="LOW">LOW</option>
              <option value="MEDIUM">MEDIUM</option>
              <option value="HIGH">HIGH</option>
              <option value="CRITICAL">CRITICAL</option>
            </Select>
          </Field>
          <Field label="Order" htmlFor="edit-order">
            <Input id="edit-order" inputMode="numeric" {...register("order")} />
          </Field>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Save in draft</Button>
      </form>
    </Dialog>
  );
}

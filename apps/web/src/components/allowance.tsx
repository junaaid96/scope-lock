import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { AllowanceDrawDownView, AllowancePoolView } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Spinner, Textarea, formatDate, formatMoney, statusTone } from "./ui.js";

function drawTone(status: string): "green" | "amber" | "red" | "slate" {
  if (status === "FINAL") return "green";
  if (status === "OBJECTED") return "red";
  if (status === "NOTIFIED") return "amber";
  return "slate";
}

export function AllowanceTab({ projectId, currency, myRole, canManage }: { projectId: string; currency: string; myRole: string | null; canManage: boolean }): JSX.Element {
  const client = useQueryClient();
  const pools = useQuery({
    queryKey: ["allowance-pools", projectId],
    queryFn: () => fetchAll<AllowancePoolView>(`/projects/${projectId}/allowance-pools`),
  });
  const [showCreate, setShowCreate] = useState(false);
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ["allowance-pools", projectId] });
  };
  const canObject = myRole === "CLIENT_ADMIN" || myRole === "CLIENT_APPROVER";

  if (pools.isLoading) return <Spinner />;
  if (pools.isError) return <ErrorBanner message={errorMessage(pools.error)} />;
  const list = pools.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600">
          Pre-agreed pools that approved changes draw from. A pool only activates when the client approves the grant itself —
          every draw notifies the client and can be objected to inside the objection window.
        </p>
        {canManage ? <Button size="sm" onClick={() => setShowCreate(true)}>New pool</Button> : null}
      </div>
      {list.length === 0 ? (
        <Empty title="No allowance pools" hint="Pools are off by default. Create one when the client pre-agrees a block of hours or budget." />
      ) : null}
      {list.map((pool) => (
        <PoolCard key={pool.id} pool={pool} projectId={projectId} currency={currency} canManage={canManage} canObject={canObject} onChanged={refresh} />
      ))}
      {showCreate ? <PoolDialog projectId={projectId} currency={currency} onClose={() => setShowCreate(false)} onDone={refresh} /> : null}
    </div>
  );
}

function PoolCard({ pool, projectId, currency, canManage, canObject, onChanged }: {
  pool: AllowancePoolView; projectId: string; currency: string; canManage: boolean; canObject: boolean; onChanged: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [objecting, setObjecting] = useState<AllowanceDrawDownView | null>(null);
  const [resolving, setResolving] = useState<AllowanceDrawDownView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/allowance-pools/${pool.id}`, body),
    onSuccess: onChanged,
    onError: (err) => setError(errorMessage(err)),
  });
  const total = pool.kind === "HOURS" ? `${pool.totalHours}h` : formatMoney(pool.totalMinor, pool.currency ?? currency);
  const remaining = pool.kind === "HOURS" ? `${pool.balance.remainingHours}h` : formatMoney(pool.balance.remainingMinor, pool.currency ?? currency);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{pool.name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pool.kind === "HOURS" ? "blue" : "slate"}>{pool.kind}</Badge>
          <Badge tone={statusTone(pool.status)}>{pool.status}</Badge>
          {!pool.enabled ? <Badge tone="slate">DISABLED</Badge> : null}
          {pool.balance.exhausted ? <Badge tone="red">EXHAUSTED</Badge> : null}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">Total</dt>
        <dd className="font-medium">{total}</dd>
        <dt className="text-slate-500">Remaining</dt>
        <dd className="font-medium">{remaining}</dd>
        <dt className="text-slate-500">Objection window</dt>
        <dd>{pool.objectionWindowHours}h</dd>
        <dt className="text-slate-500">Grant</dt>
        <dd>{pool.grantDecisionId ? "Client-approved" : pool.status === "ACTIVE" ? "Active" : "Awaiting client grant"}</dd>
      </dl>
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pool.status === "PROPOSED" ? <Button size="sm" variant="secondary" onClick={() => setSending(true)}>Send for grant…</Button> : null}
          {pool.status !== "CLOSED" ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit…</Button> : null}
          {pool.status !== "CLOSED" ? (
            <Button size="sm" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ enabled: !pool.enabled })}>
              {pool.enabled ? "Disable" : "Enable"}
            </Button>
          ) : null}
          {pool.status !== "CLOSED" ? (
            <Button size="sm" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ status: "CLOSED" })}>Close</Button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}

      <h4 className="mt-4 font-medium">Draw-downs ({pool.drawDowns.length})</h4>
      {pool.drawDowns.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">No draws yet. Approved changes linked to this pool draw automatically on decision.</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {pool.drawDowns.map((d) => (
            <li key={d.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="font-medium underline" to={`/projects/${projectId}/changes/${d.changeRequestId}`}>
                  {d.changeNumber}: {d.changeTitle}
                </Link>
                <Badge tone={drawTone(d.status)}>{d.status.replace(/_/g, " ")}</Badge>
              </div>
              <p className="mt-1 text-slate-700">
                {d.hours !== null && d.hours !== undefined ? `${d.hours}h` : formatMoney(d.amountMinor, pool.currency ?? currency)}
                {" · "}notified {formatDate(d.notifiedAt)}
                {d.objectionDeadline ? ` · object by ${formatDate(d.objectionDeadline)}` : ""}
              </p>
              {d.objectionReason ? <p className="mt-1 text-slate-700"><strong>Objection:</strong> {d.objectionReason}</p> : null}
              {d.resolutionNote ? <p className="mt-1 text-slate-700"><strong>Resolution:</strong> {d.resolutionNote}</p> : null}
              <div className="mt-2 flex gap-2">
                {canObject && d.status === "NOTIFIED" && d.objectionDeadline && Date.parse(d.objectionDeadline) > Date.now() ? (
                  <Button size="sm" variant="secondary" onClick={() => setObjecting(d)}>Object…</Button>
                ) : null}
                {canManage && d.status === "OBJECTED" ? (
                  <Button size="sm" variant="secondary" onClick={() => setResolving(d)}>Resolve…</Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing ? <PoolDialog projectId={projectId} currency={currency} pool={pool} onClose={() => setEditing(false)} onDone={onChanged} /> : null}
      {sending ? <GrantDialog pool={pool} projectId={projectId} onClose={() => setSending(false)} onDone={onChanged} /> : null}
      {objecting ? <ObjectDialog draw={objecting} onClose={() => setObjecting(null)} onDone={() => { setObjecting(null); onChanged(); }} /> : null}
      {resolving ? <ResolveDialog draw={resolving} onClose={() => setResolving(null)} onDone={() => { setResolving(null); onChanged(); }} /> : null}
    </Card>
  );
}

type PoolForm = { name: string; kind: "HOURS" | "AMOUNT"; total: string; objectionWindowHours: string; enabled: boolean };

function PoolDialog({ projectId, currency, pool, onClose, onDone }: {
  projectId: string; currency: string; pool?: AllowancePoolView; onClose: () => void; onDone: () => void;
}): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState } = useForm<PoolForm>({
    defaultValues: {
      name: pool?.name ?? "",
      kind: pool?.kind ?? "HOURS",
      total: pool ? (pool.kind === "HOURS" ? String(pool.totalHours) : String((pool.totalMinor ?? 0) / 100)) : "",
      objectionWindowHours: String(pool?.objectionWindowHours ?? 72),
      enabled: pool?.enabled ?? false,
    },
  });
  const kind = watch("kind");
  const save = useMutation({
    mutationFn: (v: PoolForm) => {
      const totalNum = Number(v.total);
      const body = pool
        ? {
            name: v.name,
            objectionWindowHours: Number(v.objectionWindowHours),
            enabled: v.enabled,
            ...(pool.status === "PROPOSED"
              ? kind === "HOURS" ? { totalHours: totalNum } : { totalMinor: Math.round(totalNum * 100) }
              : {}),
          }
        : {
            name: v.name,
            kind: v.kind,
            objectionWindowHours: Number(v.objectionWindowHours),
            enabled: v.enabled,
            ...(v.kind === "HOURS" ? { totalHours: totalNum } : { totalMinor: Math.round(totalNum * 100), currency }),
          };
      return pool ? api.patch(`/allowance-pools/${pool.id}`, body) : api.post(`/projects/${projectId}/allowance-pools`, body);
    },
    onSuccess: () => { onDone(); onClose(); },
    onError: (err) => setError(errorMessage(err)),
  });
  const totalsLocked = pool && pool.status !== "PROPOSED";
  return (
    <Dialog title={pool ? "Edit pool" : "New allowance pool"} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label="Name" htmlFor="pool-name" error={formState.errors.name?.message}>
          <Input id="pool-name" {...register("name", { required: "Name is required", maxLength: 160 })} />
        </Field>
        <Field label="Kind" htmlFor="pool-kind" hint="Hours pools draw effort; amount pools draw the priced impact.">
          <select id="pool-kind" {...register("kind")} disabled={!!pool} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="HOURS">Hours</option>
            <option value="AMOUNT">Amount</option>
          </select>
        </Field>
        <Field
          label={kind === "HOURS" ? "Total hours" : `Total (${currency})`}
          htmlFor="pool-total"
          error={formState.errors.total?.message}
          hint={totalsLocked ? "Totals lock once the client grants the pool." : undefined}
        >
          <Input id="pool-total" type="number" step="any" min="0" disabled={!!totalsLocked} {...register("total", { required: "Total is required" })} />
        </Field>
        <Field label="Objection window (hours)" htmlFor="pool-window" hint="How long the client has to object after each draw.">
          <Input id="pool-window" type="number" min="1" max="720" {...register("objectionWindowHours", { required: true })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("enabled")} /> Enabled (disabled pools cannot be granted or drawn from)
        </label>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{pool ? "Save" : "Create pool"}</Button>
      </form>
    </Dialog>
  );
}

function GrantDialog({ pool, projectId, onClose, onDone }: { pool: AllowancePoolView; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
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
      api.post<{ reviewUrls?: string[] }>(`/allowance-pools/${pool.id}/approval-requests`, {
        approverUserIds: approvers,
        approverEmails: extraEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
        expiresAt: new Date(expiry).toISOString(),
      }),
    onSuccess: (res) => { setLinks(res.reviewUrls ?? []); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={`Send “${pool.name}” for grant`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        The client approves the pool terms themselves — that grant decision is what later authorizes each draw-down.
      </p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name} ({m.role})
        </label>
      ))}
      <div className="mt-3">
        <Field label="Extra approver emails (comma-separated, optional)" htmlFor="grant-emails">
          <Input id="grant-emails" type="text" inputMode="email" value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Expires at" htmlFor="grant-expiry">
          <Input id="grant-expiry" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {links ? (
        <ul className="mt-3 space-y-1 text-sm">
          {links.map((l) => <li key={l}><Link className="underline" to={l.replace(/^https?:\/\/[^/]+/, "")}>Open review link</Link></li>)}
        </ul>
      ) : (
        <Button className="mt-3 w-full" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>
          Send for grant
        </Button>
      )}
    </Dialog>
  );
}

function ObjectDialog({ draw, onClose, onDone }: { draw: AllowanceDrawDownView; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ reason: string }>();
  const save = useMutation({
    mutationFn: (v: { reason: string }) => api.post(`/allowance-draw-downs/${draw.id}/object`, v),
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={`Object to draw on ${draw.changeNumber}`} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label="Why is this draw wrong?" htmlFor="object-reason" error={formState.errors.reason?.message} hint="The agency lead is notified and must resolve the objection.">
          <Textarea id="object-reason" rows={3} {...register("reason", { required: "A reason is required", maxLength: 2000 })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Submit objection</Button>
      </form>
    </Dialog>
  );
}

function ResolveDialog({ draw, onClose, onDone }: { draw: AllowanceDrawDownView; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ resolution: "UPHOLD" | "RELEASE"; note: string }>({ defaultValues: { resolution: "UPHOLD" } });
  const save = useMutation({
    mutationFn: (v: { resolution: "UPHOLD" | "RELEASE"; note: string }) => api.post(`/allowance-draw-downs/${draw.id}/resolve`, v),
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={`Resolve objection on ${draw.changeNumber}`} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">Objection: {draw.objectionReason}</p>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label="Resolution" htmlFor="resolve-choice">
          <select id="resolve-choice" {...register("resolution")} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="UPHOLD">Uphold the draw</option>
            <option value="RELEASE">Release it back to the pool</option>
          </select>
        </Field>
        <Field label="Note to the client" htmlFor="resolve-note" error={formState.errors.note?.message}>
          <Textarea id="resolve-note" rows={3} {...register("note", { required: "A note is required", maxLength: 2000 })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Resolve</Button>
      </form>
    </Dialog>
  );
}

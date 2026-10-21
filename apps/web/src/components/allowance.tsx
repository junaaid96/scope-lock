import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { AllowanceDrawDownView, AllowancePoolView } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, StatusBadge, Textarea, formatStatus, PageSkeleton } from "./ui.js";
import { useLocale } from "../lib/i18n/index.js";

function drawTone(status: string): "green" | "amber" | "red" | "slate" {
  if (status === "FINAL") return "green";
  if (status === "OBJECTED") return "red";
  if (status === "NOTIFIED") return "amber";
  return "slate";
}

export function AllowanceTab({ projectId, currency, myRole, canManage }: { projectId: string; currency: string; myRole: string | null; canManage: boolean }): JSX.Element {
  const client = useQueryClient();
  const { t } = useLocale();
  const pools = useQuery({
    queryKey: ["allowance-pools", projectId],
    queryFn: () => fetchAll<AllowancePoolView>(`/projects/${projectId}/allowance-pools`),
  });
  const [showCreate, setShowCreate] = useState(false);
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ["allowance-pools", projectId] });
  };
  const canObject = myRole === "CLIENT_ADMIN" || myRole === "CLIENT_APPROVER";

  if (pools.isLoading) return <PageSkeleton />;
  if (pools.isError) return <ErrorBanner message={errorMessage(pools.error)} />;
  const list = pools.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600">
          {t("allowance.blurb")}
        </p>
        {canManage ? <Button size="sm" onClick={() => setShowCreate(true)}>{t("allowance.newPool")}</Button> : null}
      </div>
      {list.length === 0 ? (
        <Empty title={t("allowance.emptyTitle")} hint={t("allowance.emptyHint")} />
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
  const { t, money, date } = useLocale();
  const [sending, setSending] = useState(false);
  const [objecting, setObjecting] = useState<AllowanceDrawDownView | null>(null);
  const [resolving, setResolving] = useState<AllowanceDrawDownView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/allowance-pools/${pool.id}`, body),
    onSuccess: onChanged,
    onError: (err) => setError(errorMessage(err)),
  });
  const total = pool.kind === "HOURS" ? `${pool.totalHours}h` : money(pool.totalMinor, pool.currency ?? currency);
  const remaining = pool.kind === "HOURS" ? `${pool.balance.remainingHours}h` : money(pool.balance.remainingMinor, pool.currency ?? currency);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold tracking-tight">{pool.name}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={pool.kind === "HOURS" ? "blue" : "slate"}>{formatStatus(pool.kind)}</Badge>
          <StatusBadge status={pool.status} />
          {!pool.enabled ? <Badge tone="slate">{formatStatus("DISABLED")}</Badge> : null}
          {pool.balance.exhausted ? <Badge tone="red">{formatStatus("EXHAUSTED")}</Badge> : null}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">{t("allowance.totalLabel")}</dt>
        <dd className="font-medium">{total}</dd>
        <dt className="text-slate-500">{t("allowance.remainingLabel")}</dt>
        <dd className="font-medium">{remaining}</dd>
        <dt className="text-slate-500">{t("allowance.objectionWindowLabel")}</dt>
        <dd>{pool.objectionWindowHours}h</dd>
        <dt className="text-slate-500">{t("allowance.grantLabel")}</dt>
        <dd>{pool.grantDecisionId ? t("allowance.grantApproved") : pool.status === "ACTIVE" ? t("allowance.grantActive") : t("allowance.grantAwaiting")}</dd>
      </dl>
      {canManage ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {pool.status === "PROPOSED" ? <Button size="sm" variant="secondary" onClick={() => setSending(true)}>{t("allowance.sendForGrantMenu")}</Button> : null}
          {pool.status !== "CLOSED" ? <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>{t("allowance.editPool")}</Button> : null}
          {pool.status !== "CLOSED" ? (
            <Button size="sm" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ enabled: !pool.enabled })}>
              {pool.enabled ? t("allowance.disable") : t("allowance.enable")}
            </Button>
          ) : null}
          {pool.status !== "CLOSED" ? (
            <Button size="sm" variant="ghost" disabled={patch.isPending} onClick={() => patch.mutate({ status: "CLOSED" })}>{t("allowance.closePool")}</Button>
          ) : null}
        </div>
      ) : null}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}

      <h4 className="mt-4 font-medium">{t("allowance.drawDowns", { count: pool.drawDowns.length })}</h4>
      {pool.drawDowns.length === 0 ? (
        <p className="mt-1 text-sm text-slate-500">{t("allowance.noDraws")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {pool.drawDowns.map((d) => (
            <li key={d.id} className="rounded-md border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link className="font-medium underline" to={`/projects/${projectId}/changes/${d.changeRequestId}`}>
                  {d.changeNumber}: {d.changeTitle}
                </Link>
                <Badge tone={drawTone(d.status)}>{formatStatus(d.status)}</Badge>
              </div>
              <p className="mt-1 text-slate-700">
                {d.hours !== null && d.hours !== undefined ? `${d.hours}h` : money(d.amountMinor, pool.currency ?? currency)}
                {" · "}{t("allowance.notifiedAt", { date: date(d.notifiedAt) })}
                {d.objectionDeadline ? ` · ${t("allowance.objectBy", { date: date(d.objectionDeadline) })}` : ""}
              </p>
              {d.objectionReason ? <p className="mt-1 text-slate-700"><strong>{t("allowance.objectionLabel")}</strong> {d.objectionReason}</p> : null}
              {d.resolutionNote ? <p className="mt-1 text-slate-700"><strong>{t("allowance.resolutionTag")}</strong> {d.resolutionNote}</p> : null}
              <div className="mt-2 flex gap-2">
                {canObject && d.status === "NOTIFIED" && d.objectionDeadline && Date.parse(d.objectionDeadline) > Date.now() ? (
                  <Button size="sm" variant="secondary" onClick={() => setObjecting(d)}>{t("allowance.objectAction")}</Button>
                ) : null}
                {canManage && d.status === "OBJECTED" ? (
                  <Button size="sm" variant="secondary" onClick={() => setResolving(d)}>{t("allowance.resolveAction")}</Button>
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
  const { t } = useLocale();
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
    <Dialog title={pool ? t("allowance.editPoolTitle") : t("allowance.newPoolTitle")} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label={t("allowance.nameLabel")} htmlFor="pool-name" error={formState.errors.name?.message}>
          <Input id="pool-name" {...register("name", { required: t("allowance.nameRequired"), maxLength: 160 })} />
        </Field>
        <Field label={t("allowance.kindLabel")} htmlFor="pool-kind" hint={t("allowance.kindHint")}>
          <select id="pool-kind" {...register("kind")} disabled={!!pool} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="HOURS">{t("allowance.kindHours")}</option>
            <option value="AMOUNT">{t("allowance.kindAmount")}</option>
          </select>
        </Field>
        <Field
          label={kind === "HOURS" ? t("allowance.totalHours") : t("allowance.totalAmount", { currency })}
          htmlFor="pool-total"
          error={formState.errors.total?.message}
          hint={totalsLocked ? t("allowance.totalsLockedHint") : undefined}
        >
          <Input id="pool-total" type="number" step="any" min="0" disabled={!!totalsLocked} {...register("total", { required: t("allowance.totalRequired") })} />
        </Field>
        <Field label={t("allowance.windowLabel")} htmlFor="pool-window" hint={t("allowance.windowHint")}>
          <Input id="pool-window" type="number" min="1" max="720" {...register("objectionWindowHours", { required: true })} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...register("enabled")} /> {t("allowance.enabledLabel")}
        </label>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{pool ? t("allowance.save") : t("allowance.createPool")}</Button>
      </form>
    </Dialog>
  );
}

function GrantDialog({ pool, projectId, onClose, onDone }: { pool: AllowancePoolView; projectId: string; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  const [links, setLinks] = useState<string[] | null>(null);
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => fetchAll<{ userId: string; role: string; user: { name: string } | null }>(`/projects/${projectId}/members`),
  });
  const [approvers, setApprovers] = useState<string[]>([]);
  const [extraEmails, setExtraEmails] = useState("");
  const [expiry, setExpiry] = useState("");
  const [policyMode, setPolicyMode] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api.post<{ reviewUrls?: string[] }>(`/allowance-pools/${pool.id}/approval-requests`, {
        approverUserIds: approvers,
        approverEmails: extraEmails.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean),
        expiresAt: new Date(expiry).toISOString(),
        ...(policyMode ? { policyMode } : {}),
      }),
    onSuccess: (res) => { setLinks(res.reviewUrls ?? []); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("allowance.sendForGrantTitle", { name: pool.name })} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        {t("allowance.grantBlurb")}
      </p>
      {(members.data ?? []).filter((m) => m.role !== "CLIENT_VIEWER").map((m) => (
        <label key={m.userId} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={approvers.includes(m.userId)} onChange={(e) => setApprovers(e.target.checked ? [...approvers, m.userId] : approvers.filter((a) => a !== m.userId))} />
          {m.user?.name ?? m.userId} ({formatStatus(m.role)})
        </label>
      ))}
      <div className="mt-3">
        <Field label={t("allowance.extraEmailsLabel")} htmlFor="grant-emails">
          <Input id="grant-emails" type="text" inputMode="email" value={extraEmails} onChange={(e) => setExtraEmails(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Field
          label={t("allowance.decisionRuleLabel")}
          htmlFor="grant-policy"
          hint={t("allowance.decisionRuleHint")}
        >
          <select id="grant-policy" value={policyMode} onChange={(e) => setPolicyMode(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="">{t("allowance.policyDefault")}</option>
            <option value="ANY">{t("allowance.policyAny")}</option>
            <option value="ALL">{t("allowance.policyAll")}</option>
            <option value="SEQUENTIAL">{t("allowance.policySequential")}</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label={t("allowance.expiresLabel")} htmlFor="grant-expiry">
          <Input id="grant-expiry" type="datetime-local" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      {links ? (
        <ul className="mt-3 space-y-1 text-sm">
          {links.map((l) => <li key={l}><Link className="underline" to={l.replace(/^https?:\/\/[^/]+/, "")}>{t("allowance.openReviewLink")}</Link></li>)}
        </ul>
      ) : (
        <Button className="mt-3 w-full" disabled={send.isPending || approvers.length === 0 || !expiry} onClick={() => send.mutate()}>
          {t("allowance.sendForGrantSubmit")}
        </Button>
      )}
    </Dialog>
  );
}

function ObjectDialog({ draw, onClose, onDone }: { draw: AllowanceDrawDownView; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  const { register, handleSubmit, formState } = useForm<{ reason: string }>();
  const save = useMutation({
    mutationFn: (v: { reason: string }) => api.post(`/allowance-draw-downs/${draw.id}/object`, v),
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("allowance.objectTitle", { number: draw.changeNumber })} onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label={t("allowance.objectReasonLabel")} htmlFor="object-reason" error={formState.errors.reason?.message} hint={t("allowance.objectReasonHint")}>
          <Textarea id="object-reason" rows={3} {...register("reason", { required: t("allowance.objectReasonRequired"), maxLength: 2000 })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("allowance.submitObjection")}</Button>
      </form>
    </Dialog>
  );
}

function ResolveDialog({ draw, onClose, onDone }: { draw: AllowanceDrawDownView; onClose: () => void; onDone: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { t } = useLocale();
  const { register, handleSubmit, formState } = useForm<{ resolution: "UPHOLD" | "RELEASE"; note: string }>({ defaultValues: { resolution: "UPHOLD" } });
  const save = useMutation({
    mutationFn: (v: { resolution: "UPHOLD" | "RELEASE"; note: string }) => api.post(`/allowance-draw-downs/${draw.id}/resolve`, v),
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={t("allowance.resolveTitle", { number: draw.changeNumber })} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{t("allowance.objectionLabel")} {draw.objectionReason}</p>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label={t("allowance.resolutionLabel")} htmlFor="resolve-choice">
          <select id="resolve-choice" {...register("resolution")} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
            <option value="UPHOLD">{t("allowance.upholdDraw")}</option>
            <option value="RELEASE">{t("allowance.releaseDraw")}</option>
          </select>
        </Field>
        <Field label={t("allowance.resolveNoteLabel")} htmlFor="resolve-note" error={formState.errors.note?.message}>
          <Textarea id="resolve-note" rows={3} {...register("note", { required: t("allowance.resolveNoteRequired"), maxLength: 2000 })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("allowance.resolveSubmit")}</Button>
      </form>
    </Dialog>
  );
}

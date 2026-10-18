import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { ApiKeyView, WebhookDeliveryView, WebhookView } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Spinner } from "./ui.js";

function staffOnly(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** Scope picker options. The API validates against the contract enum; unknown entries are rejected. */
const SCOPES: string[] = [
  "org.view", "org.manage", "org.invite", "org.members.manage", "org.usage.view", "org.branding.manage",
  "client.manage", "project.create", "project.view", "project.manage", "project.members.manage",
  "scope.view", "scope.draft", "scope.publish", "requirement.status",
  "change.submit", "acceptance.send", "change.triage", "change.estimate", "change.send",
  "change.implement", "change.convert",
  "approval.view", "approval.decide", "bundle.manage",
  "note.create", "evidence.attach", "evidence.verify", "file.upload", "file.download",
  "ai.use", "ai.review", "activity.view", "health.view", "export.read", "external.manage",
  "ratecard.view", "ratecard.manage", "allowance.manage", "allowance.object",
  "intake.manage", "notifications.view", "*",
];

const EVENTS: string[] = ["approval.sent", "approval.decided", "approval.expired", "approval.escalated", "acceptance.deemed"];

function SecretDialog({ title, warning, secret, onClose }: { title: string; warning: string; secret: string; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">{warning}</p>
      <Input readOnly value={secret} aria-label={title} onFocus={(e) => e.target.select()} />
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void copy()}>{t("integrations.copySecret")}</Button>
        <Button size="sm" variant="primary" onClick={onClose}>{t("integrations.close")}</Button>
        {copied ? <span className="text-sm text-slate-600" role="status">{t("integrations.copied")}</span> : null}
      </div>
    </Dialog>
  );
}

/** Org settings section: API key CRUD with one-time secrets (owners/admins manage). */
export function ApiKeysCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }): JSX.Element {
  const { t, date } = useLocale();
  const client = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys", organizationId], queryFn: () => api.get<ApiKeyView[]>(`/organizations/${organizationId}/api-keys`) });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "rotate" | "revoke" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function done(): void {
    setConfirm(null);
    setError(null);
    void client.invalidateQueries({ queryKey: ["api-keys", organizationId] });
  }
  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ key: ApiKeyView; secret: string }>(`/organizations/${organizationId}/api-keys/${id}/rotate`),
    onSuccess: (res) => { done(); setSecret(res.secret); },
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<ApiKeyView>(`/organizations/${organizationId}/api-keys/${id}`),
    onSuccess: () => done(),
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-medium">{t("integrations.apiKeys")}</h2>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>{t("integrations.newKey")}</Button> : null}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("integrations.apiKeysHint")}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {keys.isLoading ? <Spinner /> : keys.isError ? (
        staffOnly(keys.error) ? <p className="text-sm text-slate-600">{t("integrations.staffOnly")}</p> : <ErrorBanner message={errorMessage(keys.error)} />
      ) : (keys.data ?? []).length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(keys.data ?? []).map((key) => (
            <li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <span className="font-medium text-slate-900">{key.name}</span>{" "}
                <code className="rounded bg-slate-100 px-1 text-xs text-slate-700">{key.prefix}…</code>{" "}
                {key.revokedAt ? <Badge tone="rose">{t("integrations.revoked")}</Badge> : null}
                <div className="mt-1 text-sm text-slate-600">
                  {key.scopes.join(", ") || "—"}
                </div>
                <div className="text-xs text-slate-500">
                  {t("integrations.expires")}: {key.expiresAt ? date(key.expiresAt) : t("integrations.neverExpires")} · {t("integrations.lastUsed")}: {key.lastUsedAt ? date(key.lastUsedAt) : t("integrations.neverUsed")}
                </div>
              </div>
              {canManage && !key.revokedAt ? (
                <div className="flex gap-2">
                  {confirm?.id === key.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={rotate.isPending || revoke.isPending}
                        onClick={() => (confirm.kind === "rotate" ? rotate.mutate(key.id) : revoke.mutate(key.id))}
                      >
                        {confirm.kind === "rotate" ? t("integrations.rotate") : t("integrations.revoke")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>{t("integrations.cancel")}</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: key.id, kind: "rotate" })}>{t("integrations.rotate")}</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: key.id, kind: "revoke" })}>{t("integrations.revoke")}</Button>
                    </>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {confirm ? (
        <p className="mt-2 text-sm text-slate-600" role="status">
          {confirm.kind === "rotate" ? t("integrations.rotateConfirm") : t("integrations.revokeConfirm")}
        </p>
      ) : null}
      {creating ? <KeyForm organizationId={organizationId} onSecret={(s) => { setCreating(false); setSecret(s); }} onClose={() => setCreating(false)} /> : null}
      {secret ? (
        <SecretDialog title={t("integrations.secretTitle")} warning={t("integrations.secretWarning")} secret={secret} onClose={() => setSecret(null)} />
      ) : null}
    </Card>
  );
}

function KeyForm({ organizationId, onSecret, onClose }: { organizationId: string; onSecret: (secret: string) => void; onClose: () => void }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("");
  const [scopes, setScopes] = useState<string[]>(["project.view"]);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () =>
      api.post<{ key: ApiKeyView; secret: string }>(`/organizations/${organizationId}/api-keys`, {
        name: name.trim(),
        scopes,
        expiresAt: expires === "" ? null : new Date(expires).toISOString(),
      }),
    onSuccess: (res) => {
      void client.invalidateQueries({ queryKey: ["api-keys", organizationId] });
      onSecret(res.secret);
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function toggle(scope: string): void {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }
  return (
    <Dialog title={t("integrations.newKey")} onClose={onClose} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() === "" || scopes.length === 0) {
            setError(t("common.error"));
            return;
          }
          create.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t("integrations.keyName")} htmlFor="api-key-name">
          <Input id="api-key-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={1} maxLength={80} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t("integrations.keyScopes")}</legend>
          <div className="grid max-h-48 grid-cols-1 gap-1 overflow-y-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
            {SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={scopes.includes(scope)} onChange={() => toggle(scope)} />
                <code className="text-xs">{scope}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={t("integrations.keyExpires")} hint={t("integrations.keyExpiresHint")} htmlFor="api-key-expires">
          <Input id="api-key-expires" type="datetime-local" value={expires} onChange={(e) => setExpires(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={create.isPending}>{t("integrations.createKey")}</Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>{t("integrations.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Org settings section: outgoing webhook subscriptions + delivery log (owners/admins manage). */
export function WebhooksCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const hooks = useQuery({ queryKey: ["webhooks", organizationId], queryFn: () => api.get<WebhookView[]>(`/organizations/${organizationId}/webhooks`) });
  const [editing, setEditing] = useState<WebhookView | "new" | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "delete" | "rotate" } | null>(null);
  const [openLog, setOpenLog] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function done(): void {
    setConfirm(null);
    setError(null);
    void client.invalidateQueries({ queryKey: ["webhooks", organizationId] });
  }
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/organizations/${organizationId}/webhooks/${id}`),
    onSuccess: () => done(),
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api.post<{ webhook: WebhookView; secret: string }>(`/organizations/${organizationId}/webhooks/${id}/rotate-secret`),
    onSuccess: (res) => { done(); setSecret(res.secret); },
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="font-medium">{t("integrations.webhooks")}</h2>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>{t("integrations.newWebhook")}</Button> : null}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("integrations.webhooksHint")}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {hooks.isLoading ? <Spinner /> : hooks.isError ? (
        staffOnly(hooks.error) ? <p className="text-sm text-slate-600">{t("integrations.staffOnly")}</p> : <ErrorBanner message={errorMessage(hooks.error)} />
      ) : (hooks.data ?? []).length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(hooks.data ?? []).map((hook) => (
            <li key={hook.id} className="py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="break-all font-medium text-slate-900">{hook.url}</span>{" "}
                  {hook.enabled ? <Badge tone="teal">{t("integrations.webhookEnabled")}</Badge> : <Badge tone="slate">{t("integrations.webhookEnabled")}: off</Badge>}
                  <div className="mt-1 text-sm text-slate-600">{hook.events.join(", ")}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setOpenLog(openLog === hook.id ? null : hook.id)}>
                    {t("integrations.deliveries")}
                  </Button>
                  {canManage ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(hook)}>{t("integrations.edit")}</Button>
                      {confirm?.id === hook.id ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={remove.isPending || rotate.isPending}
                            onClick={() => (confirm.kind === "delete" ? remove.mutate(hook.id) : rotate.mutate(hook.id))}
                          >
                            {confirm.kind === "delete" ? t("integrations.delete") : t("integrations.rotateSecret")}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>{t("integrations.cancel")}</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: hook.id, kind: "rotate" })}>{t("integrations.rotateSecret")}</Button>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: hook.id, kind: "delete" })}>{t("integrations.delete")}</Button>
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              </div>
              {confirm?.id === hook.id ? (
                <p className="mt-2 text-sm text-slate-600" role="status">
                  {confirm.kind === "delete" ? t("integrations.deleteConfirm") : t("integrations.rotateSecretConfirm")}
                </p>
              ) : null}
              {openLog === hook.id ? <DeliveryLog organizationId={organizationId} hookId={hook.id} /> : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <WebhookForm
          organizationId={organizationId}
          initial={editing === "new" ? null : editing}
          onDone={() => { setEditing(null); done(); }}
          onClose={() => setEditing(null)}
          onSecret={(s) => { setEditing(null); done(); setSecret(s); }}
        />
      ) : null}
      {secret ? (
        <SecretDialog title={t("integrations.secretTitle")} warning={t("integrations.secretWarning")} secret={secret} onClose={() => setSecret(null)} />
      ) : null}
    </Card>
  );
}

function WebhookForm({ organizationId, initial, onDone, onClose, onSecret }: {
  organizationId: string;
  initial: WebhookView | null;
  onDone: () => void;
  onClose: () => void;
  onSecret: (secret: string) => void;
}): JSX.Element {
  const { t } = useLocale();
  const [url, setUrl] = useState(initial?.url ?? "");
  const [events, setEvents] = useState<string[]>(initial?.events ?? ["approval.decided"]);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (): Promise<{ secret: string } | null> => {
      if (initial) {
        await api.patch<WebhookView>(`/organizations/${organizationId}/webhooks/${initial.id}`, { url: url.trim(), events, enabled });
        return null;
      }
      return api.post<{ webhook: WebhookView; secret: string }>(`/organizations/${organizationId}/webhooks`, { url: url.trim(), events, enabled });
    },
    onSuccess: (res) => {
      if (res) onSecret(res.secret);
      else onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  function toggle(event: string): void {
    setEvents((prev) => (prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]));
  }
  return (
    <Dialog title={initial ? t("integrations.editWebhook") : t("integrations.newWebhook")} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim() === "" || events.length === 0) {
            setError(t("common.error"));
            return;
          }
          save.mutate();
        }}
      >
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t("integrations.webhookUrl")} hint={t("integrations.webhookUrlHint")} htmlFor="webhook-url">
          <Input id="webhook-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required maxLength={2000} placeholder="https://example.com/scopelock-events" />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t("integrations.webhookEvents")}</legend>
          <div className="space-y-1">
            {EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={events.includes(event)} onChange={() => toggle(event)} />
                <code className="text-xs">{event}</code>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          {t("integrations.webhookEnabled")}
        </label>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
            {initial ? t("integrations.saveWebhook") : t("integrations.createWebhook")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>{t("integrations.cancel")}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeliveryLog({ organizationId, hookId }: { organizationId: string; hookId: string }): JSX.Element {
  const { t, date } = useLocale();
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<WebhookDeliveryView[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(after: string | null): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const page = await api.get<{ items: WebhookDeliveryView[]; nextCursor: string | null }>(
        `/organizations/${organizationId}/webhooks/${hookId}/deliveries?limit=20${after ? `&cursor=${encodeURIComponent(after)}` : ""}`,
      );
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setNext(page.nextCursor);
      setCursor(after);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  async function replay(id: string): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await api.post(`/organizations/${organizationId}/webhooks/${hookId}/deliveries/${id}/replay`);
      setNotice(t("integrations.replayQueued"));
      await load(cursor);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    void load(null);
  }, [hookId]);

  if (loading && items.length === 0) return <Spinner />;
  return (
    <div className="mt-2 rounded-md border border-slate-200 p-3">
      <h3 className="text-sm font-medium text-slate-900">{t("integrations.deliveries")}</h3>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <p className="text-sm text-slate-600" role="status">{notice}</p> : null}
      {items.length === 0 ? (
        <p className="text-sm text-slate-600">{t("integrations.noDeliveries")}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-1 text-sm">
              <span>
                <code className="text-xs">{d.event}</code>{" "}
                <Badge tone={d.status === "SENT" ? "teal" : d.status === "PENDING" ? "slate" : "rose"}>{d.status}</Badge>{" "}
                <span className="text-xs text-slate-500">
                  {d.attempts} {t("integrations.attempts")} · {date(d.createdAt)}
                  {d.responseStatus ? ` · HTTP ${d.responseStatus}` : ""}{d.lastError ? ` · ${d.lastError}` : ""}
                </span>
              </span>
              <Button size="sm" variant="secondary" onClick={() => void replay(d.id)}>{t("integrations.replay")}</Button>
            </li>
          ))}
        </ul>
      )}
      {next ? <Button size="sm" variant="secondary" onClick={() => void load(next)}>{t("integrations.loadMore")}</Button> : null}
    </div>
  );
}

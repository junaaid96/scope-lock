import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage, fetchAll } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { ExternalConnectionView, ExternalWorkItemView, ProjectDetail } from "../lib/types.js";
import { Badge, Button, Card, Empty, ErrorBanner, Spinner } from "./ui.js";
import { SecretDialog } from "./integrations-settings.js";

function staffOnly(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

/** Project Integrations tab: GitHub connection management (staff) + observed work. */
export function IntegrationsTab({ project, canManage }: { project: ProjectDetail; canManage: boolean }): JSX.Element {
  const { t, date } = useLocale();
  const client = useQueryClient();
  const connections = useQuery({
    queryKey: ["external-connections", project.id],
    queryFn: () => api.get<ExternalConnectionView[]>(`/projects/${project.id}/external-connections`),
  });
  const work = useQuery({
    queryKey: ["external-work", project.id],
    queryFn: () => fetchAll<ExternalWorkItemView>(`/projects/${project.id}/external-work`),
  });
  const [secret, setSecret] = useState<{ value: string; webhookUrl?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; kind: "rotate" | "delete" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function done(): void {
    setConfirm(null);
    setError(null);
    void client.invalidateQueries({ queryKey: ["external-connections", project.id] });
  }

  const optIn = useMutation({
    mutationFn: (enabled: boolean) => api.patch(`/projects/${project.id}`, { externalIntegrationsEnabled: enabled }),
    onSuccess: () => {
      setError(null);
      void client.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const connect = useMutation({
    mutationFn: () =>
      api.post<{ connection: ExternalConnectionView; secret: string; webhookUrl: string }>(
        `/projects/${project.id}/external-connections`,
        { provider: "GITHUB" },
      ),
    onSuccess: (res) => {
      done();
      setSecret({ value: res.secret, webhookUrl: res.webhookUrl });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const rotate = useMutation({
    mutationFn: (id: string) =>
      api.post<{ connection: ExternalConnectionView; secret: string }>(
        `/projects/${project.id}/external-connections/${id}/rotate-secret`,
      ),
    onSuccess: (res) => {
      done();
      setSecret({ value: res.secret });
    },
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<ExternalConnectionView>(`/projects/${project.id}/external-connections/${id}`, { enabled }),
    onSuccess: () => done(),
    onError: (err) => setError(errorMessage(err)),
  });
  const disconnect = useMutation({
    mutationFn: (id: string) => api.delete<{ ok: boolean }>(`/projects/${project.id}/external-connections/${id}`),
    onSuccess: () => done(),
    onError: (err) => { setConfirm(null); setError(errorMessage(err)); },
  });

  const connected = (connections.data ?? []).find((c) => c.provider === "GITHUB") ?? null;

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="mb-1 font-medium">{t("github.title")}</h2>
        <p className="mb-3 text-sm text-slate-600">{t("github.hint")}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {canManage ? (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={project.externalIntegrationsEnabled}
              disabled={optIn.isPending}
              onChange={(e) => optIn.mutate(e.target.checked)}
            />
            <span>
              {t("github.optIn")}
              <span className="block text-xs text-slate-500">{t("github.optInHint")}</span>
            </span>
          </label>
        ) : null}
        <div className="mt-3">
          {connections.isLoading ? <Spinner /> : connections.isError ? (
            staffOnly(connections.error) ? <p className="text-sm text-slate-600">{t("github.staffOnly")}</p> : <ErrorBanner message={errorMessage(connections.error)} />
          ) : !connected ? (
            canManage ? (
              <Button size="sm" variant="secondary" disabled={!project.externalIntegrationsEnabled || connect.isPending} onClick={() => connect.mutate()}>
                {t("github.connect")}
              </Button>
            ) : <Empty title={t("common.empty")} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-slate-900">GitHub</span>{" "}
                {connected.enabled ? <Badge tone="teal">{t("github.connected")}</Badge> : <Badge tone="slate">{t("github.disabled")}</Badge>}
                <div className="text-xs text-slate-500">{t("github.webhookUrlHint")}</div>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" disabled={toggle.isPending} onClick={() => toggle.mutate({ id: connected.id, enabled: !connected.enabled })}>
                    {connected.enabled ? t("github.disable") : t("github.enable")}
                  </Button>
                  {confirm?.id === connected.id ? (
                    <>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={rotate.isPending || disconnect.isPending}
                        onClick={() => (confirm.kind === "rotate" ? rotate.mutate(connected.id) : disconnect.mutate(connected.id))}
                      >
                        {confirm.kind === "rotate" ? t("github.rotateSecret") : t("github.disconnect")}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm(null)}>{t("github.cancel")}</Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: connected.id, kind: "rotate" })}>{t("github.rotateSecret")}</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirm({ id: connected.id, kind: "delete" })}>{t("github.disconnect")}</Button>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          )}
          {confirm ? (
            <p className="mt-2 text-sm text-slate-600" role="status">
              {confirm.kind === "rotate" ? t("github.rotateSecretConfirm") : t("github.disconnectConfirm")}
            </p>
          ) : null}
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 font-medium">{t("github.work")}</h2>
        {work.isLoading ? <Spinner /> : work.isError ? (
          <ErrorBanner message={errorMessage(work.error)} />
        ) : (work.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">{t("github.noWork")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(work.data ?? []).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  {item.url ? (
                    <a className="font-medium text-teal-800 underline" href={item.url} target="_blank" rel="noreferrer">{item.externalId}</a>
                  ) : (
                    <span className="font-medium text-slate-900">{item.externalId}</span>
                  )}{" "}
                  {item.merged ? <Badge tone="teal">{t("github.merged")}</Badge> : <Badge tone="slate">{t("github.open")}</Badge>}
                  <div className="text-slate-600">{item.title ?? "—"}</div>
                  <div className="text-xs text-slate-500">
                    {item.kind} · {item.refs.length > 0 ? item.refs.join(", ") : t("github.noRefs")} · {date(item.observedAt)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {secret ? (
        <SecretDialog
          title={t("github.secretTitle")}
          warning={t("github.secretWarning")}
          secret={secret.value}
          onClose={() => setSecret(null)}
          extra={secret.webhookUrl ? { label: t("github.webhookUrl"), value: secret.webhookUrl } : undefined}
        />
      ) : null}
    </div>
  );
}

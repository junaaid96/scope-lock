import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { ActivityEvent, AiAnalysisRow, AuditVerifyResult } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Button, Card, Empty, ErrorBanner, Input, PageTitle, Spinner, formatDate } from "../components/ui.js";
import { useLocale } from "../lib/i18n/index.js";

export function ActivityPage(): JSX.Element {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const projectId = id as string;
  const activity = useQuery({
    queryKey: ["activity", projectId],
    queryFn: () => fetchAll<ActivityEvent>(`/projects/${projectId}/activity`),
    refetchInterval: 30_000,
  });

  if (activity.isLoading) return <Spinner />;
  if (activity.isError) return <ErrorBanner message={errorMessage(activity.error)} />;
  const events = activity.data ?? [];

  return (
    <div>
      <PageTitle
        title={t("activity.title")}
        subtitle={t("activity.subtitle")}
      />
      <ProjectSubnav projectId={projectId} />
      {events.length === 0 ? <Empty title={t("activity.emptyTitle")} /> : (
        <Card>
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="border-b border-slate-100 pb-2 text-sm last:border-0">
                <p>
                  <span className="font-medium">{prettyAction(e.action)}</span>{" "}
                  <RecordLink projectId={projectId} targetType={e.targetType} targetId={e.targetId} />
                </p>
                <p className="text-xs text-slate-500">{e.actorEmail ?? t("activity.systemActor")} · {formatDate(e.createdAt)}</p>
                <Transition before={e.before} after={e.after} />
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <ChainIntegrity projectId={projectId} />
        <DecisionSearch projectId={projectId} />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-2">
        <AiLog projectId={projectId} />
      </div>
    </div>
  );
}

function ChainIntegrity({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const [asked, setAsked] = useState(false);
  const check = useQuery({
    queryKey: ["audit-verify", projectId],
    queryFn: () => api.get<AuditVerifyResult>(`/projects/${projectId}/audit/verify`),
    enabled: asked,
  });
  const result = check.data;
  return (
    <Card>
      <h2 className="mb-1 font-medium">{t("activity.integrityTitle")}</h2>
      <p className="mb-2 text-xs text-slate-500">
        {t("activity.integrityBody")}
      </p>
      <Button size="sm" disabled={check.isFetching} onClick={() => { setAsked(true); void check.refetch(); }}>
        {check.isFetching ? t("activity.verifying") : t("activity.verifyChain")}
      </Button>
      {check.isError ? <ErrorBanner message={errorMessage(check.error)} /> : null}
      {result ? (
        <div className="mt-3 text-sm" role="status">
          {result.valid ? (
            <p><Badge tone="green">{t("activity.chainValid")}</Badge></p>
          ) : (
            <p>
              <Badge tone="red">{t("activity.chainBroken")}</Badge>{" "}
              <span className="text-slate-700">
                {t("activity.chainBrokenAt", { seq: result.breakAtSeq ?? "", reason: result.reason ?? "" })}
              </span>
            </p>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {result.chained === 1 ? t("activity.chainedOne", { count: result.chained }) : t("activity.chainedMany", { count: result.chained })}
            {result.legacy > 0 ? t("activity.legacyEvents", { count: result.legacy }) : ""}
            {result.headHash ? t("activity.headHash", { hash: result.headHash.slice(0, 12) }) : t("activity.noChainedYet")}
            {t("activity.checkedAt", { date: formatDate(result.verifiedAt) })}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

function prettyAction(action: string): string {
  return action.replace(/\./g, " · ").replace(/_/g, " ");
}

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 10)}…` : id;
}

/** Deep-link every event to its primary record where the UI has a page for it. */
function RecordLink({ projectId, targetType, targetId }: { projectId: string; targetType: string; targetId: string }): JSX.Element {
  const label = `${targetType} ${shortId(targetId)}`;
  const to =
    targetType === "CHANGE"
      ? `/projects/${projectId}/changes/${targetId}`
      : targetType === "REQUIREMENT" || targetType === "SCOPE_VERSION" || targetType === "SCOPE_DOCUMENT" || targetType === "EVIDENCE"
        ? `/projects/${projectId}/scope`
        : targetType === "APPROVAL"
          ? "/inbox"
          : targetType === "PROJECT"
            ? `/projects/${projectId}`
            : null;
  if (!to) return <span className="text-slate-500">{label}</span>;
  return <Link className="text-teal-800 underline" to={to}>{label}</Link>;
}

interface DecisionHit {
  id: string;
  decision: string;
  comment: string | null;
  approverEmail: string | null;
  createdAt: string;
  changeRequestId: string | null;
  approvalTitle: string | null;
}

function DecisionSearch({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const results = useQuery({
    queryKey: ["decisions", projectId, submitted],
    queryFn: () => fetchAll<DecisionHit>(`/projects/${projectId}/decisions${submitted ? `?q=${encodeURIComponent(submitted)}` : ""}`),
  });
  return (
    <Card>
      <h2 className="mb-1 font-medium">{t("activity.decisionsTitle")}</h2>
      <p className="mb-2 text-xs text-slate-500">{t("activity.decisionsBody")}</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setSubmitted(q); }}>
        <Input aria-label={t("activity.searchDecisionsLabel")} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("activity.searchDecisionsPlaceholder")} />
        <Button size="sm" type="submit">{t("activity.searchButton")}</Button>
      </form>
      {results.isLoading ? <Spinner /> : (
        <ul className="mt-3 space-y-2">
          {(results.data ?? []).map((d) => (
            <li key={d.id} className="rounded-md bg-slate-50 p-2 text-sm">
              <Badge tone={d.decision === "APPROVED" ? "green" : d.decision === "REJECTED" ? "red" : "amber"}>{d.decision}</Badge>
              {" "}{d.approvalTitle ?? t("activity.reviewPackageFallback")}
              {d.comment ? <p className="mt-1 text-slate-700">{d.comment}</p> : null}
              <p className="mt-1 text-xs text-slate-500">
                {d.approverEmail ?? t("activity.systemActor")} · {formatDate(d.createdAt)}
                {d.changeRequestId ? <> · <Link className="underline" to={`/projects/${projectId}/changes/${d.changeRequestId}`}>{t("activity.openRequest")}</Link></> : null}
              </p>
            </li>
          ))}
          {(results.data ?? []).length === 0 ? <li className="text-sm text-slate-500">{t("activity.noDecisions")}</li> : null}
        </ul>
      )}
    </Card>
  );
}

function AiLog({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const log = useQuery({
    queryKey: ["ai-log", projectId],
    queryFn: () => fetchAll<AiAnalysisRow>(`/projects/${projectId}/ai/analyses`),
  });
  const review = useMutation({
    mutationFn: (vars: { id: string; disposition: string }) =>
      api.patch(`/projects/${projectId}/ai/analyses/${vars.id}`, { disposition: vars.disposition }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["ai-log", projectId] }),
  });
  return (
    <Card>
      <h2 className="mb-1 font-medium">{t("activity.aiLogTitle")}</h2>
      <p className="mb-2 text-xs text-slate-500">{t("activity.aiLogBody")}</p>
      {log.isLoading ? <Spinner /> : log.isError ? (
        <ErrorBanner message={errorMessage(log.error)} />
      ) : (log.data ?? []).length === 0 ? (
        <Empty title={t("activity.aiEmptyTitle")} />
      ) : (
        <ul className="space-y-2">
          {(log.data ?? []).slice(0, 20).map((a) => (
            <li key={a.id} className="rounded-md bg-slate-50 p-2 text-sm">
              <p>
                <Badge>{a.kind}</Badge> <span className="text-xs text-slate-500">{a.model} · {a.status} · {formatDate(a.createdAt)}{a.usage ? t("activity.tokensUsed", { count: a.usage.totalTokens }) : ""}</span>
              </p>
              {a.error ? <p className="mt-1 text-xs text-red-700">{a.error}</p> : null}
              <p className="mt-1 text-xs">
                {a.reviewerDisposition ? (
                  <span className="text-slate-600">{t("activity.reviewedAs", { d: a.reviewerDisposition })}</span>
                ) : (
                  <span className="flex gap-1">
                    {(["ACCEPTED", "EDITED", "DISMISSED"] as const).map((d) => (
                      <Button key={d} size="sm" variant="ghost" disabled={review.isPending} onClick={() => review.mutate({ id: a.id, disposition: d })}>
                        {d}
                      </Button>
                    ))}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Transition({ before, after }: { before?: unknown; after?: unknown }): JSX.Element | null {
  const b = before as Record<string, unknown> | undefined;
  const a = after as Record<string, unknown> | undefined;
  if (!b && !a) return null;
  if (b?.status !== undefined || a?.status !== undefined) {
    return <p className="text-xs text-slate-600">{String(b?.status ?? "?")} → {String(a?.status ?? "?")}</p>;
  }
  const keys = [...new Set([...Object.keys(b ?? {}), ...Object.keys(a ?? {})])].slice(0, 4);
  if (keys.length === 0) return null;
  return (
    <p className="text-xs text-slate-500">
      {keys.map((k) => `${k}: ${JSON.stringify((a ?? {})[k] ?? (b ?? {})[k])}`).join(" · ")}
    </p>
  );
}

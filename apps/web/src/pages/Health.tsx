import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import type { ScopeHealth } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Card, ErrorBanner, PageTitle, Spinner, PageSkeleton } from "../components/ui.js";
import { useLocale } from "../lib/i18n/index.js";

export function HealthPage(): JSX.Element {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const projectId = id as string;
  function aiAcceptance(value: unknown): string {
    const v = value as { reviewed?: number; acceptRate?: number | null } | null;
    if (!v || typeof v.acceptRate !== "number") return v?.reviewed === 0 ? t("health.aiNoReviews") : "—";
    return t("health.aiReviewed", { pct: Math.round(v.acceptRate * 100), count: v.reviewed ?? 0 });
  }
  const health = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => api.get<ScopeHealth>(`/projects/${projectId}/health`),
  });
  const metrics = useQuery({
    queryKey: ["metrics", projectId],
    queryFn: () => api.get<Record<string, unknown>>(`/projects/${projectId}/metrics`),
  });

  if (health.isLoading) return <PageSkeleton />;
  if (health.isError) return <ErrorBanner message={errorMessage(health.error)} />;
  const h = health.data as ScopeHealth;

  return (
    <div>
      <PageTitle
        title={t("health.title")}
        subtitle={t("health.subtitle")}
      />
      <ProjectSubnav projectId={projectId} />
      <Card className="overflow-hidden p-0">
        <div className="bg-aurora flex flex-wrap items-center gap-6 p-6">
          <ScoreRing score={h.score} label={t("health.scoreLabel", { score: h.score })} />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold tracking-tight text-slate-900">{h.summary}</p>
          </div>
        </div>
        <ul className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-2">
          {h.signals.map((s) => (
            <li key={s.key} className="flex items-start justify-between gap-3 bg-surface p-4">
              <div>
                <p className="text-sm font-semibold text-slate-900">{s.label}</p>
                <p className="mt-0.5 text-sm text-slate-600">{s.detail}</p>
              </div>
              <Badge tone={s.count === 0 ? "green" : "amber"}>{s.count}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-5">
        <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("health.metricsTitle")}</h2>
        {metrics.isLoading ? <Spinner /> : metrics.isError ? (
          <p className="text-sm text-red-700">{errorMessage(metrics.error)}</p>
        ) : (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricBaselines")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{String((metrics.data as Record<string, unknown>).baselinesPublished ?? "—")}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricCompletion")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{pct((metrics.data as Record<string, unknown>).changeCompletionRate)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricMedian")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{(metrics.data as Record<string, unknown>).medianSubmitToDecisionHours !== null && (metrics.data as Record<string, unknown>).medianSubmitToDecisionHours !== undefined ? t("health.hoursValue", { hours: String((metrics.data as Record<string, unknown>).medianSubmitToDecisionHours) }) : "—"}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricLinked")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{pct((metrics.data as Record<string, unknown>).linkedToBaselineRate)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricInvalidation")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{pct((metrics.data as Record<string, unknown>).approvalInvalidationRate)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricNoClarification")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{pct((metrics.data as Record<string, unknown>).approvedWithoutClarificationRate)}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-slate-200">
              <dt className="text-xs font-medium text-slate-500">{t("health.metricAiAcceptance")}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-slate-900">{aiAcceptance((metrics.data as Record<string, unknown>).aiSuggestionReview)}</dd>
            </div>
          </dl>
        )}
      </Card>
    </div>
  );
}

function pct(value: unknown): string {
  if (typeof value !== "number") return "—";
  return `${Math.round(value * 100)}%`;
}



/** Circular 0-5 score gauge. */
function ScoreRing({ score, label }: { score: number; label: string }): JSX.Element {
  const r = 38;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 5));
  return (
    <div className="relative size-24 shrink-0">
      <svg viewBox="0 0 100 100" className="size-24 -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" className="stroke-slate-200" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} className="stroke-teal-500 transition-[stroke-dasharray] duration-700" />
      </svg>
      <span aria-label={label} className="absolute inset-0 flex items-center justify-center text-3xl font-semibold tracking-tight text-slate-900">
        {score}
        <span className="text-base text-slate-400">/5</span>
      </span>
    </div>
  );
}

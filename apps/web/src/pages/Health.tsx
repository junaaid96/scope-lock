import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import type { ScopeHealth } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Card, ErrorBanner, PageTitle, Spinner } from "../components/ui.js";

export function HealthPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const projectId = id as string;
  const health = useQuery({
    queryKey: ["health", projectId],
    queryFn: () => api.get<ScopeHealth>(`/projects/${projectId}/health`),
  });
  const metrics = useQuery({
    queryKey: ["metrics", projectId],
    queryFn: () => api.get<Record<string, unknown>>(`/projects/${projectId}/metrics`),
  });

  if (health.isLoading) return <Spinner />;
  if (health.isError) return <ErrorBanner message={errorMessage(health.error)} />;
  const h = health.data as ScopeHealth;

  return (
    <div>
      <PageTitle
        title="Scope health"
        subtitle="Explainable signals — every input is listed, never a black-box score."
      />
      <ProjectSubnav projectId={projectId} />
      <Card>
        <div className="flex items-center gap-3">
          <span aria-label={`Health score ${h.score} of 5`} className="text-3xl font-semibold">{h.score}<span className="text-lg text-slate-400">/5</span></span>
          <p className="text-sm text-slate-700">{h.summary}</p>
        </div>
        <ul className="mt-4 space-y-3">
          {h.signals.map((s) => (
            <li key={s.key} className="flex items-start justify-between gap-3 border-t border-slate-100 pt-3">
              <div>
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-sm text-slate-600">{s.detail}</p>
              </div>
              <Badge tone={s.count === 0 ? "green" : "amber"}>{s.count}</Badge>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-5">
        <h2 className="mb-2 font-medium">Delivery metrics</h2>
        {metrics.isLoading ? <Spinner /> : metrics.isError ? (
          <p className="text-sm text-red-700">{errorMessage(metrics.error)}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-slate-500">Baselines published</dt>
            <dd>{String((metrics.data as Record<string, unknown>).baselinesPublished ?? "—")}</dd>
            <dt className="text-slate-500">Change completion rate</dt>
            <dd>{pct((metrics.data as Record<string, unknown>).changeCompletionRate)}</dd>
            <dt className="text-slate-500">Median submit → decision</dt>
            <dd>{(metrics.data as Record<string, unknown>).medianSubmitToDecisionHours !== null && (metrics.data as Record<string, unknown>).medianSubmitToDecisionHours !== undefined ? `${String((metrics.data as Record<string, unknown>).medianSubmitToDecisionHours)}h` : "—"}</dd>
            <dt className="text-slate-500">Linked to baseline</dt>
            <dd>{pct((metrics.data as Record<string, unknown>).linkedToBaselineRate)}</dd>
            <dt className="text-slate-500">Approval invalidation rate</dt>
            <dd>{pct((metrics.data as Record<string, unknown>).approvalInvalidationRate)}</dd>
            <dt className="text-slate-500">Approved without clarification</dt>
            <dd>{pct((metrics.data as Record<string, unknown>).approvedWithoutClarificationRate)}</dd>
            <dt className="text-slate-500">AI suggestion acceptance</dt>
            <dd>{aiAcceptance((metrics.data as Record<string, unknown>).aiSuggestionReview)}</dd>
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

function aiAcceptance(value: unknown): string {
  const v = value as { reviewed?: number; acceptRate?: number | null } | null;
  if (!v || typeof v.acceptRate !== "number") return v?.reviewed === 0 ? "no reviews yet" : "—";
  return `${Math.round(v.acceptRate * 100)}% of ${v.reviewed} reviewed`;
}

import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { ChangeDetail, ChangeListItem, ScopeVersion } from "../lib/types.js";
import { ProjectSubnav } from "../components/layout.js";
import { Badge, Card, Empty, ErrorBanner, PageTitle, Spinner, formatDate } from "../components/ui.js";

type EntryKind = "milestone" | "change" | "approval" | "decision";

interface Entry {
  id: string;
  kind: EntryKind;
  at: string;
  title: string;
  detail?: string;
  tone: "green" | "blue" | "amber" | "red" | "slate";
  to: string;
}

const KIND_LABEL: Record<EntryKind, string> = {
  milestone: "Milestones",
  change: "Changes",
  approval: "Approvals",
  decision: "Decisions",
};

const DOT: Record<Entry["tone"], string> = {
  green: "bg-emerald-500",
  blue: "bg-sky-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  slate: "bg-slate-400",
};

export function TimelinePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const projectId = id as string;
  const [filter, setFilter] = useState<EntryKind | "all">("all");

  const versions = useQuery({
    queryKey: ["versions", projectId],
    queryFn: () => fetchAll<ScopeVersion>(`/projects/${projectId}/scope-versions`),
  });
  const changes = useQuery({
    queryKey: ["changes", projectId],
    queryFn: () => fetchAll<ChangeListItem>(`/projects/${projectId}/change-requests`),
  });
  // One query fans out to change details (decisions + approvals live there).
  const details = useQuery({
    queryKey: ["timeline-details", projectId, (changes.data ?? []).map((c) => c.id).join(",")],
    queryFn: async () => {
      const out: ChangeDetail[] = [];
      for (const c of changes.data ?? []) out.push(await api.get<ChangeDetail>(`/change-requests/${c.id}`));
      return out;
    },
    enabled: !changes.isLoading && !changes.isError,
  });

  if (versions.isLoading || changes.isLoading) return <Spinner />;
  if (versions.isError) return <ErrorBanner message={errorMessage(versions.error)} />;
  if (changes.isError) return <ErrorBanner message={errorMessage(changes.error)} />;

  const entries: Entry[] = [];
  for (const v of versions.data ?? []) {
    if (v.status === "DRAFT" || !v.publishedAt) continue;
    entries.push({
      id: `v-${v.id}`,
      kind: "milestone",
      at: v.publishedAt,
      title: `Baseline v${v.sequence} published${v.title ? ` — ${v.title}` : ""}`,
      tone: v.status === "PUBLISHED" ? "green" : "slate",
      to: `/projects/${projectId}/scope`,
    });
  }
  for (const c of changes.data ?? []) entries.push({
    id: `c-${c.id}`,
    kind: "change",
    at: c.createdAt,
    title: `${c.number} submitted — ${c.title}`,
    tone: "blue",
    to: `/projects/${projectId}/changes/${c.id}`,
  });
  for (const d of details.data ?? []) {
    for (const a of d.approvals.filter((x) => x.sentAt)) {
      entries.push({
        id: `a-${a.id}`,
        kind: "approval",
        at: a.sentAt as string,
        title: `Review sent — ${a.title ?? d.number}`,
        detail: `expires ${formatDate(a.expiresAt)}`,
        tone: "amber",
        to: `/projects/${projectId}/changes/${d.id}`,
      });
    }
    if (d.decidedAt && d.decisions.length > 0) {
      const first = d.decisions[0] as { decision: string; approverEmail: string | null };
      entries.push({
        id: `d-${d.id}`,
        kind: "decision",
        at: d.decidedAt,
        title: `${d.number} decided — ${first.decision}`,
        detail: first.approverEmail ? `by ${first.approverEmail}` : undefined,
        tone: first.decision === "APPROVED" ? "green" : "red",
        to: `/projects/${projectId}/changes/${d.id}`,
      });
    }
  }
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const visible = filter === "all" ? entries : entries.filter((e) => e.kind === filter);
  const milestones = entries.filter((e) => e.kind === "milestone").reverse();

  return (
    <div>
      <PageTitle title="Timeline" subtitle="Baselines, changes, review packages, and decisions in chronological order." />
      <ProjectSubnav projectId={projectId} />

      {milestones.length > 0 ? (
        <Card className="mb-5">
          <ol className="flex flex-wrap items-center gap-2" aria-label="Baseline milestones">
            {milestones.map((m, i) => (
              <li key={m.id} className="flex items-center gap-2">
                {i > 0 ? <span aria-hidden="true" className="text-slate-300">→</span> : null}
                <Link
                  to={m.to}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-800 hover:border-teal-600"
                >
                  {m.title.split(" — ")[0]} · {formatDate(m.at)}
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filter timeline">
        {(["all", "milestone", "change", "approval", "decision"] as const).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === k ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {k === "all" ? "All" : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      {details.isLoading ? <Spinner /> : visible.length === 0 ? (
        <Empty title="Nothing on the timeline yet" hint="Publish a baseline or submit a change request to start the story." />
      ) : (
        <ol className="relative space-y-1 border-l-2 border-slate-200 pl-0">
          {visible.map((e) => (
            <li key={e.id} className="relative flex gap-3 py-2.5 pl-6">
              <span aria-hidden="true" className={`absolute left-0 top-4 h-2.5 w-2.5 -translate-x-[7px] rounded-full ${DOT[e.tone]}`} />
              <div className="min-w-0 flex-1">
                <Link to={e.to} className="text-sm font-medium text-slate-900 hover:text-teal-800">
                  {e.title}
                </Link>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{formatDate(e.at)}</span>
                  {e.detail ? <span>· {e.detail}</span> : null}
                  <Badge tone={e.tone === "blue" ? "blue" : e.tone === "amber" ? "amber" : e.tone === "red" ? "red" : e.tone === "green" ? "green" : "slate"}>
                    {KIND_LABEL[e.kind].replace(/s$/, "")}
                  </Badge>
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

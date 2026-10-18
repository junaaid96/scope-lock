/**
 * Kanban board for change requests: columns per workflow stage with
 * drag-and-drop plus an accessible per-card "Move to" control.
 * Moves use the same manual transitions the API enforces.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import type { ChangeListItem } from "../lib/types.js";
import { Badge, Empty, ErrorBanner, Spinner, formatMoney, statusTone } from "./ui.js";

interface Column {
  id: string;
  title: string;
  hint?: string;
  statuses: string[];
  /** Status a dropped card resolves to (null = drops rejected with guidance). */
  dropTo: string | null;
}

const COLUMNS: Column[] = [
  { id: "triage", title: "Triage", statuses: ["DRAFT", "SUBMITTED", "TRIAGING", "NEEDS_CLARIFICATION"], dropTo: "TRIAGING" },
  { id: "estimating", title: "Estimating", statuses: ["ESTIMATING"], dropTo: "ESTIMATING" },
  { id: "pending", title: "Pending approval", hint: "via Send for approval", statuses: ["PENDING_APPROVAL"], dropTo: null },
  { id: "approved", title: "Approved", hint: "via client decision", statuses: ["APPROVED"], dropTo: null },
  { id: "implemented", title: "Implemented", statuses: ["IMPLEMENTED"], dropTo: "IMPLEMENTED" },
  { id: "parked", title: "Parked", hint: "shelved — revive via Move to", statuses: ["PARKED"], dropTo: "PARKED" },
  { id: "closed", title: "Closed", statuses: ["REJECTED", "WITHDRAWN"], dropTo: "WITHDRAWN" },
];

/** Manual moves the API accepts (mirrors domain ChangeTransitions minus decision-driven targets). */
const MANUAL_MOVES: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "PARKED", "WITHDRAWN"],
  SUBMITTED: ["TRIAGING", "NEEDS_CLARIFICATION", "PARKED", "WITHDRAWN"],
  TRIAGING: ["ESTIMATING", "NEEDS_CLARIFICATION", "SUBMITTED", "PARKED", "WITHDRAWN"],
  NEEDS_CLARIFICATION: ["TRIAGING", "ESTIMATING", "PARKED", "WITHDRAWN"],
  ESTIMATING: ["TRIAGING", "NEEDS_CLARIFICATION", "PARKED", "WITHDRAWN"],
  PENDING_APPROVAL: ["ESTIMATING", "NEEDS_CLARIFICATION", "WITHDRAWN"],
  APPROVED: ["IMPLEMENTED", "WITHDRAWN"],
  REJECTED: ["ESTIMATING", "PARKED", "WITHDRAWN"],
  PARKED: ["DRAFT", "SUBMITTED", "WITHDRAWN"],
  WITHDRAWN: ["DRAFT"],
  IMPLEMENTED: [],
};

export function ChangeBoard({ projectId, changes, loading }: { projectId: string; changes: ChangeListItem[]; loading: boolean }): JSX.Element {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const refresh = (): void => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["changes", projectId] });
    void client.invalidateQueries({ queryKey: ["project", projectId] });
  };

  const moveStatus = useMutation({
    mutationFn: (args: { change: ChangeListItem; to: string }) =>
      api.patch(`/change-requests/${args.change.id}`, { expectedVersion: args.change.version, status: args.to }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const markImplemented = useMutation({
    mutationFn: (change: ChangeListItem) =>
      api.post(`/change-requests/${change.id}/implement`, { expectedVersion: change.version }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  const busy = moveStatus.isPending || markImplemented.isPending;

  const move = (change: ChangeListItem, to: string): void => {
    if (!(MANUAL_MOVES[change.status] ?? []).includes(to)) {
      const col = COLUMNS.find((c) => c.id === to || c.statuses.includes(to) || c.dropTo === to);
      setError(
        col?.hint
          ? `${change.number} can only reach ${col.title} ${col.hint}.`
          : `${change.number} cannot move from ${prettyStatus(change.status)} to ${prettyStatus(to)}.`,
      );
      return;
    }
    if (change.status === "APPROVED" && to === "IMPLEMENTED") markImplemented.mutate(change);
    else moveStatus.mutate({ change, to });
  };

  const onDropCard = (e: React.DragEvent, column: Column): void => {
    e.preventDefault();
    setDragOver(null);
    const id = e.dataTransfer.getData("text/change-id");
    const change = changes.find((c) => c.id === id);
    if (!change) return;
    if (!column.dropTo) {
      setError(column.hint ? `${change.number} can only reach ${column.title} ${column.hint}.` : `Cannot drop ${change.number} here.`);
      return;
    }
    if (change.status === column.dropTo) return;
    move(change, column.dropTo);
  };

  if (loading) return <Spinner />;
  if (changes.length === 0) {
    return <Empty title="No change requests" hint="When the client asks for something new, capture it here to assess it against the baseline." />;
  }

  return (
    <div>
      {error ? <div className="mb-3"><ErrorBanner message={error} /></div> : null}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map((col) => {
          const items = changes.filter((c) => col.statuses.includes(c.status));
          return (
            <section
              key={col.id}
              aria-label={`${col.title} (${items.length})`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(col.id); }}
              onDragLeave={() => setDragOver((v) => (v === col.id ? null : v))}
              onDrop={(e) => onDropCard(e, col)}
              className={`w-64 shrink-0 rounded-lg border p-2 transition-colors ${
                dragOver === col.id ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-slate-50"
              }`}
            >
              <header className="flex items-baseline justify-between px-1 pb-2">
                <h3 className="text-sm font-semibold text-slate-800">{col.title}</h3>
                <span className="text-xs text-slate-500">{items.length}</span>
              </header>
              {col.hint ? <p className="px-1 pb-2 text-xs text-slate-500">{col.hint}</p> : null}
              <ul className="space-y-2">
                {items.map((c) => (
                  <li
                    key={c.id}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/change-id", c.id)}
                    className="cursor-grab rounded-md border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing"
                  >
                    <Link to={`/projects/${projectId}/changes/${c.id}`} className="block font-medium text-slate-900 hover:text-teal-800">
                      {c.number}: {c.title}
                    </Link>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                      {c.impact?.priceMinor !== null && c.impact?.priceMinor !== undefined ? (
                        <span className="text-xs text-slate-600">{formatMoney(c.impact.priceMinor, c.impact.currency ?? "USD")}</span>
                      ) : null}
                    </div>
                    {(MANUAL_MOVES[c.status] ?? []).length > 0 ? (
                      <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                        Move to
                        <select
                          aria-label={`Move ${c.number} to another status`}
                          disabled={busy}
                          defaultValue=""
                          onChange={(e) => { if (e.target.value) move(c, e.target.value); e.target.value = ""; }}
                          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1 py-1 text-xs text-slate-800"
                        >
                          <option value="">Select…</option>
                          {(MANUAL_MOVES[c.status] ?? []).map((s) => (
                            <option key={s} value={s}>{prettyStatus(s)}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function prettyStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

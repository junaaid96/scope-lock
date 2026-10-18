import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import { Badge, Button, Card, ErrorBanner, Input } from "./ui.js";

export interface MemoryHit {
  approvalId: string;
  projectId: string;
  projectName: string;
  changeId: string | null;
  changeNumber: string | null;
  title: string;
  outcome: string;
  decidedAt: string;
  excerpt: string;
  link: string;
}

interface MemoryResponse {
  query: string;
  mode: "lexical" | "semantic";
  data: MemoryHit[];
}

/**
 * Decision memory: search decided approvals across the requester's projects.
 * Results carry verbatim excerpts and links only — never generated
 * conclusions. The server filters by project access before ranking.
 */
export function MemorySearchPanel({ organizationId }: { organizationId: string }): JSX.Element {
  const { t } = useLocale();
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState<MemoryResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await api.get<MemoryResponse>(
        `/organizations/${organizationId}/memory/search?q=${encodeURIComponent(q.trim())}`,
      );
      setSearched(res);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSearching(false);
    }
  };

  return (
    <Card className="mt-4">
      <form onSubmit={(e) => void run(e)} role="search" aria-label={t("memory.searchAria")}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="memory-q" className="text-sm font-medium text-slate-800">
            {t("memory.title")}
          </label>
          <Input
            id="memory-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("memory.placeholder")}
            className="min-w-0 flex-1"
            autoComplete="off"
          />
          <Button type="submit" size="sm" disabled={searching || q.trim().length < 2}>
            {searching ? t("memory.searching") : t("memory.search")}
          </Button>
        </div>
      </form>
      {error ? (
        <div className="mt-2">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      {searched !== null && !error ? (
        <div className="mt-3">
          <p className="text-xs text-slate-500" aria-live="polite">
            {searched.data.length === 0
              ? t("memory.noMatch", { query: searched.query })
              : searched.data.length === 1
                ? t("memory.oneResult", { mode: searched.mode })
                : t("memory.manyResults", { count: searched.data.length, mode: searched.mode })}
          </p>
          <ul className="mt-2 space-y-2">
            {searched.data.map((hit) => (
              <li key={hit.approvalId} className="rounded-md border border-slate-200 p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={hit.link}
                    className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                  >
                    {hit.changeNumber ? `${hit.changeNumber}: ` : ""}
                    {hit.title}
                  </Link>
                  <Badge tone={hit.outcome === "APPROVED" ? "green" : hit.outcome === "REJECTED" ? "red" : "slate"}>
                    {hit.outcome}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {hit.projectName} · {t("memory.decided", { date: new Date(hit.decidedAt).toLocaleDateString() })}
                </p>
                <p className="mt-1 text-sm text-slate-700">{hit.excerpt}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

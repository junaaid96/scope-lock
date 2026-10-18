import { useState } from "react";
import { errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import { Badge, Button, ErrorBanner } from "./ui.js";

export interface ScopeMatch {
  requirementId: string;
  stableKey: string;
  score: number;
  risk: "HIGH" | "MEDIUM" | "LOW";
  matchedTerms: string[];
  excerpt: string;
  explanation: string;
}

/**
 * Advisory pre-submission check: shows likely-covered baseline requirements
 * with excerpts. Never blocks — the caller keeps its own submit path
 * ("submit anyway") and receives the matched IDs for metrics.
 */
export function ScopeCheckPanel({ title, description, onCheck, onMatches }: {
  title: string;
  description: string;
  onCheck: (title: string, description: string) => Promise<{ deterministic: ScopeMatch[]; aiNote: string | null }>;
  onMatches: (requirementIds: string[]) => void;
}): JSX.Element {
  const { t } = useLocale();
  const [matches, setMatches] = useState<ScopeMatch[] | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setChecking(true);
    setError(null);
    try {
      const res = await onCheck(title, description);
      setMatches(res.deterministic);
      setAiNote(res.aiNote);
      onMatches(res.deterministic.map((m) => m.requirementId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800">{t("scopeCheck.title")}</p>
        <Button size="sm" variant="secondary" disabled={checking || title.trim().length === 0} onClick={() => void run()}>
          {checking ? t("scopeCheck.checking") : t("scopeCheck.check")}
        </Button>
      </div>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {matches !== null ? (
        matches.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">
            {t("scopeCheck.noOverlap")}
          </p>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-slate-700">
              {t("scopeCheck.advisory")}
            </p>
            <ul className="mt-2 space-y-2">
              {matches.map((m) => (
                <li key={m.requirementId} className="rounded-md border border-slate-200 bg-white p-2 text-sm">
                  <p className="font-medium">
                    {m.stableKey} <Badge tone={m.risk === "HIGH" ? "amber" : "slate"}>{m.risk}</Badge>
                  </p>
                  <p className="mt-1 text-slate-700">{m.excerpt}</p>
                  <p className="mt-1 text-xs text-slate-500">{t("scopeCheck.matched", { terms: m.matchedTerms.join(", ") })}</p>
                </li>
              ))}
            </ul>
            {aiNote ? <p className="mt-2 text-xs text-slate-500">{aiNote}</p> : null}
          </div>
        )
      ) : (
        <p className="mt-1 text-xs text-slate-500">{t("scopeCheck.hint")}</p>
      )}
    </div>
  );
}

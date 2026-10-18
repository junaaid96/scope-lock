import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { Impact } from "../lib/types.js";
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Spinner, Textarea } from "./ui.js";

interface Comparable {
  changeId: string;
  changeNumber: string;
  title: string;
  approvedPriceMinor: number;
  currency: string;
  effortDays: number | null;
  decidedAt: string;
  link: string;
  sharedTerms: string[];
}

interface SuggestionsResponse {
  changeId: string;
  currency: string;
  data: Comparable[];
}

/**
 * Price suggestions: comparable approved changes with their real approved
 * prices. The list IS the suggestion — no generated single number.
 */
export function PriceSuggestions({ changeId }: { changeId: string }): JSX.Element {
  const { money, date, t } = useLocale();
  const suggestions = useQuery({
    queryKey: ["price-suggestions", changeId],
    queryFn: () => api.get<SuggestionsResponse>(`/change-requests/${changeId}/price-suggestions`),
  });

  return (
    <Card>
      <h2 className="font-medium">{t("actuals.similarTitle")}</h2>
      <p className="mt-1 text-sm text-slate-600">{t("actuals.similarHint")}</p>
      {suggestions.isLoading ? (
        <Spinner />
      ) : suggestions.isError ? (
        <div className="mt-2">
          <ErrorBanner message={errorMessage(suggestions.error)} />
        </div>
      ) : (suggestions.data?.data ?? []).length === 0 ? (
        <div className="mt-2">
          <Empty title={t("actuals.noSimilarTitle")} hint={t("actuals.noSimilarHint")} />
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {(suggestions.data?.data ?? []).map((c) => (
            <li key={c.changeId} className="rounded-md border border-slate-200 p-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <Link
                  to={c.link}
                  className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500"
                >
                  {c.changeNumber}: {c.title}
                </Link>
                <span className="text-sm font-medium">{money(c.approvedPriceMinor, c.currency)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {t("actuals.approvedOn", { date: date(c.decidedAt) })}
                {c.effortDays !== null ? t("actuals.estimatedDays", { days: c.effortDays }) : ""}
                {c.sharedTerms.length > 0 ? t("actuals.matchesTerms", { terms: c.sharedTerms.join(", ") }) : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Actuals form + display for an implemented change. The server gates recording to staff. */
export function ActualsCard({
  changeId,
  impact,
  status,
  currency,
  onDone,
}: {
  changeId: string;
  impact: Impact | null;
  status: string;
  currency: string;
  onDone: () => void;
}): JSX.Element {
  const { money, t } = useLocale();
  const [effort, setEffort] = useState("");
  const [price, setPrice] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (status !== "IMPLEMENTED" || !impact) return <></>;

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.patch(`/change-requests/${changeId}/impact/actuals`, {
        actualEffortDays: effort.trim() === "" ? null : Number(effort),
        actualPriceMinor: price.trim() === "" ? null : Math.round(Number(price) * 100),
        actualNotes: notes.trim() === "" ? null : notes.trim(),
      });
      setSaved(true);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const hasActuals = impact.actualEffortDays !== null || impact.actualPriceMinor !== null;

  return (
    <Card>
      <h2 className="font-medium">{t("actuals.title")}</h2>
      {hasActuals ? (
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-slate-500">{t("actuals.priceLabel")}</dt>
          <dd className="font-medium">
            {impact.actualPriceMinor !== null ? money(impact.actualPriceMinor, currency) : t("common.notAvailable")}
          </dd>
          <dt className="text-slate-500">{t("actuals.effortLabel")}</dt>
          <dd>{impact.actualEffortDays !== null ? t("actuals.daysValue", { days: impact.actualEffortDays }) : t("common.notAvailable")}</dd>
        </dl>
      ) : (
        <p className="mt-1 text-sm text-slate-600">{t("actuals.noActuals")}</p>
      )}
      {impact.actualNotes ? <p className="mt-2 text-sm text-slate-700">{impact.actualNotes}</p> : null}
      <form onSubmit={(e) => void save(e)} className="mt-3 space-y-2" aria-label={t("actuals.formLabel")}>
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("actuals.effortField")} htmlFor="actuals-effort">
              <Input id="actuals-effort" value={effort} onChange={(e) => setEffort(e.target.value)} inputMode="decimal" placeholder={t("actuals.effortPlaceholder")} />
            </Field>
            <Field label={t("actuals.priceField", { currency })} htmlFor="actuals-price">
              <Input id="actuals-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder={t("actuals.pricePlaceholder")} />
            </Field>
          </div>
          <Field label={t("actuals.notesField")} htmlFor="actuals-notes">
            <Textarea id="actuals-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={t("actuals.notesPlaceholder")} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          {saved ? <p className="text-sm text-emerald-700" aria-live="polite">{t("actuals.saved")}</p> : null}
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t("actuals.saving") : t("actuals.save")}
          </Button>
        </form>
    </Card>
  );
}

interface ReportRow {
  changeId: string;
  changeNumber: string;
  title: string;
  estimateMinor: number | null;
  actualMinor: number | null;
  varianceMinor: number | null;
  variancePct: number | null;
  estimateDays: number | null;
  actualDays: number | null;
  daysVariance: number | null;
  link: string;
}

interface ReportResponse {
  projectId: string;
  currency: string;
  data: ReportRow[];
  totals: { estimateMinor: number; actualMinor: number; varianceMinor: number; rowsWithActuals: number; rowsTotal: number };
}

/** Project-level estimate-vs-actual report over implemented changes. */
export function EstimateVsActual({ projectId }: { projectId: string }): JSX.Element {
  const { money, t } = useLocale();
  const report = useQuery({
    queryKey: ["estimate-vs-actual", projectId],
    queryFn: () => api.get<ReportResponse>(`/projects/${projectId}/estimate-vs-actual`),
  });

  if (report.isLoading) return <Spinner />;
  if (report.isError) return <ErrorBanner message={errorMessage(report.error)} />;
  const rows = report.data?.data ?? [];
  if (rows.length === 0) {
    return <Empty title={t("actuals.noImplementedTitle")} hint={t("actuals.noImplementedHint")} />;
  }
  const totals = report.data?.totals;
  const currency = report.data?.currency ?? "USD";

  return (
    <div>
      <p className="text-sm text-slate-600">
        {t("actuals.coverage", { withActuals: totals?.rowsWithActuals ?? 0, total: totals?.rowsTotal ?? 0 })}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th scope="col" className="py-2 pr-3 font-medium">{t("actuals.colChange")}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{t("actuals.colEstimate")}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{t("actuals.colActual")}</th>
              <th scope="col" className="py-2 pr-3 font-medium">{t("actuals.colVariance")}</th>
              <th scope="col" className="py-2 font-medium">{t("actuals.colEffort")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.changeId} className="border-b border-slate-100">
                <td className="py-2 pr-3">
                  <Link to={r.link} className="underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-500">
                    {r.changeNumber}: {r.title}
                  </Link>
                </td>
                <td className="py-2 pr-3">{r.estimateMinor !== null ? money(r.estimateMinor, currency) : t("common.notAvailable")}</td>
                <td className="py-2 pr-3">{r.actualMinor !== null ? money(r.actualMinor, currency) : t("common.notAvailable")}</td>
                <td className="py-2 pr-3">
                  {r.varianceMinor !== null ? (
                    <span>
                      {money(r.varianceMinor, currency)}
                      {r.variancePct !== null ? ` ${t("actuals.variancePct", { sign: r.variancePct > 0 ? "+" : "", pct: r.variancePct })}` : ""}
                    </span>
                  ) : (
                    t("common.notAvailable")
                  )}
                </td>
                <td className="py-2">
                  {r.estimateDays ?? t("common.notAvailable")} → {r.actualDays ?? t("common.notAvailable")}
                  {r.daysVariance !== null && r.daysVariance !== 0 ? (
                    <Badge tone={r.daysVariance > 0 ? "amber" : "green"}>
                      {r.daysVariance > 0 ? "+" : ""}
                      {r.daysVariance}
                    </Badge>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          {totals ? (
            <tfoot>
              <tr className="font-medium">
                <td className="py-2 pr-3">{t("actuals.total")}</td>
                <td className="py-2 pr-3">{money(totals.estimateMinor, currency)}</td>
                <td className="py-2 pr-3">{money(totals.actualMinor, currency)}</td>
                <td className="py-2 pr-3">{money(totals.varianceMinor, currency)}</td>
                <td className="py-2" />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
    </div>
  );
}

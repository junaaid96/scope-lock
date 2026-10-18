import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { ContractLedger, OrgContractRollup } from "../lib/types.js";
import { Badge, Button, Card, Empty, ErrorBanner, Field, Input, Spinner, statusTone } from "./ui.js";

const tableWrap = "overflow-x-auto rounded-lg border border-slate-200";
const table = "w-full min-w-[560px] border-collapse bg-white text-sm";
const th = "border-b border-slate-200 bg-slate-50 px-3 py-2 text-left font-medium text-slate-600";
const td = "border-b border-slate-100 px-3 py-2 text-slate-800";
const num = "text-right tabular-nums";

/** Project "Contract" tab: derived baseline + approved deltas = current value. */
export function ContractTab({ projectId }: { projectId: string }): JSX.Element {
  const { t, money, date, number } = useLocale();
  const ledger = useQuery({ queryKey: ["contract", projectId], queryFn: () => api.get<ContractLedger>(`/projects/${projectId}/contract`) });

  if (ledger.isLoading) return <Spinner />;
  if (ledger.isError || !ledger.data) return <ErrorBanner message={errorMessage(ledger.error)} />;
  const c = ledger.data;

  return (
    <div className="space-y-5">
      <Card>
        <h3 className="mb-3 text-base font-semibold text-slate-900">{t("contract.summary")}</h3>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <dt className="text-sm text-slate-600">{t("contract.baseline")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">
              {c.baselineMinor === null ? t("contract.noBaseline") : money(c.baselineMinor, c.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">{t("contract.approvedDeltas")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">+{money(c.approvedDeltaMinor, c.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">{t("contract.currentValue")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-teal-800">
              {c.currentMinor === null ? t("contract.noBaseline") : money(c.currentMinor, c.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">{t("contract.pendingExposure")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">{money(c.pendingExposureMinor, c.currency)}</dd>
          </div>
          <div>
            <dt className="text-sm text-slate-600">{t("contract.absorbedWork")}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-900">
              {t("contract.absorbedHint", { count: c.absorbedCount, days: c.absorbedEffortDays })}
            </dd>
          </div>
        </dl>
        {c.unattributedMinor > 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            {t("contract.unattributed", { amount: money(c.unattributedMinor, c.currency), changes: c.unattributedNumbers.join(", ") })}
          </p>
        ) : null}
      </Card>

      <section aria-labelledby="contract-deltas">
        <h3 id="contract-deltas" className="mb-2 text-base font-semibold text-slate-900">{t("contract.deltasTitle")}</h3>
        {c.deltas.length === 0 ? (
          <Empty title={t("contract.empty")} />
        ) : (
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("contract.change")}</th>
                  <th scope="col" className={th}>{t("contract.decided")}</th>
                  <th scope="col" className={`${th} ${num}`}>{t("contract.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {c.deltas.map((d) => (
                  <tr key={d.changeId}>
                    <td className={td}>
                      <Link className="underline" to={`/projects/${projectId}/changes/${d.changeId}`}>
                        {d.number}: {d.title}
                      </Link>
                    </td>
                    <td className={td}>{date(d.decidedAt)}</td>
                    <td className={`${td} ${num}`}>+{money(d.priceMinor, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {c.pending.length > 0 ? (
        <section aria-labelledby="contract-pending">
          <h3 id="contract-pending" className="mb-2 text-base font-semibold text-slate-900">{t("contract.pendingTitle")}</h3>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("contract.change")}</th>
                  <th scope="col" className={th}>{t("contract.status")}</th>
                  <th scope="col" className={`${th} ${num}`}>{t("contract.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {c.pending.map((p) => (
                  <tr key={p.changeId}>
                    <td className={td}>
                      <Link className="underline" to={`/projects/${projectId}/changes/${p.changeId}`}>
                        {p.number}: {p.title}
                      </Link>
                    </td>
                    <td className={td}><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
                    <td className={`${td} ${num}`}>{money(p.priceMinor, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {c.absorbed.length > 0 ? (
        <section aria-labelledby="contract-absorbed">
          <h3 id="contract-absorbed" className="mb-2 text-base font-semibold text-slate-900">{t("contract.absorbedTitle")}</h3>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("contract.change")}</th>
                  <th scope="col" className={th}>{t("contract.decided")}</th>
                  <th scope="col" className={`${th} ${num}`}>{t("contract.effort")}</th>
                </tr>
              </thead>
              <tbody>
                {c.absorbed.map((a) => (
                  <tr key={a.changeId}>
                    <td className={td}>
                      <Link className="underline" to={`/projects/${projectId}/changes/${a.changeId}`}>
                        {a.number}: {a.title}
                      </Link>
                    </td>
                    <td className={td}>{date(a.decidedAt)}</td>
                    <td className={`${td} ${num}`}>{a.effortDays === null ? t("common.notAvailable") : number(a.effortDays)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {c.byVersion.length > 0 ? (
        <section aria-labelledby="contract-versions">
          <h3 id="contract-versions" className="mb-2 text-base font-semibold text-slate-900">{t("contract.byVersionTitle")}</h3>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("contract.version")}</th>
                  <th scope="col" className={th}>{t("contract.status")}</th>
                  <th scope="col" className={th}>{t("contract.change")}</th>
                  <th scope="col" className={`${th} ${num}`}>{t("contract.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {c.byVersion.map((v) => (
                  <tr key={v.scopeVersionId}>
                    <td className={td}>v{v.sequence}{v.title ? ` · ${v.title}` : ""}</td>
                    <td className={td}><Badge tone={statusTone(v.status)}>{v.status}</Badge></td>
                    <td className={td}>{v.changeNumbers.join(", ") || t("common.notAvailable")}</td>
                    <td className={`${td} ${num}`}>+{money(v.deltaMinor, c.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <InvoiceExportCard projectId={projectId} />

      {c.excluded.length > 0 ? (
        <section aria-labelledby="contract-excluded">
          <h3 id="contract-excluded" className="mb-2 text-base font-semibold text-slate-900">{t("contract.excludedTitle")}</h3>
          <div className={tableWrap}>
            <table className={table}>
              <thead>
                <tr>
                  <th scope="col" className={th}>{t("contract.change")}</th>
                  <th scope="col" className={th}>{t("contract.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {c.excluded.map((e) => (
                  <tr key={e.changeId}>
                    <td className={td}>
                      <Link className="underline" to={`/projects/${projectId}/changes/${e.changeId}`}>{e.number}</Link>
                    </td>
                    <td className={td}>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function InvoiceExportCard({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const [from, setFrom] = useState(() => `${new Date().getUTCFullYear()}-01-01`);
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState<"csv" | "json" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = (format: "csv" | "json"): void => {
    setBusy(format);
    setError(null);
    const params = new URLSearchParams({ from, to, format });
    fetch(`/api/v1/projects/${projectId}/export/invoice-ready?${params.toString()}`, { credentials: "include" })
      .then((res) => {
        if (!res.ok) throw new Error(t("contract.exportFailed", { status: res.status }));
        return res.blob().then((blob) => ({ blob, disposition: res.headers.get("content-disposition") }));
      })
      .then(({ blob, disposition }) => {
        const match = disposition?.match(/filename="([^"]+)"/);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = match?.[1] ?? `invoice-export.${format}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(null));
  };

  return (
    <Card>
      <h3 className="mb-1 text-base font-semibold text-slate-900">{t("contract.exportTitle")}</h3>
      <p className="mb-3 text-sm text-slate-600">{t("contract.exportHint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("contract.exportFrom")} htmlFor="export-from">
          <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("contract.exportTo")} htmlFor="export-to">
          <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      {error ? <div className="mt-3"><ErrorBanner message={error} /></div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy !== null || !from || !to} onClick={() => download("csv")}>
          {busy === "csv" ? "…" : t("contract.exportCsv")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy !== null || !from || !to} onClick={() => download("json")}>
          {busy === "json" ? "…" : t("contract.exportJson")}
        </Button>
      </div>
    </Card>
  );
}

/** Dashboard strip: org rollup over the viewer's visible projects. Amounts are never converted. */
export function OrgContractStrip({ organizationId }: { organizationId: string }): JSX.Element | null {
  const { t, money, number } = useLocale();
  const rollup = useQuery({
    queryKey: ["org-contract", organizationId],
    queryFn: () => api.get<OrgContractRollup>(`/organizations/${organizationId}/contract`),
  });
  if (rollup.isLoading || rollup.isError || !rollup.data || rollup.data.projects.length === 0) return null;
  return (
    <Card className="mb-5">
      <h2 className="mb-2 text-base font-semibold text-slate-900">{t("orgContract.title")}</h2>
      <ul className="flex flex-wrap gap-x-8 gap-y-2">
        {rollup.data.totalsByCurrency.map((total) => (
          <li key={total.currency} className="text-sm text-slate-700">
            <span className="font-medium text-slate-900">{total.currency}</span>
            {" · "}
            {t("orgContract.projects", { count: number(total.projectCount) })}
            {" · "}
            {t("orgContract.current")} <strong className="tabular-nums">{money(total.currentMinor, total.currency)}</strong>
            {" · "}
            {t("orgContract.pending")} <strong className="tabular-nums">{money(total.pendingExposureMinor, total.currency)}</strong>
          </li>
        ))}
      </ul>
    </Card>
  );
}

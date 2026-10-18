import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, errorMessage, fetchAll } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { EstimateTemplate, RateCard } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Spinner } from "./ui.js";

function staffOnly(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}

function toMinor(major: string): number | null {
  if (major.trim() === "") return null;
  const n = Number(major);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** Org settings section: rate-card CRUD (agency staff views, owners/admins manage). */
export function RateCardsCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }): JSX.Element {
  const { t, money } = useLocale();
  const client = useQueryClient();
  const cards = useQuery({ queryKey: ["rate-cards", organizationId], queryFn: () => fetchAll<RateCard>(`/organizations/${organizationId}/rate-cards`) });
  const [editing, setEditing] = useState<RateCard | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/rate-cards/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      setError(null);
      void client.invalidateQueries({ queryKey: ["rate-cards", organizationId] });
    },
    onError: (err) => {
      setConfirmDelete(null);
      setError(errorMessage(err));
    },
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{t("pricing.rateCards")}</h2>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>{t("pricing.newCard")}</Button> : null}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("pricing.rateCardsHint")}</p>
      {cards.isLoading ? <Spinner /> : cards.isError ? (
        staffOnly(cards.error) ? <p className="text-sm text-slate-600">{t("pricing.staffOnly")}</p> : <ErrorBanner message={errorMessage(cards.error)} />
      ) : (cards.data ?? []).length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(cards.data ?? []).map((card) => (
            <li key={card.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium text-slate-900">{card.name}</span>{" "}
                <span className="text-sm text-slate-600">{card.currency} · {card.rates.length} {t("pricing.roles")}</span>{" "}
                {card.isDefault ? <Badge tone="teal">{t("pricing.defaultCard")}</Badge> : null}
                <ul className="mt-1 text-sm text-slate-600">
                  {card.rates.map((r) => (
                    <li key={r.id}>{r.role} — {money(r.hourlyRateMinor, card.currency)}{t("pricing.perHour")}</li>
                  ))}
                </ul>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(card)}>{t("pricing.editCard")}</Button>
                  {confirmDelete === card.id ? (
                    <>
                      <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(card.id)}>{t("pricing.deleteConfirm")}</Button>
                      <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(null)}>{t("pricing.cancel")}</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setConfirmDelete(card.id)}>{t("pricing.delete")}</Button>
                  )}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {editing ? (
        <RateCardDialog
          organizationId={organizationId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void client.invalidateQueries({ queryKey: ["rate-cards", organizationId] });
          }}
        />
      ) : null}
    </Card>
  );
}

function RateCardDialog({ organizationId, initial, onClose, onDone }: {
  organizationId: string;
  initial: RateCard | null;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [currency, setCurrency] = useState(initial?.currency ?? "USD");
  const [isDefault, setIsDefault] = useState(initial?.isDefault ?? false);
  const [rates, setRates] = useState<Array<{ role: string; hourly: string }>>(
    initial ? initial.rates.map((r) => ({ role: r.role, hourly: String(r.hourlyRateMinor / 100) })) : [{ role: "", hourly: "" }],
  );
  const save = useMutation({
    mutationFn: () => {
      const parsed = rates.map((r) => ({ role: r.role.trim(), hourlyRateMinor: toMinor(r.hourly) }));
      if (!name.trim()) throw new Error(t("pricing.cardName"));
      return initial
        ? api.patch(`/rate-cards/${initial.id}`, { name: name.trim(), currency: currency.trim().toUpperCase(), isDefault, rates: parsed })
        : api.post(`/organizations/${organizationId}/rate-cards`, { name: name.trim(), currency: currency.trim().toUpperCase(), isDefault, rates: parsed });
    },
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={initial ? t("pricing.editCard") : t("pricing.newCard")} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("pricing.cardName")} htmlFor="rc-name">
            <Input id="rc-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t("pricing.currencyLabel")} htmlFor="rc-currency">
            <Input id="rc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t("pricing.role")} / {t("pricing.hourlyRate")}</legend>
          <ul className="space-y-2">
            {rates.map((r, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input aria-label={`${t("pricing.role")} ${i + 1}`} placeholder={t("pricing.role")} value={r.role} onChange={(e) => setRates(rates.map((row, j) => (j === i ? { ...row, role: e.target.value } : row)))} />
                <Input aria-label={`${t("pricing.hourlyRate")} ${i + 1}`} placeholder={t("pricing.ratePlaceholder")} inputMode="decimal" value={r.hourly} onChange={(e) => setRates(rates.map((row, j) => (j === i ? { ...row, hourly: e.target.value } : row)))} />
                <Button type="button" size="sm" variant="secondary" disabled={rates.length <= 1} onClick={() => setRates(rates.filter((_, j) => j !== i))}>{t("pricing.remove")}</Button>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setRates([...rates, { role: "", hourly: "" }])}>{t("pricing.addRole")}</Button>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          {t("pricing.defaultCard")}
        </label>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("pricing.save")}</Button>
      </form>
    </Dialog>
  );
}

/** Org settings section: estimate-template CRUD. */
export function TemplatesCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const templates = useQuery({ queryKey: ["templates", organizationId], queryFn: () => fetchAll<EstimateTemplate>(`/organizations/${organizationId}/estimate-templates`) });
  const [editing, setEditing] = useState<EstimateTemplate | "new" | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/estimate-templates/${id}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["templates", organizationId] }),
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{t("pricing.templates")}</h2>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>{t("pricing.newTemplate")}</Button> : null}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("pricing.templatesHint")}</p>
      {templates.isLoading ? <Spinner /> : templates.isError ? (
        staffOnly(templates.error) ? <p className="text-sm text-slate-600">{t("pricing.staffOnly")}</p> : <ErrorBanner message={errorMessage(templates.error)} />
      ) : (templates.data ?? []).length === 0 ? (
        <Empty title={t("common.empty")} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(templates.data ?? []).map((tpl) => (
            <li key={tpl.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="font-medium text-slate-900">{tpl.name}</span>{" "}
                <span className="text-sm text-slate-600">
                  {tpl.items.length} {t("pricing.items")} · {t("pricing.contingency")}: {tpl.contingencyPct}%{tpl.taxPct !== null ? ` · ${t("pricing.tax")}: ${tpl.taxPct}%` : ""}
                </span>
                <ul className="mt-1 text-sm text-slate-600">
                  {tpl.items.map((item, i) => (
                    <li key={i}>{item.label} — {item.role}, {item.hours}{t("pricing.hoursSuffix")}</li>
                  ))}
                </ul>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(tpl)}>{t("pricing.editTemplate")}</Button>
                  <Button size="sm" variant="secondary" disabled={remove.isPending} onClick={() => remove.mutate(tpl.id)}>{t("pricing.delete")}</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <TemplateDialog
          organizationId={organizationId}
          initial={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            void client.invalidateQueries({ queryKey: ["templates", organizationId] });
          }}
        />
      ) : null}
    </Card>
  );
}

function TemplateDialog({ organizationId, initial, onClose, onDone }: {
  organizationId: string;
  initial: EstimateTemplate | null;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initial?.name ?? "");
  const [contingency, setContingency] = useState(String(initial?.contingencyPct ?? 0));
  const [tax, setTax] = useState(initial?.taxPct === null || initial?.taxPct === undefined ? "" : String(initial.taxPct));
  const [items, setItems] = useState<Array<{ label: string; role: string; hours: string }>>(
    initial ? initial.items.map((i) => ({ label: i.label, role: i.role, hours: String(i.hours) })) : [{ label: "", role: "", hours: "" }],
  );
  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: name.trim(),
        items: items.map((i) => ({ label: i.label.trim(), role: i.role.trim(), hours: Number(i.hours) })),
        contingencyPct: Number(contingency),
        taxPct: tax.trim() === "" ? null : Number(tax),
      };
      return initial ? api.patch(`/estimate-templates/${initial.id}`, payload) : api.post(`/organizations/${organizationId}/estimate-templates`, payload);
    },
    onSuccess: onDone,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={initial ? t("pricing.editTemplate") : t("pricing.newTemplate")} onClose={onClose} wide>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="space-y-4"
      >
        <Field label={t("pricing.templateName")} htmlFor="tpl-name">
          <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-700">{t("pricing.lineLabel")} / {t("pricing.role")} / {t("pricing.hours")}</legend>
          <ul className="space-y-2">
            {items.map((item, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_5rem_auto] gap-2">
                <Input aria-label={`${t("pricing.lineLabel")} ${i + 1}`} placeholder={t("pricing.lineLabel")} value={item.label} onChange={(e) => setItems(items.map((row, j) => (j === i ? { ...row, label: e.target.value } : row)))} />
                <Input aria-label={`${t("pricing.role")} ${i + 1}`} placeholder={t("pricing.role")} value={item.role} onChange={(e) => setItems(items.map((row, j) => (j === i ? { ...row, role: e.target.value } : row)))} />
                <Input aria-label={`${t("pricing.hours")} ${i + 1}`} placeholder={t("pricing.hoursPlaceholder")} inputMode="decimal" value={item.hours} onChange={(e) => setItems(items.map((row, j) => (j === i ? { ...row, hours: e.target.value } : row)))} />
                <Button type="button" size="sm" variant="secondary" disabled={items.length <= 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>{t("pricing.remove")}</Button>
              </li>
            ))}
          </ul>
          <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setItems([...items, { label: "", role: "", hours: "" }])}>{t("pricing.addLine")}</Button>
        </fieldset>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("pricing.contingency")} htmlFor="tpl-cont">
            <Input id="tpl-cont" inputMode="decimal" value={contingency} onChange={(e) => setContingency(e.target.value)} />
          </Field>
          <Field label={t("pricing.tax")} htmlFor="tpl-tax">
            <Input id="tpl-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} />
          </Field>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">{t("pricing.save")}</Button>
      </form>
    </Dialog>
  );
}

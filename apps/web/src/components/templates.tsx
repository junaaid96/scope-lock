import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import { Badge, Button, Card, ConfirmButton, Dialog, Empty, ErrorBanner, Field, Input, Select, Spinner, Textarea } from "./ui.js";

export interface ScopeTemplateItem {
  title: string;
  description: string;
  acceptanceCriteria: string[];
  category: string | null;
  priority: string | null;
}

export interface ScopeTemplate {
  id: string;
  organizationId: string;
  name: string;
  projectType: string;
  description: string | null;
  assumptions: string[];
  exclusions: string[];
  items: ScopeTemplateItem[];
  createdAt: string;
  updatedAt: string;
}

interface RowError {
  row: number;
  field: string;
  message: string;
}

interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  validRows: number;
  imported: number;
  errors: RowError[];
  stableKeys: string[];
}

const linesOf = (text: string): string[] => text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);

/** Org settings card: manage the requirement-library templates (staff only writes). */
export function ScopeTemplatesCard({ organizationId, canManage }: { organizationId: string; canManage: boolean }): JSX.Element {
  const client = useQueryClient();
  const { t } = useLocale();
  const templates = useQuery({
    queryKey: ["scope-templates", organizationId],
    queryFn: () => api.get<{ data: ScopeTemplate[] }>(`/organizations/${organizationId}/scope-templates`),
  });
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<ScopeTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    setError(null);
    void client.invalidateQueries({ queryKey: ["scope-templates", organizationId] });
  };

  const remove = async (tpl: ScopeTemplate): Promise<void> => {
    try {
      await api.delete(`/organizations/${organizationId}/scope-templates/${tpl.id}`);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{t("templates.title")}</h2>
        {canManage ? <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>{t("templates.newButton")}</Button> : null}
      </div>
      <p className="text-sm text-slate-600">{t("templates.blurb")}</p>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {templates.isLoading ? (
        <Spinner />
      ) : templates.isError ? (
        <div className="mt-2"><ErrorBanner message={errorMessage(templates.error)} /></div>
      ) : (templates.data?.data ?? []).length === 0 ? (
        <div className="mt-2"><Empty title={t("templates.noTemplates")} hint={t("templates.noTemplatesHint")} /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {(templates.data?.data ?? []).map((tpl) => (
            <li key={tpl.id} className="rounded-md border border-slate-200 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-900">{tpl.name}</span>
                <span className="flex items-center gap-2">
                  <Badge>{tpl.projectType}</Badge>
                  {canManage ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(tpl)}>{t("templates.edit")}</Button>
                      <ConfirmButton
                        label={t("templates.delete")}
                        confirmLabel={t("common.confirmDelete")}
                        cancelLabel={t("common.cancel")}
                        onConfirm={() => void remove(tpl)}
                      />
                    </>
                  ) : null}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {tpl.items.length} {tpl.items.length === 1 ? t("templates.requirementOne") : t("templates.requirementOther")} ·{" "}
                {tpl.assumptions.length} {tpl.assumptions.length === 1 ? t("templates.assumptionOne") : t("templates.assumptionOther")} ·{" "}
                {tpl.exclusions.length} {tpl.exclusions.length === 1 ? t("templates.exclusionOne") : t("templates.exclusionOther")}
              </p>
            </li>
          ))}
        </ul>
      )}
      {showCreate ? (
        <TemplateForm
          organizationId={organizationId}
          initial={null}
          onClose={() => setShowCreate(false)}
          onDone={() => {
            setShowCreate(false);
            refresh();
          }}
        />
      ) : null}
      {editing ? (
        <TemplateForm
          organizationId={organizationId}
          initial={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

interface ItemDraft {
  title: string;
  description: string;
  acceptanceCriteria: string;
  category: string;
  priority: string;
}

const BLANK_ITEM: ItemDraft = { title: "", description: "", acceptanceCriteria: "", category: "", priority: "" };

function TemplateForm({
  organizationId,
  initial,
  onClose,
  onDone,
}: {
  organizationId: string;
  initial: ScopeTemplate | null;
  onClose: () => void;
  onDone: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [name, setName] = useState(initial?.name ?? "");
  const [projectType, setProjectType] = useState(initial?.projectType ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [assumptions, setAssumptions] = useState((initial?.assumptions ?? []).join("\n"));
  const [exclusions, setExclusions] = useState((initial?.exclusions ?? []).join("\n"));
  const [items, setItems] = useState<ItemDraft[]>(
    (initial?.items ?? []).map((it) => ({
      title: it.title,
      description: it.description,
      acceptanceCriteria: it.acceptanceCriteria.join(" | "),
      category: it.category ?? "",
      priority: it.priority ?? "",
    })),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setItem = (index: number, patch: Partial<ItemDraft>): void => {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        projectType: projectType.trim(),
        description: description.trim() || undefined,
        assumptions: linesOf(assumptions),
        exclusions: linesOf(exclusions),
        items: items
          .filter((it) => it.title.trim() && it.description.trim())
          .map((it) => ({
            title: it.title.trim(),
            description: it.description.trim(),
            acceptanceCriteria: it.acceptanceCriteria.split("|").map((c) => c.trim()).filter(Boolean),
            ...(it.category.trim() ? { category: it.category.trim() } : {}),
            ...(it.priority ? { priority: it.priority } : {}),
          })),
      };
      if (initial) {
        await api.patch(`/organizations/${organizationId}/scope-templates/${initial.id}`, body);
      } else {
        await api.post(`/organizations/${organizationId}/scope-templates`, body);
      }
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog title={initial ? t("templates.editTitle") : t("templates.newTitle")} onClose={onClose} wide>
      <form onSubmit={(e) => void save(e)} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("templates.nameLabel")} htmlFor="tpl-name">
            <Input id="tpl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("templates.namePlaceholder")} />
          </Field>
          <Field label={t("templates.typeLabel")} htmlFor="tpl-type">
            <Input id="tpl-type" value={projectType} onChange={(e) => setProjectType(e.target.value)} placeholder={t("templates.typePlaceholder")} />
          </Field>
        </div>
        <Field label={t("templates.descriptionLabel")} htmlFor="tpl-desc">
          <Textarea id="tpl-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t("templates.assumptionsLabel")} htmlFor="tpl-assumptions">
            <Textarea id="tpl-assumptions" value={assumptions} onChange={(e) => setAssumptions(e.target.value)} rows={3} />
          </Field>
          <Field label={t("templates.exclusionsLabel")} htmlFor="tpl-exclusions">
            <Textarea id="tpl-exclusions" value={exclusions} onChange={(e) => setExclusions(e.target.value)} rows={3} />
          </Field>
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-slate-800">{t("templates.requirementsCount", { count: items.length })}</p>
          <div className="space-y-2">
            {items.map((it, i) => (
              <fieldset key={i} className="rounded-md border border-slate-200 p-2">
                <legend className="px-1 text-xs text-slate-500">{t("templates.itemNumber", { n: i + 1 })}</legend>
                <div className="grid gap-2 md:grid-cols-2">
                  <Field label={t("templates.itemTitle")} htmlFor={`tpl-item-title-${i}`}>
                    <Input id={`tpl-item-title-${i}`} value={it.title} onChange={(e) => setItem(i, { title: e.target.value })} />
                  </Field>
                  <Field label={t("templates.itemCategory")} htmlFor={`tpl-item-cat-${i}`}>
                    <Input id={`tpl-item-cat-${i}`} value={it.category} onChange={(e) => setItem(i, { category: e.target.value })} />
                  </Field>
                </div>
                <div className="mt-2">
                  <Field label={t("templates.itemDescription")} htmlFor={`tpl-item-desc-${i}`}>
                    <Textarea id={`tpl-item-desc-${i}`} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} rows={2} />
                  </Field>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <Field label={t("templates.itemAcceptance")} htmlFor={`tpl-item-ac-${i}`}>
                    <Input id={`tpl-item-ac-${i}`} value={it.acceptanceCriteria} onChange={(e) => setItem(i, { acceptanceCriteria: e.target.value })} />
                  </Field>
                  <Field label={t("templates.itemPriority")} htmlFor={`tpl-item-prio-${i}`}>
                    <Select id={`tpl-item-prio-${i}`} value={it.priority} onChange={(e) => setItem(i, { priority: e.target.value })}>
                      <option value="">{t("templates.priorityNone")}</option>
                      <option value="LOW">{t("templates.priorityLow")}</option>
                      <option value="MEDIUM">{t("templates.priorityMedium")}</option>
                      <option value="HIGH">{t("templates.priorityHigh")}</option>
                      <option value="CRITICAL">{t("templates.priorityCritical")}</option>
                    </Select>
                  </Field>
                </div>
                <div className="mt-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setItems((prev) => prev.filter((_, j) => j !== i))}>
                    {t("templates.removeItem")}
                  </Button>
                </div>
              </fieldset>
            ))}
          </div>
          <div className="mt-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setItems((prev) => [...prev, { ...BLANK_ITEM }])}>
              {t("templates.addItem")}
            </Button>
          </div>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t("templates.cancel")}</Button>
          <Button type="submit" disabled={saving || !name.trim() || !projectType.trim()}>
            {saving ? t("templates.saving") : initial ? t("templates.saveTemplate") : t("templates.createTemplate")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Scope page dialog: start a new draft from a library template. */
export function TemplateDialog({
  projectId,
  organizationId,
  onClose,
  onCreated,
}: {
  projectId: string;
  organizationId: string;
  onClose: () => void;
  onCreated: (draftId: string) => void;
}): JSX.Element {
  const templates = useQuery({
    queryKey: ["scope-templates", organizationId],
    queryFn: () => api.get<{ data: ScopeTemplate[] }>(`/organizations/${organizationId}/scope-templates`),
  });
  const { t } = useLocale();
  const [templateId, setTemplateId] = useState("");
  const [name, setName] = useState("Scope");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!templateId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post<{ draft: { id: string } }>(`/projects/${projectId}/scope-versions/draft/from-template`, {
        templateId,
        name: name.trim() || "Scope",
      });
      onCreated(res.draft.id);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const list = templates.data?.data ?? [];

  return (
    <Dialog title={t("templates.fromTemplateTitle")} onClose={onClose}>
      {templates.isLoading ? (
        <Spinner />
      ) : templates.isError ? (
        <ErrorBanner message={errorMessage(templates.error)} />
      ) : list.length === 0 ? (
        <Empty title={t("templates.noTemplates")} hint={t("templates.noTemplatesSettingsHint")} />
      ) : (
        <form onSubmit={(e) => void apply(e)} className="space-y-3">
          <Field label={t("templates.templateLabel")} htmlFor="from-tpl">
            <Select id="from-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t("templates.selectTemplate")}</option>
              {list.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.name} ({tpl.projectType}, {t("templates.itemsSuffix", { count: tpl.items.length })})
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("templates.scopeNameLabel")} htmlFor="from-tpl-name">
            <Input id="from-tpl-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {templateId ? (
            <p className="text-sm text-slate-600">
              {(() => {
                const tpl = list.find((x) => x.id === templateId);
                return tpl
                  ? t("templates.draftSummary", { reqs: tpl.items.length, assumptions: tpl.assumptions.length, exclusions: tpl.exclusions.length })
                  : "";
              })()}
            </p>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>{t("templates.cancel")}</Button>
            <Button type="submit" disabled={saving || !templateId}>
              {saving ? t("templates.creating") : t("templates.createDraft")}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

/** Scope page dialog: CSV import with dry-run preview and per-row errors. */
export function CsvImportDialog({
  projectId,
  draftId,
  onClose,
}: {
  projectId: string;
  draftId: string;
  onClose: () => void;
  onDone?: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [csv, setCsv] = useState("title,description,acceptanceCriteria,category,priority\n");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (dryRun: boolean): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>(`/projects/${projectId}/requirements/import`, {
        draftVersionId: draftId,
        csv,
        dryRun,
      });
      setResult(res);
    } catch (err) {
      // A 422 failed import still carries the per-row report in its details.
      const details = (err as { details?: { report?: ImportResult } }).details;
      if (details?.report && Array.isArray(details.report.errors)) {
        setResult(details.report);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog title={t("templates.csvTitle")} onClose={onClose} wide>
      <div className="space-y-3">
        <Field label={t("templates.csvLabel")} htmlFor="csv-text">
          <Textarea
            id="csv-text"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={6}
            className="font-mono text-xs"
            spellCheck={false}
          />
        </Field>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={working} onClick={() => void run(true)}>
            {working ? t("templates.checking") : t("templates.previewButton")}
          </Button>
          <Button size="sm" disabled={working || result === null || result.errors.length > 0 || result.validRows === 0} onClick={() => void run(false)}>
            {t("templates.importButton")}{" "}{result && result.errors.length === 0 ? t("templates.importRows", { count: result.validRows }) : ""}
          </Button>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {result ? (
          <div aria-live="polite">
            <p className="text-sm text-slate-700">
              {result.dryRun ? t("templates.previewLabel") : t("templates.importedLabel")}: {t("templates.rowsValid", { valid: result.validRows, total: result.totalRows })}
              {result.imported > 0 ? t("templates.importedDetail", { count: result.imported, keys: result.stableKeys.join(", ") }) : ""}
            </p>
            {result.errors.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="rounded-md bg-red-50 px-2 py-1 text-sm text-red-800">
                    {t("templates.rowError", { row: e.row, field: e.field, message: e.message })}
                  </li>
                ))}
              </ul>
            ) : null}
            {!result.dryRun && result.imported > 0 ? (
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={onClose}>{t("templates.done")}</Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

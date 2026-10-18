import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { ChangeOptionView } from "../lib/types.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Textarea, statusTone } from "./ui.js";

interface OptionForm {
  label: string;
  description: string;
  price: string;
  effortDays: string;
  timelineDays: string;
  milestoneEffect: string;
  notes: string;
}

/** Change-page "Proposal options" card: priced alternatives the client picks between. */
export function OptionsCard({
  changeId,
  currency,
  status,
  options,
  chosenOptionIds,
  onDone,
}: {
  changeId: string;
  currency: string;
  status: string;
  options: ChangeOptionView[];
  chosenOptionIds: string[];
  onDone: () => void;
}): JSX.Element {
  const { t, money } = useLocale();
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState<ChangeOptionView | null>(null);
  const [removing, setRemoving] = useState<ChangeOptionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frozen = status === "APPROVED" || status === "IMPLEMENTED";
  const remove = useMutation({
    mutationFn: (o: ChangeOptionView) => api.delete(`/change-requests/${changeId}/options/${o.id}`),
    onSuccess: () => {
      setRemoving(null);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-medium">{t("options.title")}</h2>
        {!frozen && options.length < 4 ? (
          <Button size="sm" variant="secondary" onClick={() => setShowAdd(true)}>{t("options.add")}</Button>
        ) : null}
      </div>
      <p className="mb-2 text-sm text-slate-600">{t("options.blurb")}</p>
      {options.length > 0 ? (
        <p className="mb-2 text-xs text-slate-500">{t("options.count", { count: options.length })}</p>
      ) : null}
      {options.length === 0 ? <Empty title={t("options.empty")} /> : (
        <ul className="space-y-2 text-sm">
          {options.map((o) => (
            <li key={o.id} className="rounded-md border border-slate-200 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {o.label} · {money(o.priceMinor, o.currency ?? currency)} · {o.effortDays ?? "—"} days
                </span>
                <span className="flex items-center gap-2">
                  {chosenOptionIds.includes(o.id) ? <Badge tone={statusTone("APPROVED")}>{t("options.chosen")}</Badge> : null}
                  {!frozen ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(o)}>{t("options.edit")}</Button>
                      <Button size="sm" variant="secondary" onClick={() => setRemoving(o)}>{t("options.remove")}</Button>
                    </>
                  ) : null}
                </span>
              </div>
              {o.description ? <p className="mt-1 text-slate-700">{o.description}</p> : null}
              {o.milestoneEffect ? <p className="mt-1 text-slate-600">Milestone: {o.milestoneEffect}</p> : null}
            </li>
          ))}
        </ul>
      )}
      {frozen && options.length > 0 ? <p className="mt-2 text-xs text-slate-500">{t("options.frozen")}</p> : null}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {showAdd ? (
        <OptionDialog
          title={t("options.add")}
          currency={currency}
          onClose={() => setShowAdd(false)}
          onDone={() => {
            setShowAdd(false);
            onDone();
          }}
          save={(v) => api.post(`/change-requests/${changeId}/options`, toPayload(v))}
        />
      ) : null}
      {editing ? (
        <OptionDialog
          title={t("options.edit")}
          currency={currency}
          initial={editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            onDone();
          }}
          save={(v) =>
            api.patch(`/change-requests/${changeId}/options/${editing.id}`, {
              expectedVersion: editing.version,
              ...toPayload(v),
            })
          }
        />
      ) : null}
      {removing ? (
        <Dialog title={t("options.remove")} onClose={() => setRemoving(null)}>
          <p className="text-sm text-slate-700">{t("options.removeConfirm")}</p>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
            <Button disabled={remove.isPending} onClick={() => remove.mutate(removing)}>{t("options.remove")}</Button>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function toPayload(v: OptionForm): Record<string, unknown> {
  return {
    label: v.label,
    description: v.description || null,
    priceMinor: v.price === "" ? null : Math.round(Number(v.price) * 100),
    effortDays: v.effortDays === "" ? null : Number(v.effortDays),
    timelineDays: v.timelineDays === "" ? null : Number(v.timelineDays),
    milestoneEffect: v.milestoneEffect || null,
    notes: v.notes || null,
  };
}

function OptionDialog({
  title,
  currency,
  initial,
  onClose,
  onDone,
  save,
}: {
  title: string;
  currency: string;
  initial?: ChangeOptionView;
  onClose: () => void;
  onDone: () => void;
  save: (v: OptionForm) => Promise<unknown>;
}): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<OptionForm>({
    defaultValues: {
      label: initial?.label ?? "",
      description: initial?.description ?? "",
      price: initial?.priceMinor !== null && initial?.priceMinor !== undefined ? String(initial.priceMinor / 100) : "",
      effortDays: initial?.effortDays !== null && initial?.effortDays !== undefined ? String(initial.effortDays) : "",
      timelineDays: initial?.timelineDays !== null && initial?.timelineDays !== undefined ? String(initial.timelineDays) : "",
      milestoneEffect: initial?.milestoneEffect ?? "",
      notes: initial?.notes ?? "",
    },
  });
  const mutation = useMutation({
    mutationFn: save,
    onSuccess: () => onDone(),
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title={title} onClose={onClose} wide>
      <form onSubmit={(e) => void handleSubmit((v) => mutation.mutate(v))(e)} className="space-y-4">
        <Field label={t("options.label")} error={formState.errors.label?.message} htmlFor="option-label">
          <Input id="option-label" placeholder={t("options.labelPlaceholder")} {...register("label", { required: "Label is required" })} />
        </Field>
        <Field label={t("options.description")} htmlFor="option-description">
          <Textarea id="option-description" rows={2} {...register("description")} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={`${t("options.price")} (${currency})`} htmlFor="option-price">
            <Input id="option-price" inputMode="decimal" placeholder="e.g. 12000.00" {...register("price")} />
          </Field>
          <Field label={t("options.effortDays")} htmlFor="option-effort">
            <Input id="option-effort" inputMode="decimal" {...register("effortDays")} />
          </Field>
          <Field label={t("options.timelineDays")} htmlFor="option-timeline">
            <Input id="option-timeline" inputMode="numeric" {...register("timelineDays")} />
          </Field>
        </div>
        <Field label={t("options.milestoneEffect")} htmlFor="option-milestone">
          <Input id="option-milestone" {...register("milestoneEffect")} />
        </Field>
        <Field label={t("options.notes")} htmlFor="option-notes">
          <Textarea id="option-notes" rows={2} {...register("notes")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={mutation.isPending} className="w-full">{t("options.save")}</Button>
      </form>
    </Dialog>
  );
}

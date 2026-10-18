import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { ProjectDetail } from "../lib/types.js";
import { Button, Card, Empty, ErrorBanner, Field, Input, Select } from "./ui.js";

type Mode = "ANY" | "ALL" | "SEQUENTIAL";

interface RuleDraft {
  upto: string;
  open: boolean;
  mode: Mode;
}

function fromServer(
  policies: Array<{ uptoMinor: number | null; mode: Mode }>,
): RuleDraft[] {
  return policies.map((r) => ({
    upto: r.uptoMinor === null ? "" : String(r.uptoMinor / 100),
    open: r.uptoMinor === null,
    mode: r.mode,
  }));
}

/** Project "Policy" tab: amount thresholds that pick the decision rule per package. */
export function PolicyTab({ project }: { project: ProjectDetail }): JSX.Element {
  const { t, money } = useLocale();
  const client = useQueryClient();
  const [rules, setRules] = useState<RuleDraft[] | null>(null);
  const [stepUp, setStepUp] = useState<{ otp: boolean | null; typedName: boolean | null } | null>(null);
  const [deemed, setDeemed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const current = rules ?? fromServer((project.settings.approvalPolicies ?? []) as Array<{ uptoMinor: number | null; mode: Mode }>);
  const serverStepUp = project.settings.stepUp ?? { otp: null, typedName: null };
  const currentStepUp = stepUp ?? serverStepUp;
  const tri = (v: boolean | null): string => (v === null ? "inherit" : v ? "on" : "off");
  const untri = (v: string): boolean | null => (v === "inherit" ? null : v === "on");
  const edit = (next: RuleDraft[]): void => {
    setRules(next);
    setSaved(false);
    setError(null);
  };
  const editStepUp = (next: { otp: boolean | null; typedName: boolean | null }): void => {
    setStepUp(next);
    setSaved(false);
    setError(null);
  };
  const modeLabel: Record<Mode, string> = {
    ANY: t("policy.modeANY"),
    ALL: t("policy.modeALL"),
    SEQUENTIAL: t("policy.modeSEQUENTIAL"),
  };
  const modeHint: Record<Mode, string> = {
    ANY: t("policy.hintANY"),
    ALL: t("policy.hintALL"),
    SEQUENTIAL: t("policy.hintSEQUENTIAL"),
  };

  const save = useMutation({
    mutationFn: async () => {
      const parsed: Array<{ uptoMinor: number | null; mode: Mode }> = [];
      let prev = -1;
      for (const [i, r] of current.entries()) {
        if (r.open && i !== current.length - 1) throw new Error(t("policy.ascendingError"));
        if (r.open) {
          parsed.push({ uptoMinor: null, mode: r.mode });
          continue;
        }
        const minor = Math.round(Number(r.upto) * 100);
        if (r.upto.trim() === "" || !Number.isFinite(minor) || minor < 0) throw new Error(t("policy.ascendingError"));
        if (minor <= prev) throw new Error(t("policy.ascendingError"));
        prev = minor;
        parsed.push({ uptoMinor: minor, mode: r.mode });
      }
      return api.patch(`/projects/${project.id}`, { settings: { approvalPolicies: parsed } });
    },
    onSuccess: () => {
      setRules(null);
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const saveStepUp = useMutation({
    mutationFn: async () =>
      api.patch(`/projects/${project.id}`, { settings: { stepUp: currentStepUp } }),
    onSuccess: () => {
      setStepUp(null);
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const serverDeemed = project.settings.deemedAcceptanceDays ?? null;
  const currentDeemed = deemed ?? (serverDeemed === null ? "" : String(serverDeemed));
  const saveDeemed = useMutation({
    mutationFn: async () => {
      const trimmed = currentDeemed.trim();
      if (trimmed === "") return api.patch(`/projects/${project.id}`, { settings: { deemedAcceptanceDays: null } });
      const days = Number(trimmed);
      if (!Number.isInteger(days) || days < 1 || days > 90) throw new Error(t("policy.deemedError"));
      return api.patch(`/projects/${project.id}`, { settings: { deemedAcceptanceDays: days } });
    },
    onSuccess: () => {
      setDeemed(null);
      setSaved(true);
      void client.invalidateQueries({ queryKey: ["project", project.id] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-slate-600">{t("policy.blurb")}</p>
      {current.length === 0 ? <Empty title={t("policy.empty")} hint={t("policy.hintANY")} /> : null}
      {current.length > 0 ? (
        <Card>
          <fieldset>
            <legend className="text-base font-semibold text-slate-900">{t("policy.title")}</legend>
            <ul className="mt-3 space-y-3">
              {current.map((r, i) => (
                <li key={i} className="grid items-end gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Field label={t("policy.upTo")} htmlFor={`policy-upto-${i}`}>
                    {r.open ? (
                      <p className="px-1 py-2 text-sm font-medium text-slate-700">{t("policy.anyAmount")}</p>
                    ) : (
                      <Input
                        id={`policy-upto-${i}`}
                        inputMode="decimal"
                        placeholder={t("policy.amountPlaceholder")}
                        value={r.upto}
                        onChange={(e) => edit(current.map((x, j) => (j === i ? { ...x, upto: e.target.value } : x)))}
                      />
                    )}
                  </Field>
                  <Field label={modeLabel[r.mode]} htmlFor={`policy-mode-${i}`} hint={modeHint[r.mode]}>
                    <Select
                      id={`policy-mode-${i}`}
                      value={r.mode}
                      onChange={(e) => edit(current.map((x, j) => (j === i ? { ...x, mode: e.target.value as Mode } : x)))}
                    >
                      {(["ANY", "ALL", "SEQUENTIAL"] as const).map((m) => (
                        <option key={m} value={m}>{modeLabel[m]}</option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex gap-2 pb-0.5">
                    {r.open ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => edit(current.map((x, j) => (j === i ? { ...x, open: false } : x)))}
                      >
                        {t("policy.upTo")}
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={i !== current.length - 1}
                        title={i !== current.length - 1 ? t("policy.ascendingError") : undefined}
                        onClick={() => edit(current.map((x, j) => (j === i ? { ...x, open: true, upto: "" } : x)))}
                      >
                        {t("policy.anyAmount")}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      aria-label={`${t("policy.removeRule")} ${i + 1}`}
                      onClick={() => edit(current.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>
        </Card>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {saved ? <p role="status" className="text-sm font-medium text-teal-800">{t("policy.saved")}</p> : null}
      <div className="flex flex-wrap gap-2">
        {current.length < 5 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              // A new rule goes last and open; any previously open rule
              // becomes capped so the list stays evaluable in order.
              const uncapped = current.map((x) => ({ ...x, open: false }));
              edit([...uncapped, { upto: "", open: true, mode: "ANY" }]);
            }}
          >
            {t("policy.addRule")}
          </Button>
        ) : null}
        <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
          {t("policy.save")}
        </Button>
      </div>
      {(project.settings.approvalPolicies ?? []).length > 0 && rules === null ? (
        <p className="text-sm text-slate-600">
          {(project.settings.approvalPolicies ?? [])
            .map((r) => (r.uptoMinor === null ? t("policy.anyAmount") : money(r.uptoMinor, project.currency)))
            .join(" → ")}
        </p>
      ) : null}
      <Card>
        <fieldset>
          <legend className="text-base font-semibold text-slate-900">{t("policy.stepUpTitle")}</legend>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("policy.stepUpBlurb")}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label={t("policy.otpLabel")} htmlFor="policy-stepup-otp">
              <Select
                id="policy-stepup-otp"
                value={tri(currentStepUp.otp)}
                onChange={(e) => editStepUp({ ...currentStepUp, otp: untri(e.target.value) })}
              >
                <option value="inherit">{t("policy.inherit")}</option>
                <option value="on">{t("policy.on")}</option>
                <option value="off">{t("policy.off")}</option>
              </Select>
            </Field>
            <Field label={t("policy.typedNameLabel")} htmlFor="policy-stepup-name">
              <Select
                id="policy-stepup-name"
                value={tri(currentStepUp.typedName)}
                onChange={(e) => editStepUp({ ...currentStepUp, typedName: untri(e.target.value) })}
              >
                <option value="inherit">{t("policy.inherit")}</option>
                <option value="on">{t("policy.on")}</option>
                <option value="off">{t("policy.off")}</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3">
            <Button type="button" disabled={saveStepUp.isPending} onClick={() => saveStepUp.mutate()}>
              {t("policy.savePolicy")}
            </Button>
          </div>
        </fieldset>
      </Card>
      <Card>
        <fieldset>
          <legend className="text-base font-semibold text-slate-900">{t("policy.deemedTitle")}</legend>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">{t("policy.deemedBlurb")}</p>
          <div className="mt-3 max-w-xs">
            <Field label={t("policy.deemedLabel")} htmlFor="policy-deemed-days">
              <Input
                id="policy-deemed-days"
                inputMode="numeric"
                placeholder={t("policy.deemedPlaceholder")}
                value={currentDeemed}
                onChange={(e) => { setDeemed(e.target.value); setSaved(false); setError(null); }}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Button type="button" disabled={saveDeemed.isPending} onClick={() => saveDeemed.mutate()}>
              {t("policy.savePolicy")}
            </Button>
          </div>
        </fieldset>
      </Card>
    </div>
  );
}

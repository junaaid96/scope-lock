import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import { LoadingScreen } from "../components/layout.js";
import { Button, Card, ErrorBanner, Field, Input, Textarea } from "../components/ui.js";
import { ScopeCheckPanel, type ScopeMatch } from "../components/scope-check.js";
import { useLocale } from "../lib/i18n/index.js";

interface IntakeInfo {
  projectName: string;
  organizationName: string;
  branding?: { displayName: string; logoUrl?: string; primaryColor?: string } | null;
}

export function IntakePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const info = useQuery({
    queryKey: ["intake", token],
    queryFn: () => api.get<IntakeInfo>(`/intake/${token}`),
    retry: false,
  });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [suggestedIds, setSuggestedIds] = useState<string[]>([]);
  const { t } = useLocale();

  if (info.isLoading) return <LoadingScreen message={t("intakeForm.loadingForm")} />;
  if (info.isError || !info.data) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <Card>
          <h1 className="mb-1 text-xl font-semibold">{t("intakeForm.unavailableTitle")}</h1>
          <p className="text-sm text-slate-600">{errorMessage(info.error)}</p>
          <p className="mt-3 text-sm"><Link to="/login" className="underline">{t("intakeForm.loginLink")}</Link> {t("intakeForm.loginSuffix")}</p>
        </Card>
      </div>
    );
  }
  const accent = info.data.branding?.primaryColor ?? "#0f766e";

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await api.post<{ received: boolean; number?: string }>(`/intake/${token}/submit`, {
        title,
        description,
        submitterName: name || undefined,
        submitterEmail: email || undefined,
        website,
        suggestedRequirementIds: suggestedIds,
      });
      setDone(res.number ?? "");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <header className="mb-6 flex items-center gap-3">
        {info.data.branding?.logoUrl ? <img src={info.data.branding.logoUrl} alt="" className="h-8 w-8 rounded" /> : null}
        <div>
          <p className="text-lg font-semibold" style={{ color: accent }}>
            {info.data.branding?.displayName ?? info.data.organizationName}
          </p>
          <p className="text-sm text-slate-600">{t("intakeForm.headerSubtitle", { project: info.data.projectName })}</p>
        </div>
      </header>
      <Card>
        <h1 className="text-xl font-semibold">{t("intakeForm.title")}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {t("intakeForm.blurb")}
        </p>
        {done !== null ? (
          <div className="mt-4 rounded-md bg-emerald-50 p-4 text-sm text-emerald-900" role="status">
            <p className="font-medium">{t("intakeForm.received", { ref: done ? t("intakeForm.receivedRef", { ref: done }) : "" })}</p>
            <p className="mt-1">{t("intakeForm.triageNote", { at: email ? t("intakeForm.triageAt", { email }) : "" })}</p>
          </div>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-3">
            <Field label={t("intakeForm.titleLabel")} htmlFor="intake-title" hint={t("intakeForm.titleHint")}>
              <Input id="intake-title" value={title} onChange={(e) => setTitle(e.target.value)} required minLength={4} maxLength={200} />
            </Field>
            <Field label={t("intakeForm.detailsLabel")} htmlFor="intake-description" hint={t("intakeForm.detailsHint")}>
              <Textarea id="intake-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} required minLength={20} maxLength={8000} />
            </Field>
            <ScopeCheckPanel
              title={title}
              description={description}
              onMatches={setSuggestedIds}
              onCheck={async (t, d) => {
                const res = await api.post<{ deterministic: ScopeMatch[] }>(`/intake/${token}/scope-check`, { title: t, description: d });
                return { deterministic: res.deterministic, aiNote: null };
              }}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("intakeForm.nameLabel")} htmlFor="intake-name">
                <Input id="intake-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" />
              </Field>
              <Field label={t("intakeForm.emailLabel")} htmlFor="intake-email">
                <Input id="intake-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} autoComplete="email" />
              </Field>
            </div>
            <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label htmlFor="intake-website">{t("intakeForm.websiteLabel")}</label>
              <input id="intake-website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
            </div>
            {error ? <ErrorBanner message={error} /> : null}
            <Button type="submit" disabled={saving} className="w-full" style={{ backgroundColor: accent }}>
              {saving ? t("intakeForm.sending") : t("intakeForm.send")}
            </Button>
          </form>
        )}
      </Card>
      <p className="mt-4 text-center text-xs text-slate-500">
        {t("intakeForm.footerNote")}
      </p>
    </div>
  );
}

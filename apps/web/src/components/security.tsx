import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import { Badge, Button, Card, ConfirmButton, Empty, ErrorBanner, Field, Input, Spinner, formatStatus } from "./ui.js";

interface OAuthAccount {
  provider: string;
  email: string;
  createdAt: string;
}

interface Passkey {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/** Personal card: link/unlink Google/GitHub (verified-email match required). */
export function OAuthCard(): JSX.Element {
  const client = useQueryClient();
  const { t } = useLocale();
  const accounts = useQuery({
    queryKey: ["oauth-accounts"],
    queryFn: () => api.get<{ data: OAuthAccount[] }>("/auth/oauth/accounts"),
  });
  const methods = useQuery({
    queryKey: ["auth-methods"],
    queryFn: () => api.get<{ google: boolean; github: boolean }>("/auth/methods"),
  });
  const [error, setError] = useState<string | null>(null);

  const unlink = async (provider: string): Promise<void> => {
    setError(null);
    try {
      await api.delete(`/auth/oauth/accounts/${provider}`);
      void client.invalidateQueries({ queryKey: ["oauth-accounts"] });
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const linked = new Set((accounts.data?.data ?? []).map((a) => a.provider));

  return (
    <Card>
      <h2 className="mb-1 text-[15px] font-semibold tracking-tight text-slate-900">{t("security.connectedTitle")}</h2>
      <p className="text-sm text-slate-600">{t("security.connectedHint")}</p>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {accounts.isLoading ? (
        <Spinner />
      ) : accounts.isError ? (
        <div className="mt-2"><ErrorBanner message={errorMessage(accounts.error)} /></div>
      ) : (accounts.data?.data ?? []).length === 0 ? (
        <div className="mt-2"><Empty title={t("security.noAccounts")} /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {(accounts.data?.data ?? []).map((a) => (
            <li key={a.provider} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
              <span>
                <Badge>{formatStatus(a.provider)}</Badge> <span className="ml-2 text-slate-700">{a.email}</span>
              </span>
              <ConfirmButton
                label={t("security.unlink")}
                confirmLabel={t("common.confirmUnlink")}
                cancelLabel={t("common.cancel")}
                onConfirm={() => void unlink(a.provider)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        {methods.data?.google && !linked.has("google") && (
          <a
            href="/api/v1/auth/oauth/google/start"
            className="rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100"
          >
            {t("security.linkGoogle")}
          </a>
        )}
        {methods.data?.github && !linked.has("github") && (
          <a
            href="/api/v1/auth/oauth/github/start"
            className="rounded-md border border-slate-300 bg-surface px-3 py-1.5 text-xs font-medium text-slate-800 transition-colors hover:bg-slate-100"
          >
            {t("security.linkGitHub")}
          </a>
        )}
      </div>
    </Card>
  );
}

/** Personal card: register and manage passkeys. */
export function PasskeysCard(): JSX.Element {
  const client = useQueryClient();
  const { t, date } = useLocale();
  const passkeys = useQuery({
    queryKey: ["passkeys"],
    queryFn: () => api.get<{ data: Passkey[] }>("/auth/passkeys"),
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ["passkeys"] });
  };

  const registerKey = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!name.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const options = await api.post<PublicKeyCredentialCreationOptionsJSON>("/auth/passkeys/register/start", {});
      const credential = await startRegistration({ optionsJSON: options });
      await api.post("/auth/passkeys/register/finish", { name: name.trim(), credential });
      setName("");
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: Passkey): Promise<void> => {
    setError(null);
    try {
      await api.delete(`/auth/passkeys/${key.id}`);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Card>
      <h2 className="mb-1 text-[15px] font-semibold tracking-tight text-slate-900">{t("security.passkeysTitle")}</h2>
      <p className="text-sm text-slate-600">{t("security.passkeysHint")}</p>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {passkeys.isLoading ? (
        <Spinner />
      ) : passkeys.isError ? (
        <div className="mt-2"><ErrorBanner message={errorMessage(passkeys.error)} /></div>
      ) : (passkeys.data?.data ?? []).length === 0 ? (
        <div className="mt-2"><Empty title={t("security.noPasskeys")} hint={t("security.noPasskeysHint")} /></div>
      ) : (
        <ul className="mt-2 space-y-2">
          {(passkeys.data?.data ?? []).map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 p-2 text-sm">
              <span className="font-medium text-slate-900">{k.name}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-slate-500">
                  {k.lastUsedAt ? t("security.lastUsed", { date: date(k.lastUsedAt) }) : t("security.neverUsed")}
                </span>
                <ConfirmButton
                  label={t("security.delete")}
                  confirmLabel={t("common.confirmDelete")}
                  cancelLabel={t("common.cancel")}
                  onConfirm={() => void remove(k)}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={(e) => void registerKey(e)} className="mt-3 flex gap-2">
        <div className="flex-1">
          <Field label={t("security.newNameLabel")} htmlFor="pk-name">
            <Input id="pk-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("security.namePlaceholder")} autoComplete="off" />
          </Field>
        </div>
        <div className="flex items-end">
          <Button type="submit" size="sm" disabled={busy || !name.trim()}>
            {busy ? t("security.waiting") : t("security.register")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

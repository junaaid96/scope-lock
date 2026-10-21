import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api.js";
import { useLocale } from "../lib/i18n/index.js";
import type { NotificationPreferences } from "../lib/types.js";
import { Badge, Button, Card, ErrorBanner, Field, Input, Spinner } from "./ui.js";

/** Per-user notification channels: phone + per-channel toggles. */
export function PreferencesCard(): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const prefs = useQuery({
    queryKey: ["my-preferences"],
    queryFn: () => api.get<NotificationPreferences>("/auth/me/preferences"),
  });
  const [phone, setPhone] = useState<string | null>(null);
  const [toggles, setToggles] = useState<{ email: boolean; sms: boolean; whatsapp: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = prefs.data;
  const phoneValue = phone ?? current?.phoneE164 ?? "";
  const toggleValue = toggles ?? {
    email: current?.notifyEmail ?? true,
    sms: current?.notifySms ?? true,
    whatsapp: current?.notifyWhatsapp ?? true,
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch<NotificationPreferences>("/auth/me/preferences", {
        phoneE164: phoneValue.trim() === "" ? null : phoneValue.trim(),
        notifyEmail: toggleValue.email,
        notifySms: toggleValue.sms,
        notifyWhatsapp: toggleValue.whatsapp,
      }),
    onSuccess: (data) => {
      setError(null);
      setNotice(t("channels.saved"));
      setPhone(data.phoneE164);
      setToggles({ email: data.notifyEmail, sms: data.notifySms, whatsapp: data.notifyWhatsapp });
      void client.invalidateQueries({ queryKey: ["my-preferences"] });
    },
    onError: (err) => {
      setNotice(null);
      setError(errorMessage(err));
    },
  });

  return (
    <Card>
      <h2 className="mb-1 text-[15px] font-semibold tracking-tight text-slate-900">{t("channels.prefsTitle")}</h2>
      <p className="mb-3 text-sm text-slate-600">{t("channels.prefsHint")}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <p className="mb-2 text-sm text-slate-600" role="status">{notice}</p> : null}
      {prefs.isLoading ? <Spinner /> : prefs.isError ? (
        <ErrorBanner message={errorMessage(prefs.error)} />
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label={t("channels.phone")} hint={t("channels.phoneHint")} htmlFor="prefs-phone">
            <Input
              id="prefs-phone"
              type="tel"
              autoComplete="tel"
              value={phoneValue}
              maxLength={20}
              placeholder="+8801712345678"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">{t("channels.prefsTitle")}</legend>
            <div className="space-y-1">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={toggleValue.email}
                  onChange={(e) => setToggles({ ...toggleValue, email: e.target.checked })}
                />
                {t("channels.email")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={toggleValue.sms}
                  onChange={(e) => setToggles({ ...toggleValue, sms: e.target.checked })}
                />
                {t("channels.sms")}
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={toggleValue.whatsapp}
                  onChange={(e) => setToggles({ ...toggleValue, whatsapp: e.target.checked })}
                />
                {t("channels.whatsapp")}
              </label>
            </div>
          </fieldset>
          <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>{t("channels.save")}</Button>
        </form>
      )}
    </Card>
  );
}

/** Org-level Slack incoming-webhook connection (owners/admins manage). */
export function SlackCard({ organizationId, slackConfigured, canManage, onDone }: {
  organizationId: string;
  slackConfigured: boolean;
  canManage: boolean;
  onDone: () => void;
}): JSX.Element {
  const { t } = useLocale();
  const [url, setUrl] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: (webhookUrl: string | null) =>
      api.patch(`/organizations/${organizationId}/slack`, { slackWebhookUrl: webhookUrl }),
    onSuccess: () => {
      setError(null);
      setUrl("");
      setConfirming(false);
      onDone();
    },
    onError: (err) => {
      setConfirming(false);
      setError(errorMessage(err));
    },
  });

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">{t("channels.slackTitle")}</h2>
        {slackConfigured ? <Badge tone="green">{t("channels.connected")}</Badge> : <Badge tone="slate">{t("channels.notConnected")}</Badge>}
      </div>
      <p className="mb-3 text-sm text-slate-600">{t("channels.slackHint")}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {!canManage ? <p className="text-sm text-slate-600">{t("channels.staffOnly")}</p> : slackConfigured ? (
        <div>
          {confirming ? <p className="mb-2 text-sm text-slate-600" role="status">{t("channels.disconnectConfirm")}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={confirming ? "danger" : "secondary"}
              disabled={save.isPending}
              onClick={() => (confirming ? save.mutate(null) : setConfirming(true))}
            >
              {t("channels.disconnect")}
            </Button>
            {confirming ? <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>{t("channels.cancel")}</Button> : null}
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim() !== "") save.mutate(url.trim());
          }}
        >
          <Field label={t("channels.slackUrl")} hint={t("channels.slackUrlHint")} htmlFor="slack-url">
            <Input
              id="slack-url"
              type="url"
              value={url}
              maxLength={2000}
              placeholder="https://hooks.slack.com/services/…"
              onChange={(e) => setUrl(e.target.value)}
              required
            />
          </Field>
          <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>{t("channels.connect")}</Button>
        </form>
      )}
    </Card>
  );
}

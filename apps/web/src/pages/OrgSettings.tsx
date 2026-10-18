import { useState } from "react";
import { useLocale } from "../lib/i18n/index.js";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { useSession } from "../lib/auth.js";
import { Badge, Button, Card, ErrorBanner, Field, Input, PageTitle, Select, Spinner, PageSkeleton } from "../components/ui.js";
import { RateCardsCard, TemplatesCard } from "../components/pricing-settings.js";
import { ApiKeysCard, WebhooksCard } from "../components/integrations-settings.js";
import { PreferencesCard, SlackCard } from "../components/channels.js";
import { ScopeTemplatesCard } from "../components/templates.js";
import { OAuthCard, PasskeysCard } from "../components/security.js";

interface Member {
  id: string;
  userId: string;
  role: string;
  user: { name: string; email: string } | null;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
}

interface Usage {
  period: string;
  plan: string;
  usage: { aiCalls: number; storageBytes: number; emailsSent: number; projectsCreated: number };
  limits: { projects: number; aiCallsPerMonth: number; storageBytes: number };
  projectCount: number;
}

interface Org {
  id: string;
  name: string;
  plan: string;
  aiEnabled: boolean;
  branding: { displayName: string; logoUrl?: string; primaryColor?: string } | null;
  settings?: { stepUp?: { otp?: boolean | null; typedName?: boolean | null }; defaultLocale?: string };
  slackConfigured: boolean;
}

export function OrgSettingsPage(): JSX.Element {
  const { t } = useLocale();
  const { id } = useParams<{ id: string }>();
  const orgId = id as string;
  const client = useQueryClient();
  const org = useQuery({ queryKey: ["org", orgId], queryFn: () => api.get<Org>(`/organizations/${orgId}`) });
  const members = useQuery({ queryKey: ["org-members", orgId], queryFn: () => fetchAll<Member>(`/organizations/${orgId}/members`) });
  const invitations = useQuery({ queryKey: ["invites", orgId], queryFn: () => fetchAll<Invitation>(`/organizations/${orgId}/invitations`) });
  const usage = useQuery({ queryKey: ["usage", orgId], queryFn: () => api.get<Usage>(`/organizations/${orgId}/usage`) });
  const { session } = useSession();
  const myRole = session?.organizations.find((o) => o.id === orgId)?.role ?? null;
  const canManage = myRole === "OWNER" || myRole === "ADMIN";

  if (org.isLoading) return <PageSkeleton />;
  if (org.isError || !org.data) return <ErrorBanner message={errorMessage(org.error)} />;

  return (
    <div>
      <PageTitle
        title={t("orgSettings.title", { name: org.data.name })}
        subtitle={t("orgSettings.planSubtitle", { plan: org.data.plan })}
        actions={<Link to="/"><Button variant="secondary" size="sm">{t("orgSettings.backToProjects")}</Button></Link>}
      />
      <div className="space-y-5">
        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.members")}</h2>
          <ul className="divide-y divide-slate-100">
            {(members.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>{m.user?.name} <span className="text-slate-500">({m.user?.email})</span></span>
                <span className="flex items-center gap-2">
                  <RolePicker orgId={orgId} member={m} onDone={() => void client.invalidateQueries({ queryKey: ["org-members", orgId] })} />
                  <RemoveMemberButton orgId={orgId} member={m} onDone={() => void client.invalidateQueries({ queryKey: ["org-members", orgId] })} />
                </span>
              </li>
            ))}
          </ul>
          <InviteForm orgId={orgId} onDone={() => void client.invalidateQueries({ queryKey: ["invites", orgId] })} />
          {(invitations.data ?? []).filter((i) => i.status === "PENDING").length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-medium">{t("orgSettings.pendingInvitations")}</h3>
              <ul className="mt-1 space-y-1 text-sm">
                {(invitations.data ?? []).filter((i) => i.status === "PENDING").map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <span>{i.email} ({i.role})</span>
                    <RevokeButton orgId={orgId} inviteId={i.id} onDone={() => void client.invalidateQueries({ queryKey: ["invites", orgId] })} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.signInSecurity")}</h2>
          <MfaCard />
        </Card>

        <OAuthCard />
        <PasskeysCard />

        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.aiAssistance")}</h2>
          <AIToggle org={org.data} onDone={() => void client.invalidateQueries({ queryKey: ["org", orgId] })} />
        </Card>

        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.brandingTitle")}</h2>
          <BrandingForm org={org.data} onDone={() => void client.invalidateQueries({ queryKey: ["org", orgId] })} />
        </Card>

        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.stepUpTitle")}</h2>
          <StepUpCard org={org.data} onDone={() => void client.invalidateQueries({ queryKey: ["org", orgId] })} />
        </Card>

        {canManage ? (
          <Card>
            <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.localeTitle")}</h2>
            <LocaleCard org={org.data} onDone={() => void client.invalidateQueries({ queryKey: ["org", orgId] })} />
          </Card>
        ) : null}

        <RateCardsCard organizationId={orgId} canManage={canManage} />
        <TemplatesCard organizationId={orgId} canManage={canManage} />
        <ScopeTemplatesCard organizationId={orgId} canManage={canManage} />
        <ApiKeysCard organizationId={orgId} canManage={canManage} />
        <WebhooksCard organizationId={orgId} canManage={canManage} />
        <PreferencesCard />
        {org.data ? (
          <SlackCard
            organizationId={orgId}
            slackConfigured={org.data.slackConfigured}
            canManage={canManage}
            onDone={() => void client.invalidateQueries({ queryKey: ["org", orgId] })}
          />
        ) : null}
        <Card>
          <h2 className="mb-2 text-[15px] font-semibold tracking-tight text-slate-900">{t("orgSettings.usageTitle", { period: usage.data?.period ?? t("common.notAvailable") })}</h2>
          {usage.isLoading ? <Spinner /> : usage.isError ? (
            <p className="text-sm text-slate-600">{t("orgSettings.usageStaffOnly")}</p>
          ) : usage.data ? (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-slate-500">{t("orgSettings.usageProjects")}</dt>
              <dd>{usage.data.projectCount} / {usage.data.limits.projects}</dd>
              <dt className="text-slate-500">{t("orgSettings.usageAiCalls")}</dt>
              <dd>{usage.data.usage.aiCalls} / {usage.data.limits.aiCallsPerMonth}</dd>
              <dt className="text-slate-500">{t("orgSettings.usageStorage")}</dt>
              <dd>{t("orgSettings.storageUsage", { used: Math.round(usage.data.usage.storageBytes / 1024), limit: Math.round(usage.data.limits.storageBytes / 1024 / 1024) })}</dd>
              <dt className="text-slate-500">{t("orgSettings.usageEmails")}</dt>
              <dd>{usage.data.usage.emailsSent}</dd>
            </dl>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function RolePicker({ orgId, member, onDone }: { orgId: string; member: Member; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (role: string) => api.patch(`/organizations/${orgId}/members/${member.userId}`, { role }),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <span className="flex items-center gap-2">
      <Select aria-label={t("orgSettings.roleFor", { email: member.user?.email ?? member.userId })} value={member.role} onChange={(e) => save.mutate(e.target.value)} className="w-auto">
        <option value="OWNER">OWNER</option>
        <option value="ADMIN">ADMIN</option>
        <option value="MEMBER">MEMBER</option>
        <option value="CLIENT">CLIENT</option>
      </Select>
      {error ? <Badge tone="red">{error}</Badge> : null}
    </span>
  );
}

function InviteForm({ orgId, onDone }: { orgId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api.post<{ invitation: Invitation; acceptUrl?: string }>(`/organizations/${orgId}/invitations`, { email, role }),
    onSuccess: (res) => {
      setEmail("");
      setError(null);
      setLink(res.acceptUrl ?? null);
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <form className="mt-4" onSubmit={(e) => { e.preventDefault(); invite.mutate(); }}>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <Field label={t("orgSettings.inviteByEmail")} htmlFor="invite-email">
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
        </div>
        <div>
          <Field label={t("orgSettings.roleLabel")} htmlFor="invite-role">
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="ADMIN">ADMIN</option>
              <option value="MEMBER">MEMBER</option>
              <option value="CLIENT">CLIENT</option>
              <option value="OWNER">OWNER</option>
            </Select>
          </Field>
        </div>
        <Button type="submit" disabled={invite.isPending}>{t("orgSettings.sendInvite")}</Button>
      </div>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {link ? <p className="mt-2 text-sm">{t("orgSettings.inviteLinkDevOnly")} <a className="underline" href={link}>{link}</a></p> : null}
    </form>
  );
}

function RemoveMemberButton({ orgId, member, onDone }: { orgId: string; member: Member; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.delete(`/organizations/${orgId}/members/${member.userId}`),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <span className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={remove.isPending}
        onClick={() => {
          if (window.confirm(t("orgSettings.removeMemberConfirm", { email: member.user?.email ?? t("orgSettings.thisMember") }))) {
            remove.mutate();
          }
        }}
      >
        {t("orgSettings.remove")}
      </Button>
      {error ? <Badge tone="red">{error}</Badge> : null}
    </span>
  );
}

function RevokeButton({ orgId, inviteId, onDone }: { orgId: string; inviteId: string; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const revoke = useMutation({
    mutationFn: () => api.delete(`/organizations/${orgId}/invitations/${inviteId}`),
    onSuccess: onDone,
  });
  return <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate()}>{t("orgSettings.revoke")}</Button>;
}

function MfaCard(): JSX.Element {
  const { t } = useLocale();
  const client = useQueryClient();
  const [secret, setSecret] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.get<{ user: { mfaEnabled: boolean } }>("/auth/me") });
  const enabled = me.data?.user.mfaEnabled ?? false;

  const setup = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauthUrl: string }>("/auth/mfa/setup"),
    onSuccess: (res) => { setError(null); setSecret(res); },
    onError: (err) => setError(errorMessage(err)),
  });
  const verify = useMutation({
    mutationFn: () => api.post<{ recoveryCodes: string[] }>("/auth/mfa/verify", { code }),
    onSuccess: (res) => {
      setError(null);
      setSecret(null);
      setCode("");
      setRecovery(res.recoveryCodes);
      void client.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const disable = useMutation({
    mutationFn: () => api.post("/auth/mfa/disable", { password }),
    onSuccess: () => {
      setError(null);
      setPassword("");
      setRecovery(null);
      void client.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  if (me.isLoading) return <PageSkeleton />;
  return (
    <div className="text-sm">
      <p>
        {t("orgSettings.mfaStatus")} {enabled ? <Badge tone="green">{t("orgSettings.mfaEnabled")}</Badge> : <Badge>{t("orgSettings.mfaOff")}</Badge>}
        <span className="ml-2 text-xs text-slate-500">{t("orgSettings.mfaHint")}</span>
      </p>
      {!enabled && !secret ? (
        <Button size="sm" className="mt-3" disabled={setup.isPending} onClick={() => setup.mutate()}>{t("orgSettings.mfaSetup")}</Button>
      ) : null}
      {secret ? (
        <div className="mt-3 space-y-3 rounded-md border border-slate-200 p-3">
          <p>{t("orgSettings.mfaAddSecret")}</p>
          <p className="break-all rounded bg-slate-100 p-2 font-mono text-xs">{secret.secret}</p>
          <Field label={t("orgSettings.mfaCodeLabel")} htmlFor="mfa-code">
            <Input id="mfa-code" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} />
          </Field>
          <Button size="sm" disabled={verify.isPending || !code} onClick={() => verify.mutate()}>{t("orgSettings.mfaVerify")}</Button>
        </div>
      ) : null}
      {recovery ? (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="font-medium">{t("orgSettings.mfaRecoveryTitle")}</p>
          <ul className="mt-1 font-mono text-xs">{recovery.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      ) : null}
      {enabled ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label={t("orgSettings.mfaPasswordLabel")} htmlFor="mfa-disable-pw">
            <Input id="mfa-disable-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button size="sm" variant="secondary" disabled={disable.isPending || !password} onClick={() => disable.mutate()}>{t("orgSettings.mfaDisable")}</Button>
        </div>
      ) : null}
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

function StepUpCard({ org, onDone }: { org: Org; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<{ otp?: boolean | null; typedName?: boolean | null } | null>(null);
  const current = local ?? org.settings?.stepUp ?? {};
  const save = useMutation({
    mutationFn: (stepUp: { otp?: boolean; typedName?: boolean }) => api.patch(`/organizations/${org.id}`, { stepUp }),
    onSuccess: () => { setError(null); setLocal(null); onDone(); },
    onError: (err) => { setError(errorMessage(err)); setLocal(null); },
  });
  const toggle = (key: "otp" | "typedName", value: boolean): void => {
    setLocal({ ...current, [key]: value });
    save.mutate({ [key]: value });
  };
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">
        {t("orgSettings.stepUpBlurb")}{" "}
        {t("orgSettings.notEsignature")}
      </p>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.otp ?? false}
            onChange={(e) => toggle("otp", e.target.checked)}
          />
          {t("orgSettings.stepUpOtp")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={current.typedName ?? false}
            onChange={(e) => toggle("typedName", e.target.checked)}
          />
          {t("orgSettings.stepUpTypedName")}
        </label>
      </div>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

function LocaleCard({ org, onDone }: { org: Org; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (defaultLocale: string) => api.patch(`/organizations/${org.id}`, { defaultLocale }),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div>
      <p className="mb-2 text-sm text-slate-600">
        {t("orgSettings.localeBlurb")}
      </p>
      <Field label={t("orgSettings.localeLabel")} htmlFor="org-locale">
        <Select
          id="org-locale"
          value={org.settings?.defaultLocale ?? "en"}
          onChange={(e) => save.mutate(e.target.value)}
          disabled={save.isPending}
        >
          <option value="en">{t("policy.localeEnglish")}</option>
          <option value="bn">{t("policy.localeBangla")}</option>
        </Select>
      </Field>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

function AIToggle({ org, onDone }: { org: Org; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (aiEnabled: boolean) => api.patch(`/organizations/${org.id}`, { aiEnabled }),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={org.aiEnabled} onChange={(e) => save.mutate(e.target.checked)} />
        {t("orgSettings.aiToggleLabel")}
      </label>
      <p className="mt-1 text-xs text-slate-500">{t("orgSettings.aiAdvisory")}</p>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
    </div>
  );
}

function BrandingForm({ org, onDone }: { org: Org; onDone: () => void }): JSX.Element {
  const { t } = useLocale();
  const [displayName, setDisplayName] = useState(org.branding?.displayName ?? org.name);
  const [logoUrl, setLogoUrl] = useState(org.branding?.logoUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(org.branding?.primaryColor ?? "#0f766e");
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/organizations/${org.id}`, {
        branding: { displayName, ...(logoUrl ? { logoUrl } : {}), ...(primaryColor ? { primaryColor } : {}) },
      }),
    onSuccess: () => { setError(null); onDone(); },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <Field label={t("orgSettings.displayName")} htmlFor="brand-name">
        <Input id="brand-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </Field>
      <Field label={t("orgSettings.logoUrl")} htmlFor="brand-logo">
        <Input id="brand-logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label={t("orgSettings.primaryColor")} htmlFor="brand-color">
        <Input id="brand-color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} pattern="#[0-9a-fA-F]{6}" />
      </Field>
      {error ? <ErrorBanner message={error} /> : null}
      <Button size="sm" type="submit" disabled={save.isPending}>{t("orgSettings.saveBranding")}</Button>
    </form>
  );
}

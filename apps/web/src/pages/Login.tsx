import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { LoginSchema } from "@scopelock/contracts";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { CreditPill } from "../components/credit.js";
import { Button, Card, ErrorBanner, Field, Input, LogoMark, Wordmark } from "../components/ui.js";
import { useLocale } from "../lib/i18n/index.js";



type Form = z.infer<typeof LoginSchema>;


const DEMO_PASSWORD = "password1234";



export function LoginPage(): JSX.Element {
  const { t } = useLocale();
  const navigate = useNavigate();
  const OAUTH_ERRORS: Record<string, string> = {
    denied: t("auth.oauthDenied"),
    nolink: t("auth.oauthNoLink"),
    mismatch: t("auth.oauthMismatch"),
    taken: t("auth.oauthTaken"),
    linked: t("auth.oauthLinked"),
    failed: t("auth.oauthFailed"),
    invalid: t("auth.oauthInvalid"),
  };
  /** One-click logins for the `npm run seed:portfolio` demo workspace. */
  const DEMO_ACCOUNTS: Array<{ label: string; detail: string; email: string }> = [
    { label: t("auth.demoOwner"), detail: "Junaid · full workspace", email: "demo@codejborg.studio" },
    { label: t("auth.demoGreenBiotech"), detail: "Nazmul · approver", email: "nazmul@greenbiotech.test" },
    { label: t("auth.demoHaat"), detail: "Tanvir · approver", email: "tanvir@haat.test" },
    { label: t("auth.demoQuickFood"), detail: "Sakib · approver", email: "sakib@quickfood.test" },
    { label: t("auth.demoNibash"), detail: "Rahim · approver", email: "rahim@privateclient.test" },
    { label: t("auth.demoHealthOps"), detail: "Dr. Sadia · approver", email: "sadia@healthops.test" },
  ];
  const HIGHLIGHTS: Array<{ title: string; body: string }> = [
    { title: t("auth.highlightLedgerTitle"), body: t("auth.highlightLedgerBody") },
    { title: t("auth.highlightChangesTitle"), body: t("auth.highlightChangesBody") },
    { title: t("auth.highlightApprovalsTitle"), body: t("auth.highlightApprovalsBody") },
    { title: t("auth.highlightHealthTitle"), body: t("auth.highlightHealthBody") },
  ];
  const [params] = useSearchParams();
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ google: boolean; github: boolean; passkey: boolean } | null>(null);
  const [pkEmail, setPkEmail] = useState("");
  const [pkBusy, setPkBusy] = useState(false);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(LoginSchema) });

  // OAuth callback landings: MFA ticket continues to TOTP; errors explain.
  useEffect(() => {
    const mfaTicket = params.get("mfaTicket");
    if (mfaTicket) setTicket(mfaTicket);
    const oauthError = params.get("oauthError");
    if (oauthError) setError({ message: OAUTH_ERRORS[oauthError] ?? OAUTH_ERRORS.failed ?? t("auth.signInFailed") });
  }, [params]);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ google: boolean; github: boolean; passkey: boolean }>("/auth/methods")
      .then((m) => {
        if (!cancelled) setMethods(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const loginWithPasskey = async (): Promise<void> => {
    setError(null);
    setPkBusy(true);
    try {
      const options = await api.post<PublicKeyCredentialRequestOptionsJSON>("/auth/passkeys/login/start", {
        ...(pkEmail.trim() ? { email: pkEmail.trim() } : {}),
      });
      const credential = await startAuthentication({ optionsJSON: options });
      const res = await api.post<{ mfaRequired?: boolean; mfaTicket?: string }>("/auth/passkeys/login/finish", {
        credential,
      });
      if (res.mfaRequired && res.mfaTicket) {
        setTicket(res.mfaTicket);
        return;
      }
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({ message: errorMessage(err) });
    } finally {
      setPkBusy(false);
    }
  };

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const res = await api.post<{ mfaRequired?: boolean; mfaTicket?: string }>("/auth/login", values);
      if (res.mfaRequired && res.mfaTicket) {
        setTicket(res.mfaTicket);
        return;
      }
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    }
  });

  const loginAsDemo = async (email: string): Promise<void> => {
    setError(null);
    setDemoBusy(email);
    try {
      const res = await api.post<{ mfaRequired?: boolean; mfaTicket?: string }>("/auth/login", { email, password: DEMO_PASSWORD });
      if (res.mfaRequired && res.mfaTicket) {
        setTicket(res.mfaTicket);
        return;
      }
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({
        message: t("auth.demoLoginFailed", { error: errorMessage(err) }),
        correlationId: err instanceof ApiError ? err.correlationId : undefined,
      });
    } finally {
      setDemoBusy(null);
    }
  };

  const onChallenge = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!ticket) return;
    setError(null);
    setMfaBusy(true);
    try {
      await api.post("/auth/mfa/challenge", { ticket, code: mfaCode });
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    } finally {
      setMfaBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="relative hidden w-[460px] shrink-0 flex-col overflow-hidden bg-gradient-to-br from-teal-800 via-teal-700 to-teal-900 px-12 py-12 text-white lg:flex">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-teal-300/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-sky-400/20 blur-3xl" />
        <Link to="/welcome" className="relative inline-flex items-center gap-2.5 text-xl font-semibold tracking-tight" aria-label="ScopeLock">
          <LogoMark className="size-9 bg-white/15 from-transparent to-transparent ring-white/30" />
          ScopeLock
        </Link>
        <p className="relative mt-3 max-w-xs text-[15px] leading-relaxed text-teal-50/90">{t("auth.heroTagline")}</p>
        <ol className="relative mt-12 space-y-5">
          {HIGHLIGHTS.map((h, i) => (
            <li key={h.title} className="flex gap-4 rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-white/15 font-mono text-xs font-semibold text-teal-100">0{i + 1}</span>
              <div>
                <p className="text-sm font-semibold">{h.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-teal-50/80">{h.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="relative mt-auto pt-10 text-xs text-teal-100/80">{t("auth.heroFooter")}</p>
      </aside>

      <main className="bg-aurora flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md animate-fade-up">
          <Link to="/welcome" className="mb-6 flex justify-center lg:hidden" aria-label="ScopeLock"><Wordmark /></Link>
          <Card className="p-6 shadow-lift sm:p-8">
            <h1 className="mb-1 text-2xl font-semibold tracking-tight">{t("auth.login")}</h1>
            <p className="mb-5 text-sm text-slate-600">{t("auth.loginSubtitle")}</p>
            {ticket ? (
              <form onSubmit={(e) => void onChallenge(e)} className="space-y-4">
                <p className="text-sm text-slate-600">{t("auth.mfaPrompt")}</p>
                <Field label={t("auth.mfaCodeLabel")} htmlFor="mfa-code">
                  <Input id="mfa-code" inputMode="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
                </Field>
                {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
                <Button type="submit" disabled={mfaBusy || !mfaCode} className="w-full">
                  {mfaBusy ? t("auth.verifying") : t("auth.verify")}
                </Button>
              </form>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
                <Field label={t("auth.emailLabel")} error={formState.errors.email?.message} htmlFor="email">
                  <Input id="email" type="email" autoComplete="email" {...register("email")} />
                </Field>
                <Field label={t("auth.passwordLabel")} error={formState.errors.password?.message} htmlFor="password">
                  <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
                </Field>
                {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
                <Button type="submit" disabled={formState.isSubmitting} className="w-full">
                  {formState.isSubmitting ? t("auth.loggingIn") : t("auth.login")}
                </Button>
              </form>
            )}
            {ticket ? null : (
              <div className="mt-4 border-t border-slate-200 pt-4">
                {(methods?.google || methods?.github) && (
                  <div className="flex gap-2">
                    {methods.google && (
                      <a
                        href="/api/v1/auth/oauth/google/start"
                        className="tap flex-1 rounded-xl border border-slate-200 bg-surface px-3 py-2 text-center text-sm font-medium text-slate-800 shadow-card transition-colors hover:border-slate-300 hover:bg-slate-50"
                      >
                        {t("auth.continueGoogle")}
                      </a>
                    )}
                    {methods.github && (
                      <a
                        href="/api/v1/auth/oauth/github/start"
                        className="tap flex-1 rounded-xl border border-slate-200 bg-surface px-3 py-2 text-center text-sm font-medium text-slate-800 shadow-card transition-colors hover:border-slate-300 hover:bg-slate-50"
                      >
                        {t("auth.continueGithub")}
                      </a>
                    )}
                  </div>
                )}
                <div className="mt-3 flex gap-2">
                  <div className="flex-1">
                    <label htmlFor="pk-email" className="sr-only">{t("auth.passkeyLabel")}</label>
                    <Input
                      id="pk-email"
                      type="email"
                      autoComplete="email webauthn"
                      placeholder={t("auth.passkeyPlaceholder")}
                      value={pkEmail}
                      onChange={(e) => setPkEmail(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="secondary" disabled={pkBusy} onClick={() => void loginWithPasskey()}>
                    {pkBusy ? t("auth.passkeyWaiting") : t("auth.passkeyButton")}
                  </Button>
                </div>
              </div>
            )}
            <p className="mt-4 text-center text-sm text-slate-600">
              {t("auth.noAccount")}{" "}<Link to="/register" className="font-medium text-link underline-offset-2 hover:underline">{t("auth.createOne")}</Link>
              {" · "}
              <Link to="/reset-password" className="font-medium text-link underline-offset-2 hover:underline">{t("auth.resetPasswordLink")}</Link>
            </p>
            {ticket ? null : (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <p className="mb-1 text-sm font-medium text-slate-800">{t("auth.demoTitle")}</p>
                <p className="mb-3 text-xs text-slate-600">{t("auth.demoSubtitle")}</p>
                <ul className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((a) => (
                    <li key={a.email}>
                      <button
                        type="button"
                        disabled={demoBusy !== null}
                        onClick={() => void loginAsDemo(a.email)}
                        className="lift w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-sm transition-colors hover:border-teal-600 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="block font-medium text-slate-900">
                          {demoBusy === a.email ? t("auth.signingIn") : a.label}
                        </span>
                        <span className="block text-xs text-slate-500">{a.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
          <div className="mt-8 flex justify-center">
            <CreditPill />
          </div>
        </div>
      </main>
    </div>
  );
}

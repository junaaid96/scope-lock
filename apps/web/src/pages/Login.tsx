import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginSchema } from "@scopelock/contracts";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { CreditPill } from "../components/credit.js";
import { Button, Card, ErrorBanner, Field, Input } from "../components/ui.js";

type Form = z.infer<typeof LoginSchema>;

/** One-click logins for the `npm run seed:portfolio` demo workspace. */
const DEMO_ACCOUNTS: Array<{ label: string; detail: string; email: string }> = [
  { label: "Agency owner", detail: "Junaid · full workspace", email: "demo@codejborg.studio" },
  { label: "Green Biotech", detail: "Nazmul · approver", email: "nazmul@greenbiotech.test" },
  { label: "Haat", detail: "Tanvir · approver", email: "tanvir@haat.test" },
  { label: "QuickFood", detail: "Sakib · approver", email: "sakib@quickfood.test" },
  { label: "Nibash", detail: "Rahim · approver", email: "rahim@privateclient.test" },
  { label: "HealthOps", detail: "Dr. Sadia · approver", email: "sadia@healthops.test" },
];
const DEMO_PASSWORD = "password1234";

const HIGHLIGHTS: Array<{ title: string; body: string }> = [
  { title: "Versioned scope ledger", body: "A frozen, agreed record of what will be delivered — never a chat thread." },
  { title: "Change requests", body: "Every ask captured, linked to the baseline, and priced before it happens." },
  { title: "Client approvals", body: "Review links with immutable packages, decisions, and a full audit trail." },
  { title: "Impact & health", body: "Price, effort, and timeline effects up front, plus explainable health signals." },
];

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(LoginSchema) });

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
        message: `${errorMessage(err)} (demo accounts come from \`npm run seed:portfolio\`)`,
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
    <div className="flex min-h-screen">
      <aside className="hidden w-[400px] shrink-0 flex-col bg-teal-800 px-10 py-12 text-white lg:flex">
        <p className="text-xl font-semibold tracking-tight">ScopeLock</p>
        <p className="mt-2 text-sm text-teal-100">The shared system of record for client scope, change requests, and approvals.</p>
        <ol className="mt-10 space-y-6">
          {HIGHLIGHTS.map((h, i) => (
            <li key={h.title} className="flex gap-4">
              <span aria-hidden="true" className="font-mono text-sm text-teal-300">0{i + 1}</span>
              <div>
                <p className="text-sm font-semibold">{h.title}</p>
                <p className="mt-0.5 text-sm text-teal-100">{h.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-auto pt-10 text-xs text-teal-200">Agreed scope · priced changes · signed decisions.</p>
      </aside>

      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <p className="mb-6 text-center text-xl font-semibold tracking-tight lg:hidden">ScopeLock</p>
          <Card>
            <h1 className="mb-1 text-xl font-semibold">Log in</h1>
            <p className="mb-5 text-sm text-slate-600">Welcome back to your scope ledger.</p>
            {ticket ? (
              <form onSubmit={(e) => void onChallenge(e)} className="space-y-4">
                <p className="text-sm text-slate-600">Your account uses two-factor authentication. Enter a code from your authenticator app (or a recovery code).</p>
                <Field label="Authenticator code" htmlFor="mfa-code">
                  <Input id="mfa-code" inputMode="text" autoComplete="one-time-code" value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} />
                </Field>
                {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
                <Button type="submit" disabled={mfaBusy || !mfaCode} className="w-full">
                  {mfaBusy ? "Verifying…" : "Verify"}
                </Button>
              </form>
            ) : (
              <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
                <Field label="Email" error={formState.errors.email?.message} htmlFor="email">
                  <Input id="email" type="email" autoComplete="email" {...register("email")} />
                </Field>
                <Field label="Password" error={formState.errors.password?.message} htmlFor="password">
                  <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
                </Field>
                {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
                <Button type="submit" disabled={formState.isSubmitting} className="w-full">
                  {formState.isSubmitting ? "Logging in…" : "Log in"}
                </Button>
              </form>
            )}
            <p className="mt-4 text-center text-sm text-slate-600">
              No account? <Link to="/register" className="font-medium text-teal-800 underline">Create one</Link>
              {" · "}
              <Link to="/reset-password" className="font-medium text-teal-800 underline">Reset password</Link>
            </p>
            {ticket ? null : (
              <div className="mt-6 border-t border-slate-200 pt-4">
                <p className="mb-1 text-sm font-medium text-slate-800">Explore the demo workspace</p>
                <p className="mb-3 text-xs text-slate-600">One-click sign in as the agency or a client approver.</p>
                <ul className="grid grid-cols-2 gap-2">
                  {DEMO_ACCOUNTS.map((a) => (
                    <li key={a.email}>
                      <button
                        type="button"
                        disabled={demoBusy !== null}
                        onClick={() => void loginAsDemo(a.email)}
                        className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm transition-colors hover:border-teal-600 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="block font-medium text-slate-900">
                          {demoBusy === a.email ? "Signing in…" : a.label}
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

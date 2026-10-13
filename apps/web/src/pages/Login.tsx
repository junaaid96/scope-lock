import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoginSchema } from "@scopelock/contracts";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { Button, Card, ErrorBanner, Field, Input } from "../components/ui.js";

type Form = z.infer<typeof LoginSchema>;

export function LoginPage(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [mfaBusy, setMfaBusy] = useState(false);
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
    </Card>
  );
}

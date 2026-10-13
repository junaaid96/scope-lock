import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, errorMessage } from "../lib/api.js";
import { Button, Card, ErrorBanner, Field, Input } from "../components/ui.js";

const RequestSchema = z.object({ email: z.string().email() });
const ConfirmSchema = z.object({ newPassword: z.string().min(10) });

export function ResetPasswordPage(): JSX.Element {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqForm = useForm<z.infer<typeof RequestSchema>>({ resolver: zodResolver(RequestSchema) });
  const confirmForm = useForm<z.infer<typeof ConfirmSchema>>({ resolver: zodResolver(ConfirmSchema) });

  if (!token) {
    return (
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Reset password</h1>
        <p className="mb-5 text-sm text-slate-600">We will email you a one-hour reset link if the address exists.</p>
        {done ? (
          <p className="text-sm text-slate-700">If that email is registered, a reset link is on its way.</p>
        ) : (
          <form onSubmit={(e) => void reqForm.handleSubmit(async (v) => {
            setError(null);
            try {
              await api.post("/auth/password-reset/request", v);
              setDone(true);
            } catch (err) {
              setError(errorMessage(err));
            }
          })(e)} className="space-y-4" noValidate>
            <Field label="Email" error={reqForm.formState.errors.email?.message} htmlFor="email">
              <Input id="email" type="email" {...reqForm.register("email")} />
            </Field>
            {error ? <ErrorBanner message={error} /> : null}
            <Button type="submit" className="w-full">Send reset link</Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-slate-600">
          <Link to="/login" className="font-medium text-teal-800 underline">Back to login</Link>
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Choose a new password</h1>
      {done ? (
        <p className="text-sm text-slate-700">
          Password updated. <Link to="/login" className="font-medium text-teal-800 underline">Log in</Link>
        </p>
      ) : (
        <form onSubmit={(e) => void confirmForm.handleSubmit(async (v) => {
          setError(null);
          try {
            await api.post("/auth/password-reset/confirm", { token, newPassword: v.newPassword });
            setDone(true);
          } catch (err) {
            setError(errorMessage(err));
          }
        })(e)} className="space-y-4" noValidate>
          <Field label="New password" error={confirmForm.formState.errors.newPassword?.message} htmlFor="newPassword">
            <Input id="newPassword" type="password" autoComplete="new-password" {...confirmForm.register("newPassword")} />
          </Field>
          {error ? <ErrorBanner message={error} /> : null}
          <Button type="submit" className="w-full">Update password</Button>
        </form>
      )}
    </Card>
  );
}

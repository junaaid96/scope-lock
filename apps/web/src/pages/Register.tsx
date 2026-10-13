import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { RegisterSchema } from "@scopelock/contracts";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { Button, Card, ErrorBanner, Field, Input } from "../components/ui.js";

type Form = z.infer<typeof RegisterSchema>;

export function RegisterPage(): JSX.Element {
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const { register, handleSubmit, formState } = useForm<Form>({ resolver: zodResolver(RegisterSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api.post("/auth/register", values);
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    }
  });

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Create your workspace</h1>
      <p className="mb-5 text-sm text-slate-600">One account, one agency workspace, ready for your first client project.</p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <Field label="Your name" error={formState.errors.name?.message} htmlFor="name">
          <Input id="name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Email" error={formState.errors.email?.message} htmlFor="email">
          <Input id="email" type="email" autoComplete="email" {...register("email")} />
        </Field>
        <Field label="Password" error={formState.errors.password?.message} hint="At least 10 characters." htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        <Field label="Organization name" error={formState.errors.organizationName?.message} htmlFor="organizationName">
          <Input id="organizationName" placeholder="Acme Studio" {...register("organizationName")} />
        </Field>
        {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
        <Button type="submit" disabled={formState.isSubmitting} className="w-full">
          {formState.isSubmitting ? "Creating…" : "Create workspace"}
        </Button>
      </form>
      <p className="mt-4 text-center text-sm text-slate-600">
        Already have an account? <Link to="/login" className="font-medium text-teal-800 underline">Log in</Link>
      </p>
    </Card>
  );
}

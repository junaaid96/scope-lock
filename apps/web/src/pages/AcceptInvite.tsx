import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { Button, Card, ErrorBanner, Field, Input, Spinner } from "../components/ui.js";

interface Preview {
  email: string;
  role: string;
  organizationName: string;
  projectRole: string | null;
}

const AcceptSchema = z.object({
  name: z.string().min(1, "Name is required").max(120).optional().or(z.literal("")),
  password: z.string().min(10, "Password needs at least 10 characters").max(200).optional().or(z.literal("")),
});

export function AcceptInvitePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<{ message: string; correlationId?: string } | null>(null);
  const preview = useQuery({
    queryKey: ["invite", token],
    queryFn: () => api.get<Preview>(`/auth/invitations/${token}`),
    retry: false,
  });
  const { register, handleSubmit, formState } = useForm<z.infer<typeof AcceptSchema>>({ resolver: zodResolver(AcceptSchema) });

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      const payload: Record<string, string> = {};
      if (values.name) payload.name = values.name;
      if (values.password) payload.password = values.password;
      await api.post(`/auth/invitations/${token}/accept`, payload);
      invalidateAll();
      navigate("/");
    } catch (err) {
      setError({ message: errorMessage(err), correlationId: err instanceof ApiError ? err.correlationId : undefined });
    }
  });

  if (preview.isLoading) {
    return <Card><Spinner /></Card>;
  }
  if (preview.isError || !preview.data) {
    return (
      <Card>
        <h1 className="mb-1 text-xl font-semibold">Invitation unavailable</h1>
        <p className="text-sm text-slate-600">This invitation is invalid, expired, or was already used.</p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">Join {preview.data.organizationName}</h1>
      <p className="mb-5 text-sm text-slate-600">
        Invited as {preview.data.email} ({preview.data.role}
        {preview.data.projectRole ? `, project ${preview.data.projectRole}` : ""}). If you already have an account with
        this email, just accept — otherwise set your name and password.
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <Field label="Name (new accounts)" error={formState.errors.name?.message} htmlFor="name">
          <Input id="name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label="Password (new accounts)" error={formState.errors.password?.message} htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
        <Button type="submit" disabled={formState.isSubmitting} className="w-full">
          {formState.isSubmitting ? "Accepting…" : "Accept invitation"}
        </Button>
      </form>
    </Card>
  );
}

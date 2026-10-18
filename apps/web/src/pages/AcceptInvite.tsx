import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api, errorMessage, ApiError } from "../lib/api.js";
import { invalidateAll } from "../lib/query.js";
import { Button, Card, ErrorBanner, Field, Input, Spinner } from "../components/ui.js";
import { useLocale } from "../lib/i18n/index.js";

interface Preview {
  email: string;
  role: string;
  organizationName: string;
  projectRole: string | null;
}



export function AcceptInvitePage(): JSX.Element {
  const { t } = useLocale();
  const AcceptSchema = z.object({
    name: z.string().min(1, t("auth.inviteNameRequired")).max(120).optional().or(z.literal("")),
    password: z.string().min(10, t("auth.invitePasswordMin")).max(200).optional().or(z.literal("")),
  });
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
        <h1 className="mb-1 text-xl font-semibold">{t("auth.inviteUnavailableTitle")}</h1>
        <p className="text-sm text-slate-600">{t("auth.inviteUnavailableBody")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="mb-1 text-xl font-semibold">{t("auth.inviteJoin", { org: preview.data.organizationName })}</h1>
      <p className="mb-5 text-sm text-slate-600">
        {t("auth.inviteIntro", { email: preview.data.email, role: preview.data.role, project: preview.data.projectRole ? t("auth.inviteIntroProject", { role: preview.data.projectRole }) : "" })}{" "}
        {t("auth.inviteIntroHelp")}
      </p>
      <form onSubmit={(e) => void onSubmit(e)} className="space-y-4" noValidate>
        <Field label={t("auth.inviteNameLabel")} error={formState.errors.name?.message} htmlFor="name">
          <Input id="name" autoComplete="name" {...register("name")} />
        </Field>
        <Field label={t("auth.invitePasswordLabel")} error={formState.errors.password?.message} htmlFor="password">
          <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        </Field>
        {error ? <ErrorBanner message={error.message} correlationId={error.correlationId} /> : null}
        <Button type="submit" disabled={formState.isSubmitting} className="w-full">
          {formState.isSubmitting ? t("auth.accepting") : t("auth.acceptInvite")}
        </Button>
      </form>
    </Card>
  );
}

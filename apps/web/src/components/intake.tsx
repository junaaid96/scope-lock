import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Spinner, formatDate, statusTone } from "./ui.js";

interface IntakeLinkRow {
  id: string;
  name: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  submissions: number;
  createdAt: string;
  url: string;
}

export function IntakeTab({ projectId }: { projectId: string }): JSX.Element {
  const client = useQueryClient();
  const links = useQuery({
    queryKey: ["intake-links", projectId],
    queryFn: () => fetchAll<IntakeLinkRow>(`/projects/${projectId}/intake-links`),
  });
  const [showCreate, setShowCreate] = useState(false);
  const [fresh, setFresh] = useState<{ url: string; name: string } | null>(null);
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ["intake-links", projectId] });
  };

  if (links.isLoading) return <Spinner />;
  if (links.isError) return <ErrorBanner message={errorMessage(links.error)} />;
  const list = links.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate-600">
          Public request forms for this project. Anyone with a link can submit — submissions arrive as SUBMITTED changes
          flagged “unverified submitter”. Revoke a link to shut its form off instantly.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)}>New intake link</Button>
      </div>
      {fresh ? (
        <Card>
          <h3 className="font-medium">Link ready — copy it now (shown once)</h3>
          <p className="mt-1 break-all text-sm text-slate-700">{fresh.url}</p>
          <p className="mt-2 text-sm text-slate-600">Embed it on any site:</p>
          <pre className="mt-1 overflow-x-auto rounded-md bg-slate-100 p-2 text-xs">{`<iframe src="${fresh.url}" width="100%" height="720" title="${fresh.name} request form"></iframe>`}</pre>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setFresh(null)}>Done</Button>
        </Card>
      ) : null}
      {list.length === 0 ? <Empty title="No intake links" hint="Create one to accept public requests for this project." /> : null}
      {list.map((l) => (
        <LinkCard key={l.id} link={l} onChanged={refresh} />
      ))}
      {showCreate ? (
        <CreateDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onDone={(url, name) => {
            setFresh({ url, name });
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function LinkCard({ link, onChanged }: { link: IntakeLinkRow; onChanged: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: () => api.post(`/intake-links/${link.id}/revoke`, {}),
    onSuccess: onChanged,
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{link.name}</h3>
        <Badge tone={link.revokedAt ? "red" : statusTone("SENT")}>{link.revokedAt ? "REVOKED" : "LIVE"}</Badge>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <dt className="text-slate-500">Submissions</dt>
        <dd className="font-medium">{link.submissions}</dd>
        <dt className="text-slate-500">Last used</dt>
        <dd>{formatDate(link.lastUsedAt)}</dd>
        <dt className="text-slate-500">Expires</dt>
        <dd>{formatDate(link.expiresAt)}</dd>
        <dt className="text-slate-500">Created</dt>
        <dd>{formatDate(link.createdAt)}</dd>
      </dl>
      {error ? <div className="mt-2"><ErrorBanner message={error} /></div> : null}
      {!link.revokedAt ? (
        <Button size="sm" variant="ghost" disabled={revoke.isPending} className="mt-3" onClick={() => revoke.mutate()}>
          Revoke
        </Button>
      ) : null}
    </Card>
  );
}

function CreateDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (url: string, name: string) => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<{ name: string; expiresAt: string }>({ defaultValues: { name: "", expiresAt: "" } });
  const save = useMutation({
    mutationFn: (v: { name: string; expiresAt: string }) =>
      api.post<{ url: string }>(`/projects/${projectId}/intake-links`, {
        name: v.name,
        expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
      }),
    onSuccess: (res, v) => {
      onDone(res.url, v.name);
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="New intake link" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => save.mutate(v))(e)} className="space-y-3">
        <Field label="Name (staff only)" htmlFor="intake-name" error={formState.errors.name?.message} hint="e.g. “Website contact form”. Never shown to submitters.">
          <Input id="intake-name" {...register("name", { required: "Name is required", maxLength: 120 })} />
        </Field>
        <Field label="Expires at (optional)" htmlFor="intake-expiry">
          <Input id="intake-expiry" type="datetime-local" {...register("expiresAt")} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        <Button type="submit" disabled={save.isPending} className="w-full">Create link</Button>
      </form>
    </Dialog>
  );
}

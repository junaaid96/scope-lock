import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import { Badge, Button, Card, Dialog, Empty, ErrorBanner, Field, Input, Spinner, Textarea, formatDate, statusTone } from "./ui.js";

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

interface MailboxRow {
  id: string;
  name: string;
  localPart: string;
  address: string;
  createdAt: string;
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
      <MailboxSection projectId={projectId} />
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

function MailboxSection({ projectId }: { projectId: string }): JSX.Element {
  const client = useQueryClient();
  const boxes = useQuery({
    queryKey: ["inbound-mailboxes", projectId],
    queryFn: () => fetchAll<MailboxRow>(`/projects/${projectId}/inbound-mailboxes`),
  });
  const [showCreate, setShowCreate] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = (): void => {
    void client.invalidateQueries({ queryKey: ["inbound-mailboxes", projectId] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/inbound-mailboxes/${id}`),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });
  const create = useMutation({
    mutationFn: (name: string) => api.post<MailboxRow>(`/projects/${projectId}/inbound-mailboxes`, { name }),
    onSuccess: refresh,
    onError: (err) => setError(errorMessage(err)),
  });

  if (boxes.isLoading) return <Spinner />;
  if (boxes.isError) return <ErrorBanner message={errorMessage(boxes.error)} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Inbound email</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setShowCreate(true)}>New mailbox</Button>
          <Button size="sm" variant="ghost" onClick={() => setSimulating(true)}>Simulate email…</Button>
        </div>
      </div>
      <p className="max-w-2xl text-sm text-slate-600">
        Each project gets unguessable alias addresses. Mail forwarded to the signed webhook lands as an unverified
        SUBMITTED change; quoted history is stripped and attachments are scanned before linking.
      </p>
      {error ? <ErrorBanner message={error} /> : null}
      {(boxes.data ?? []).length === 0 ? <Empty title="No mailboxes" hint="Create one and point your mail forwarder at it." /> : null}
      {(boxes.data ?? []).map((b) => (
        <Card key={b.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="font-medium">{b.name}</p>
              <p className="break-all text-sm text-slate-600">{b.address}</p>
            </div>
            <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={() => remove.mutate(b.id)}>Delete</Button>
          </div>
        </Card>
      ))}
      {showCreate ? (
        <MailboxDialog
          onClose={() => setShowCreate(false)}
          onDone={(name) => {
            create.mutate(name);
            setShowCreate(false);
          }}
        />
      ) : null}
      {simulating ? <SimulateDialog projectId={projectId} onClose={() => setSimulating(false)} /> : null}
    </div>
  );
}

function MailboxDialog({ onClose, onDone }: { onClose: () => void; onDone: (name: string) => void }): JSX.Element {
  const { register, handleSubmit, formState } = useForm<{ name: string }>();
  return (
    <Dialog title="New mailbox" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => onDone(v.name))(e)} className="space-y-3">
        <Field label="Name (staff only)" htmlFor="mailbox-name" error={formState.errors.name?.message}>
          <Input id="mailbox-name" {...register("name", { required: "Name is required", maxLength: 120 })} />
        </Field>
        <Button type="submit" className="w-full">Create mailbox</Button>
      </form>
    </Dialog>
  );
}

function SimulateDialog({ projectId, onClose }: { projectId: string; onClose: () => void }): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const { register, handleSubmit } = useForm<{ from: string; subject: string; textBody: string }>({
    defaultValues: { from: "pat@example.com", subject: "", textBody: "" },
  });
  const send = useMutation({
    mutationFn: (v: { from: string; subject: string; textBody: string }) =>
      api.post<{ status: string; number?: string; reason?: string }>("/dev/simulate-inbound-email", {
        projectId,
        messageId: `sim-${Date.now()}`,
        to: "simulated@inbound.local",
        from: v.from,
        subject: v.subject,
        textBody: v.textBody,
      }),
    onSuccess: (res) => setOutcome(res.status === "created" ? `Created ${res.number}` : `Dropped (${res.reason})`),
    onError: (err) => setError(errorMessage(err)),
  });
  return (
    <Dialog title="Simulate inbound email" onClose={onClose}>
      <form onSubmit={(e) => void handleSubmit((v) => send.mutate(v))(e)} className="space-y-3">
        <Field label="From" htmlFor="sim-from">
          <Input id="sim-from" {...register("from", { required: true })} />
        </Field>
        <Field label="Subject" htmlFor="sim-subject">
          <Input id="sim-subject" {...register("subject", { required: true })} />
        </Field>
        <Field label="Body" htmlFor="sim-body">
          <Textarea id="sim-body" rows={4} {...register("textBody", { required: true })} />
        </Field>
        {error ? <ErrorBanner message={error} /> : null}
        {outcome ? <p className="text-sm font-medium text-slate-800" role="status">{outcome}</p> : null}
        <Button type="submit" disabled={send.isPending} className="w-full">Send test email</Button>
      </form>
    </Dialog>
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

import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { Approval } from "../lib/types.js";
import { Badge, Button, Empty, ErrorBanner, PageTitle, Spinner, Tabs, formatDate, statusTone } from "../components/ui.js";

interface InboxItem extends Approval {
  projectName: string | null;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export function InboxPage(): JSX.Element {
  const [tab, setTab] = useState<"decisions" | "notifications">("decisions");
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => fetchAll<InboxItem>("/inbox"), refetchInterval: 30_000 });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => fetchAll<NotificationItem>("/notifications") });

  const decisions = inbox.data ?? [];
  const notes = notifications.data ?? [];
  const unread = notes.filter((n) => !n.readAt).length;

  return (
    <div>
      <PageTitle title="Inbox" subtitle="Packages waiting on your decision, and project notifications." />
      <Tabs
        label="Inbox sections"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "decisions" as const, label: `Awaiting decision${decisions.length > 0 ? ` (${decisions.length})` : ""}` },
          { id: "notifications" as const, label: `Notifications${unread > 0 ? ` (${unread} unread)` : ""}` },
        ]}
      />

      {tab === "decisions" ? (
        inbox.isLoading ? <Spinner /> : inbox.isError ? (
          <ErrorBanner message={errorMessage(inbox.error)} />
        ) : decisions.length === 0 ? (
          <Empty title="Nothing needs your decision" hint="When the agency sends a proposal, it appears here." />
        ) : (
          <ul className="space-y-3">
            {decisions.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{a.title ?? "Review package"}</span>
                  <Badge tone={statusTone(a.status)}>{a.status}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {a.projectName ?? ""} · expires {formatDate(a.expiresAt)}
                </p>
                <AuthedReviewLink approval={a} />
              </li>
            ))}
          </ul>
        )
      ) : (
        <NotificationsTab notes={notes} loading={notifications.isLoading} failed={notifications.isError} failure={notifications.error} />
      )}
    </div>
  );
}

function NotificationsTab({ notes, loading, failed, failure }: { notes: NotificationItem[]; loading: boolean; failed: boolean; failure: unknown }): JSX.Element {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`, { read: true }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
  const markAll = async (): Promise<void> => {
    const pending = notes.filter((n) => !n.readAt);
    if (pending.length === 0) return;
    setBusy(true);
    try {
      await Promise.all(pending.map((n) => api.post(`/notifications/${n.id}/read`, { read: true })));
      void client.invalidateQueries({ queryKey: ["notifications"] });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner />;
  if (failed) return <ErrorBanner message={errorMessage(failure)} />;
  if (notes.length === 0) return <Empty title="No notifications" hint="Scope publishes, decisions, and mentions land here." />;
  const unread = notes.filter((n) => !n.readAt).length;
  return (
    <div>
      {unread > 0 ? (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void markAll()}>
            {busy ? "Marking…" : `Mark all read (${unread})`}
          </Button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className={`rounded-lg border bg-white p-4 shadow-sm ${n.readAt ? "border-slate-200" : "border-teal-600"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(n.createdAt)}</p>
              </div>
              {!n.readAt ? (
                <Button variant="ghost" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                  Mark read
                </Button>
              ) : null}
            </div>
            {n.link && n.link.startsWith("/") ? (
              <Link to={n.link} onClick={() => { if (!n.readAt) markRead.mutate(n.id); }} className="mt-2 inline-block text-sm font-medium text-teal-800 underline">
                Open
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Authenticated approvers open the package by id (same content as the review link). */
function AuthedReviewLink({ approval }: { approval: InboxItem }): JSX.Element {
  const detail = useQuery({
    queryKey: ["approval", approval.id],
    queryFn: () => api.get<Approval & { package: unknown }>(`/approval-requests/${approval.id}`),
  });
  if (detail.isLoading) return <span className="text-sm text-slate-500">Loading package…</span>;
  if (detail.isError || !detail.data?.package) return <span className="text-sm text-red-700">Could not load package.</span>;
  const pkg = detail.data.package as {
    request: { title: string; description: string } | null;
    members: Array<{ title: string }>;
    impact: { priceMinor: number | null; currency: string | null; effortDays: number | null } | null;
  };
  return (
    <div className="mt-2 text-sm">
      <p className="whitespace-pre-wrap text-slate-800">{pkg.request?.description ?? `${pkg.members.length} bundled requests`}</p>
      {pkg.impact ? (
        <p className="mt-1 text-slate-600">
          {pkg.impact.priceMinor !== null && pkg.impact.priceMinor !== undefined
            ? `${pkg.impact.currency} ${(pkg.impact.priceMinor / 100).toFixed(2)} · `
            : ""}
          {pkg.impact.effortDays ?? "—"} days
        </p>
      ) : null}
      <DecideButtons approvalId={approval.id} />
    </div>
  );
}

function DecideButtons({ approvalId }: { approvalId: string }): JSX.Element {
  return (
    <p className="mt-2 text-sm text-slate-600">
      To decide, open the review link from your email, or{" "}
      <Link className="font-medium text-teal-800 underline" to={`/review/${approvalId}`}>
        decide here
      </Link>
      .
    </p>
  );
}

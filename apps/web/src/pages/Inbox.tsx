import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { Approval } from "../lib/types.js";
import { useLocale } from "../lib/i18n/index.js";
import { Badge, Button, Empty, ErrorBanner, PageTitle, Skeleton, SkeletonCards, StatusBadge, Tabs, expiryLabel } from "../components/ui.js";

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
  const { t, date, relative } = useLocale();
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => fetchAll<InboxItem>("/inbox"), refetchInterval: 30_000 });
  const notifications = useQuery({ queryKey: ["notifications"], queryFn: () => fetchAll<NotificationItem>("/notifications") });

  const decisions = inbox.data ?? [];
  const notes = notifications.data ?? [];
  const unread = notes.filter((n) => !n.readAt).length;

  return (
    <div>
      <PageTitle title={t("inbox.title")} subtitle={t("inbox.subtitle")} />
      <Tabs
        label={t("inbox.tabsLabel")}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "decisions" as const, label: t("inbox.decisionsTab", { suffix: decisions.length > 0 ? t("inbox.countSuffix", { count: decisions.length }) : "" }) },
          { id: "notifications" as const, label: t("inbox.notificationsTab", { suffix: unread > 0 ? t("inbox.unreadSuffix", { count: unread }) : "" }) },
        ]}
      />

      {tab === "decisions" ? (
        inbox.isLoading ? <SkeletonCards count={2} /> : inbox.isError ? (
          <ErrorBanner message={errorMessage(inbox.error)} />
        ) : decisions.length === 0 ? (
          <Empty title={t("inbox.emptyDecisionsTitle")} hint={t("inbox.emptyDecisionsHint")} />
        ) : (
          <ul className="space-y-3">
            {decisions.map((a) => (
              <li key={a.id} className="rounded-xl border border-slate-200 bg-surface p-4 shadow-card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{a.title ?? t("inbox.defaultTitle")}</span>
                  {a.status === "SENT" ? (
                    <Badge tone="amber">{t("inbox.awaitingYou")}</Badge>
                  ) : (
                    <StatusBadge status={a.status} />
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {t("inbox.expiresMeta", { project: a.projectName ?? "", expires: expiryLabel(a.expiresAt, date, relative) })}
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
  const { t, date, relative } = useLocale();
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

  if (loading) return <SkeletonCards count={2} />;
  if (failed) return <ErrorBanner message={errorMessage(failure)} />;
  if (notes.length === 0) return <Empty title={t("inbox.emptyNotesTitle")} hint={t("inbox.emptyNotesHint")} />;
  const unread = notes.filter((n) => !n.readAt).length;
  return (
    <div>
      {unread > 0 ? (
        <div className="mb-3 flex justify-end">
          <Button variant="secondary" size="sm" loading={busy} onClick={() => void markAll()}>
            {busy ? t("inbox.marking") : t("inbox.markAllRead", { count: unread })}
          </Button>
        </div>
      ) : null}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li
            key={n.id}
            className={`rounded-lg border bg-surface p-4 shadow-card ${n.readAt ? "border-slate-200" : "border-teal-600"}`}
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{n.title}</p>
                <p className="mt-0.5 text-sm text-slate-600">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">{relative(n.createdAt) ?? date(n.createdAt)}</p>
              </div>
              {!n.readAt ? (
                <Button variant="ghost" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(n.id)}>
                  {t("inbox.markRead")}
                </Button>
              ) : null}
            </div>
            {n.link && n.link.startsWith("/") ? (
              <Link to={n.link} onClick={() => { if (!n.readAt) markRead.mutate(n.id); }} className="mt-2 inline-block text-sm font-medium text-link underline">
                {t("inbox.openLink")}
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
  const { t, money } = useLocale();
  const detail = useQuery({
    queryKey: ["approval", approval.id],
    queryFn: () => api.get<Approval & { package: unknown }>(`/approval-requests/${approval.id}`),
  });
  if (detail.isLoading) {
    return (
      <span className="mt-2 block" role="status" aria-label={t("inbox.loadingPackage")}>
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="mt-1.5 h-3.5 w-1/3" />
      </span>
    );
  }
  if (detail.isError || !detail.data?.package) return <span className="mt-2 block text-sm text-red-700">{t("inbox.packageLoadError")}</span>;
  const pkg = detail.data.package as {
    request: { title: string; description: string } | null;
    members: Array<{ title: string }>;
    impact: { priceMinor: number | null; currency: string | null; effortDays: number | null } | null;
  };
  return (
    <div className="mt-2 text-sm">
      <p className="line-clamp-3 whitespace-pre-wrap text-slate-800">{pkg.request?.description ?? t("inbox.bundledCount", { count: pkg.members.length })}</p>
      {pkg.impact ? (
        <p className="mt-1 text-slate-600">
          {pkg.impact.priceMinor !== null && pkg.impact.priceMinor !== undefined
            ? `${money(pkg.impact.priceMinor, pkg.impact.currency ?? "USD")} · `
            : ""}
          {t("inbox.daysValue", { days: pkg.impact.effortDays ?? "—" })}
        </p>
      ) : null}
      <div className="mt-3">
        <Link to={`/review/${approval.id}`}>
          <Button size="sm">{t("inbox.reviewDecide")}</Button>
        </Link>
      </div>
    </div>
  );
}

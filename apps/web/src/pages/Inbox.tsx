import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errorMessage, fetchAll } from "../lib/api.js";
import type { Approval } from "../lib/types.js";
import { Badge, Empty, ErrorBanner, PageTitle, Spinner, formatDate, statusTone } from "../components/ui.js";

interface InboxItem extends Approval {
  projectName: string | null;
}

export function InboxPage(): JSX.Element {
  const inbox = useQuery({ queryKey: ["inbox"], queryFn: () => fetchAll<InboxItem>("/inbox"), refetchInterval: 30_000 });

  if (inbox.isLoading) return <Spinner />;
  if (inbox.isError) return <ErrorBanner message={errorMessage(inbox.error)} />;
  const items = inbox.data ?? [];

  return (
    <div>
      <PageTitle title="Decision inbox" subtitle="Packages waiting on your decision. First decision is binding." />
      {items.length === 0 ? (
        <Empty title="Nothing needs your decision" hint="When the agency sends a proposal, it appears here." />
      ) : (
        <ul className="space-y-3">
          {items.map((a) => (
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
      )}
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

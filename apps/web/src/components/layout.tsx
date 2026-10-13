import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Page } from "../lib/api.js";
import { useLogout, useSession } from "../lib/auth.js";
import { cn } from "./ui.js";

interface Notification {
  id: string;
  title: string;
  readAt: string | null;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "block rounded-md px-3 py-2 text-sm font-medium",
    isActive ? "bg-teal-700 text-white" : "text-slate-700 hover:bg-slate-100",
  );
}

export function Shell(): JSX.Element {
  const { session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const { data: notifications } = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api.get<Page<Notification>>("/notifications?limit=25"),
    refetchInterval: 60_000,
  });
  const unread = (notifications?.data ?? []).filter((n) => !n.readAt).length;

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-semibold tracking-tight text-slate-900">
            ScopeLock
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link to="/inbox" className="relative rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100">
              Inbox
              {unread > 0 ? (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-teal-700 px-1.5 text-xs text-white">
                  {unread}
                </span>
              ) : null}
            </Link>
            <span className="text-slate-600">{session?.user.name}</span>
            <button
              type="button"
              className="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100"
              onClick={() => {
                void logout().then(() => navigate("/login"));
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-6">
        <nav aria-label="Primary" className="hidden w-48 shrink-0 space-y-1 md:block">
          <NavLink to="/" end className={navClass}>
            Projects
          </NavLink>
          <NavLink to="/inbox" className={navClass}>
            Decision inbox
          </NavLink>
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Centered({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <p className="mb-6 text-center text-xl font-semibold tracking-tight">ScopeLock</p>
      {children}
    </div>
  );
}

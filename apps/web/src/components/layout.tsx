import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAll } from "../lib/api.js";
import { useLogout, useSession } from "../lib/auth.js";
import { useLocale } from "../lib/i18n/index.js";
import { CommandPalette, CommandPaletteTrigger } from "./command-palette.js";
import { CreditPill } from "./credit.js";
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

function NavIcon({ paths }: { paths: string[] }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4 shrink-0"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

const ICON_PROJECTS = [
  "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
];
const ICON_INBOX = [
  "M22 12h-6l-2 3h-4l-2-3H2",
  "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
];

/** Primary nav links, shared by the desktop sidebar and the mobile menu. `badge` counts everything awaiting attention in the inbox. */
function SidebarNav({ badge, onNavigate }: { badge: number; onNavigate?: () => void }): JSX.Element {
  const { t } = useLocale();
  return (
    <div className="space-y-1">
      <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{t("shell.workspace")}</p>
      <NavLink to="/" end className={navClass} onClick={onNavigate}>
        <span className="flex items-center gap-2.5">
          <NavIcon paths={ICON_PROJECTS} />
          {t("shell.projects")}
        </span>
      </NavLink>
      <NavLink to="/inbox" className={navClass} onClick={onNavigate}>
        <span className="flex items-center gap-2.5">
          <NavIcon paths={ICON_INBOX} />
          <span className="flex-1">{t("shell.inbox")}</span>
          {badge > 0 ? (
            <span className="inline-flex items-center justify-center rounded-full bg-teal-700 px-1.5 text-xs text-white">
              {badge}
            </span>
          ) : null}
        </span>
      </NavLink>
    </div>
  );
}

/** Header language switcher: persists to the user's preferences. */
function LanguageSwitcher({ id }: { id: string }): JSX.Element {
  const { session } = useSession();
  const client = useQueryClient();
  const current = session?.user.locale === "bn" ? "bn" : "en";
  const switchTo = async (locale: string): Promise<void> => {
    if (locale === current) return;
    try {
      await api.patch("/auth/me/preferences", { locale });
      await client.invalidateQueries({ queryKey: ["me"] });
    } catch {
      // Preference save failures surface on next navigation; never break the shell.
    }
  };
  const { t } = useLocale();
  return (
    <span className="inline-flex items-center gap-1">
      <label htmlFor={id} className="sr-only">
        {t("shell.language")}
      </label>
      <select
        id={id}
        value={current}
        onChange={(e) => void switchTo(e.target.value)}
        className="rounded-md border border-slate-200 bg-white px-1 py-1 text-sm text-slate-700"
        aria-label={t("shell.language")}
      >
        <option value="en">{t("shell.english")}</option>
        <option value="bn">{t("shell.bangla")}</option>
      </select>
    </span>
  );
}

export function Shell(): JSX.Element {
  const { session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const { data: inboxItems } = useQuery({
    queryKey: ["inbox"],
    queryFn: () => fetchAll<{ id: string }>("/inbox"),
    refetchInterval: 60_000,
  });
  const { data: notifications } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => fetchAll<Notification>("/notifications"),
    refetchInterval: 60_000,
  });
  // The badge must equal what the inbox page shows: pending decisions plus unread notifications.
  const badge = (inboxItems ?? []).length + (notifications ?? []).filter((n) => !n.readAt).length;
  const onLogout = (): void => {
    setMenuOpen(false);
    void logout().then(() => navigate("/login"));
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100 md:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? t("shell.closeMenu") : t("shell.openMenu")}
              onClick={() => setMenuOpen((v) => !v)}
            >
              {menuOpen ? "✕" : "☰"}
            </button>
            <Link to="/" className="text-lg font-semibold tracking-tight text-slate-900" onClick={() => setMenuOpen(false)}>
              ScopeLock
            </Link>
          </div>
          <div className="flex items-center gap-1 text-sm sm:gap-3">
            <CommandPaletteTrigger onOpen={() => setPaletteOpen(true)} />
            <Link to="/inbox" className="relative rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100">
              {t("shell.inbox")}
              {badge > 0 ? (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-teal-700 px-1.5 text-xs text-white">
                  {badge}
                </span>
              ) : null}
            </Link>
            <span className="hidden text-slate-600 sm:inline">{session?.user.name}</span>
            <span className="hidden sm:inline">
              <LanguageSwitcher id="language-switcher" />
            </span>
            <button
              type="button"
              className="hidden rounded-md px-2 py-1 text-slate-700 hover:bg-slate-100 sm:inline"
              onClick={onLogout}
            >
              {t("shell.logOut")}
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="mobile-nav" aria-label={t("shell.primaryNav")} className="border-t border-slate-100 px-4 py-3 md:hidden">
            <SidebarNav badge={badge} onNavigate={() => setMenuOpen(false)} />
            <p className="px-3 pb-1 pt-3 text-xs text-slate-500">{t("shell.signedInAs", { name: session?.user.name ?? "" })}</p>
            <div className="px-3 py-1">
              <LanguageSwitcher id="language-switcher-mobile" />
            </div>
            <button type="button" className={cn(navClass({ isActive: false }), "w-full text-left")} onClick={onLogout}>
              {t("shell.logOut")}
            </button>
          </nav>
        ) : null}
      </header>
      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6 px-4 py-6">
        <nav aria-label={t("shell.primaryNav")} className="hidden w-52 shrink-0 self-start md:sticky md:top-20 md:block">
          <SidebarNav badge={badge} />
        </nav>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-slate-500 sm:flex-row">
          <p>{t("shell.footer", { year: new Date().getFullYear() })}</p>
          <CreditPill />
        </div>
      </footer>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}

/** Secondary navigation shared by all project pages (overview, scope, activity, health). */
export function ProjectSubnav({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useLocale();
  const items = [
    { to: `/projects/${projectId}`, end: true, label: t("shell.overview") },
    { to: `/projects/${projectId}/scope`, end: false, label: t("shell.scopeLedger") },
    { to: `/projects/${projectId}/timeline`, end: false, label: t("shell.timeline") },
    { to: `/projects/${projectId}/activity`, end: false, label: t("shell.activity") },
    { to: `/projects/${projectId}/health`, end: false, label: t("shell.health") },
  ];
  return (
    <nav aria-label={t("shell.projectSections")} className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              isActive ? "border-teal-700 text-teal-800" : "border-transparent text-slate-600 hover:text-slate-900",
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
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

/** Full-viewport loading state (auth check, review lookup). No credit line here by design. */
export function LoadingScreen({ message }: { message?: string }): JSX.Element {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <p className="text-xl font-semibold tracking-tight text-slate-900">ScopeLock</p>
      <span role="status" aria-label={message ?? t("common.loadingLabel")} className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-teal-700 motion-reduce:animate-none" />
      <p className="text-sm text-slate-500">{message ?? t("shell.loadingWorkspace")}</p>
    </div>
  );
}

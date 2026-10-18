import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fetchAll } from "../lib/api.js";
import { useLogout, useSession } from "../lib/auth.js";
import { useLocale } from "../lib/i18n/index.js";
import { CommandPalette, CommandPaletteTrigger } from "./command-palette.js";
import { CreditPill } from "./credit.js";
import { ICONS, Icon, ThemeToggle, Wordmark, cn } from "./ui.js";

interface Notification {
  id: string;
  title: string;
  readAt: string | null;
}

function navClass({ isActive }: { isActive: boolean }): string {
  return cn(
    "group relative block rounded-lg px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-teal-50 text-link-strong ring-1 ring-inset ring-teal-200/70 before:absolute before:-left-3 before:top-2 before:h-5 before:w-1 before:rounded-r-full before:bg-teal-600"
      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
  );
}

/** Primary nav links, shared by the desktop sidebar and the mobile menu. `badge` counts everything awaiting attention in the inbox. */
function SidebarNav({ badge, onNavigate }: { badge: number; onNavigate?: () => void }): JSX.Element {
  const { t } = useLocale();
  return (
    <div className="space-y-1">
      <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{t("shell.workspace")}</p>
      <NavLink to="/" end className={navClass} onClick={onNavigate}>
        <span className="flex items-center gap-2.5">
          <Icon d={ICONS.folder} className="size-[18px]" />
          {t("shell.projects")}
        </span>
      </NavLink>
      <NavLink to="/inbox" className={navClass} onClick={onNavigate}>
        <span className="flex items-center gap-2.5">
          <Icon d={ICONS.inbox} className="size-[18px]" />
          <span className="flex-1">{t("shell.inbox")}</span>
          {badge > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-teal-700 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
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
        className="rounded-xl border border-slate-200 bg-surface px-2 py-1.5 text-sm text-slate-700 shadow-card hover:border-slate-300"
        aria-label={t("shell.language")}
      >
        <option value="en">{t("shell.english")}</option>
        <option value="bn">{t("shell.bangla")}</option>
      </select>
    </span>
  );
}

function Avatar({ name }: { name: string }): JSX.Element {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-sky-500 text-xs font-semibold text-white ring-2 ring-surface">
      {initials || "?"}
    </span>
  );
}

export function Shell(): JSX.Element {
  const { session } = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { t } = useLocale();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => setMenuOpen(false), [location.pathname]);
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
  const userName = session?.user.name ?? "";

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-surface px-3 py-4 lg:flex">
        <Link to="/" className="mb-6 px-2" aria-label="ScopeLock">
          <Wordmark />
        </Link>
        <nav aria-label={t("shell.primaryNav")} className="px-1">
          <SidebarNav badge={badge} />
        </nav>
        <div className="mt-auto space-y-3 border-t border-slate-200 pt-4">
          <div className="flex items-center gap-2 px-1">
            <LanguageSwitcher id="language-switcher" />
            <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
            <Avatar name={userName} />
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{userName}</p>
            <button
              type="button"
              className="tap inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200/70 hover:text-slate-900"
              onClick={onLogout}
            >
              <Icon d={ICONS.logout} />
              {t("shell.logOut")}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-surface/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
            <button
              type="button"
              className="tap -ml-1 inline-flex size-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? t("shell.closeMenu") : t("shell.openMenu")}
              onClick={() => setMenuOpen((v) => !v)}
            >
              <Icon d={menuOpen ? ICONS.close : ICONS.menu} className="size-5" />
            </button>
            <Link to="/" className="lg:hidden" onClick={() => setMenuOpen(false)} aria-label="ScopeLock">
              <Wordmark />
            </Link>
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <CommandPaletteTrigger onOpen={() => setPaletteOpen(true)} />
              <Link
                to="/inbox"
                className="tap relative inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <Icon d={ICONS.inbox} className="size-[18px]" />
                <span className="sr-only sm:not-sr-only">{t("shell.inbox")}</span>
                {badge > 0 ? (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-teal-700 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">
                    {badge}
                  </span>
                ) : null}
              </Link>
              <span className="lg:hidden"><ThemeToggle /></span>
            </div>
          </div>
        </header>

        {menuOpen ? (
          <div className="fixed inset-0 top-14 z-40 lg:hidden">
            <div className="absolute inset-0 animate-fade-in bg-black/40 backdrop-blur-sm" onClick={() => setMenuOpen(false)} aria-hidden="true" />
            <nav id="mobile-nav" aria-label={t("shell.primaryNav")} className="relative w-72 max-w-[85%] animate-fade-up border-r border-slate-200 bg-surface px-4 py-4 shadow-pop" style={{ height: "100%" }}>
              <SidebarNav badge={badge} onNavigate={() => setMenuOpen(false)} />
              <div className="mt-6 flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                <Avatar name={userName} />
                <p className="min-w-0 flex-1 truncate text-xs text-slate-600">{t("shell.signedInAs", { name: userName })}</p>
              </div>
              <div className="px-1 py-3">
                <LanguageSwitcher id="language-switcher-mobile" />
              </div>
              <button type="button" className={cn(navClass({ isActive: false }), "w-full text-left")} onClick={onLogout}>
                {t("shell.logOut")}
              </button>
            </nav>
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-8 sm:px-6">
          <div key={location.pathname} className="animate-fade-up">
            <Outlet />
          </div>
        </main>
        <footer className="border-t border-slate-200 bg-surface">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:px-6">
            <p>{t("shell.footer", { year: new Date().getFullYear() })}</p>
            <CreditPill />
          </div>
        </footer>
      </div>
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
    <nav aria-label={t("shell.projectSections")} className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) =>
            cn(
              "-mb-px whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors",
              isActive ? "border-teal-600 text-link" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900",
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
    <div className="bg-aurora min-h-screen">
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
        <Link to="/welcome" className="mb-6 flex justify-center" aria-label="ScopeLock">
          <Wordmark />
        </Link>
        <div className="animate-fade-up">{children}</div>
      </div>
    </div>
  );
}

/** Full-viewport loading state (auth check, review lookup). No credit line here by design. */
export function LoadingScreen({ message }: { message?: string }): JSX.Element {
  const { t } = useLocale();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4">
      <Wordmark />
      <span role="status" aria-label={message ?? t("common.loadingLabel")} className="inline-block h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-teal-600 motion-reduce:animate-none" />
      <p className="text-sm text-slate-500">{message ?? t("shell.loadingWorkspace")}</p>
    </div>
  );
}

/**
 * Global command palette (Ctrl/Cmd+K): fuzzy-ish navigation across projects,
 * inbox, settings, and contextual project pages, plus creation shortcuts.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMatch, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchAll } from "../lib/api.js";
import { useLogout, useSession } from "../lib/auth.js";
import type { Client, ProjectListItem } from "../lib/types.js";
import { Kbd } from "./ui.js";
import { useLocale } from "../lib/i18n/index.js";

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string;
  run: () => void;
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-4"
    >
      <path d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function CommandPaletteTrigger({ onOpen }: { onOpen: () => void }): JSX.Element {
  const { t } = useLocale();
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t("palette.openTrigger")}
      title={t("palette.triggerTitle")}
      className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-500 transition-colors hover:border-teal-600 hover:text-slate-800"
    >
      <SearchIcon />
      <span className="hidden lg:inline">{t("palette.jumpTo")}</span>
      <span className="hidden lg:inline"><Kbd>{t("palette.keyCtrlK")}</Kbd></span>
    </button>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const navigate = useNavigate();
  const { t } = useLocale();
  const logout = useLogout();
  const { session } = useSession();
  const projectMatch = useMatch("/projects/:id/*");
  const projectId = projectMatch?.params.id ?? null;
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const orgs = useMemo(() => session?.organizations ?? [], [session]);
  const orgKey = orgs.map((o) => o.id).join(",");
  // Single queries (not useQueries): refetch on every open so just-created
  // projects appear instead of serving the dashboard's older snapshot.
  const projectsQuery = useQuery({
    queryKey: ["palette-projects", orgKey],
    queryFn: async () => {
      const out: Array<ProjectListItem & { orgName: string }> = [];
      for (const o of orgs) {
        const list = await fetchAll<ProjectListItem>(`/projects?organizationId=${o.id}`);
        out.push(...list.map((p) => ({ ...p, orgName: o.name })));
      }
      return out;
    },
    enabled: open && orgs.length > 0,
    staleTime: 0,
  });
  const clientsQuery = useQuery({
    queryKey: ["palette-clients", orgKey],
    queryFn: async () => {
      const out: Client[] = [];
      for (const o of orgs) out.push(...(await fetchAll<Client>(`/clients?organizationId=${o.id}`)));
      return out;
    },
    enabled: open && orgs.length > 0,
    staleTime: 60_000,
  });
  const projects = projectsQuery.data ?? [];
  const clientNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clientsQuery.data ?? []) map.set(c.id, c.name);
    return map;
  }, [clientsQuery.data]);

  const go = (to: string): (() => void) => () => {
    onClose();
    navigate(to);
  };

  const entries: Entry[] = useMemo(() => {
    const list: Entry[] = [
      { id: "nav-projects", group: t("palette.groupGoTo"), label: t("palette.navProjects"), keywords: "home", run: go("/") },
      { id: "nav-inbox", group: t("palette.groupGoTo"), label: t("palette.navInbox"), keywords: "decisions notifications approvals", run: go("/inbox") },
    ];
    for (const o of orgs) {
      list.push({ id: `org-${o.id}`, group: t("palette.groupGoTo"), label: t("palette.workspaceSettings", { name: o.name }), keywords: "settings organization", run: go(`/orgs/${o.id}/settings`) });
    }
    if (projectId) {
      list.push(
        { id: "ctx-overview", group: t("palette.groupThisProject"), label: t("palette.ctxOverview"), run: go(`/projects/${projectId}`) },
        { id: "ctx-scope", group: t("palette.groupThisProject"), label: t("palette.ctxScope"), keywords: "baseline requirements", run: go(`/projects/${projectId}/scope`) },
        { id: "ctx-timeline", group: t("palette.groupThisProject"), label: t("palette.ctxTimeline"), keywords: "history milestones chronology", run: go(`/projects/${projectId}/timeline`) },
        { id: "ctx-activity", group: t("palette.groupThisProject"), label: t("palette.ctxActivity"), keywords: "audit trail history", run: go(`/projects/${projectId}/activity`) },
        { id: "ctx-health", group: t("palette.groupThisProject"), label: t("palette.ctxHealth"), keywords: "metrics signals", run: go(`/projects/${projectId}/health`) },
      );
    }
    for (const p of projects) {
      list.push({
        id: `project-${p.id}`,
        group: t("palette.groupProjects"),
        label: p.name,
        hint: clientNames.get(p.clientId) ?? p.orgName,
        keywords: `${clientNames.get(p.clientId) ?? ""} ${p.orgName}`,
        run: go(`/projects/${p.id}`),
      });
    }
    list.push(
      { id: "new-project", group: t("palette.groupCreate"), label: t("palette.newProject"), keywords: "add create", run: go("/?create=project") },
      { id: "new-client", group: t("palette.groupCreate"), label: t("palette.newClient"), keywords: "add create", run: go("/?create=client") },
      {
        id: "logout", group: t("palette.groupSession"), label: t("palette.logOut"), run: () => {
          onClose();
          void logout().then(() => navigate("/login"));
        },
      },
    );
    return list;
  }, [orgs, projects, clientNames, projectId, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    const scored = entries
      .map((e) => {
        const hay = `${e.label} ${e.keywords ?? ""}`.toLowerCase();
        if (e.label.toLowerCase().startsWith(q)) return { e, score: 0 };
        if (hay.includes(q)) return { e, score: 1 };
        return null;
      })
      .filter((x): x is { e: Entry; score: number } => x !== null)
      .sort((a, b) => a.score - b.score);
    return scored.map((s) => s.e);
  }, [entries, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open ]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c + 1) % filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (filtered.length === 0 ? 0 : (c - 1 + filtered.length) % filtered.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      filtered[cursor]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/50 p-4 pt-[12vh]" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.dialogLabel")}
        className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <span className="text-slate-400"><SearchIcon /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("palette.searchLabel")}
            placeholder={t("palette.searchPlaceholder")}
            autoComplete="off"
            spellCheck={false}
            className="w-full bg-transparent py-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          />
          {query ? (
            <button type="button" aria-label={t("palette.clearSearch")} onClick={() => setQuery("")} className="rounded px-1 text-slate-400 hover:text-slate-700">
              ✕
            </button>
          ) : null}
        </div>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{t("palette.noMatches")}</p>
        ) : (
          <ul ref={listRef} role="listbox" aria-label={t("palette.resultsLabel")} className="max-h-[40vh] overflow-y-auto py-2">
            {filtered.map((e, i) => {
              const header = e.group !== lastGroup ? e.group : null;
              lastGroup = e.group;
              return (
                <li key={e.id}>
                  {header ? <p className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-slate-500">{header}</p> : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === cursor}
                    data-active={i === cursor}
                    onClick={() => e.run()}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm ${
                      i === cursor ? "bg-teal-50 text-teal-900" : "text-slate-800"
                    }`}
                  >
                    <span className="truncate">{e.label}</span>
                    {e.hint ? <span className="shrink-0 text-xs text-slate-500">{e.hint}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          <span><Kbd>↑</Kbd> <Kbd>↓</Kbd> {t("palette.hintNavigate")}</span>
          <span><Kbd>{t("palette.keyEnter")}</Kbd> {t("palette.hintOpen")}</span>
          <span><Kbd>{t("palette.keyEsc")}</Kbd> {t("palette.hintClose")}</span>
        </div>
      </div>
    </div>
  );
}

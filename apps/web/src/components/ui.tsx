import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { useLocale } from "../lib/i18n/index.js";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const buttonVariants = cva(
  "tap inline-flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 rounded-lg px-4 py-2 text-sm",
  {
    variants: {
      variant: {
        primary: "bg-teal-700 text-white shadow-card ring-1 ring-inset ring-white/10 hover:bg-teal-800 hover:shadow-lift",
        secondary: "bg-surface text-slate-800 border border-slate-200 shadow-card hover:border-slate-300 hover:bg-slate-50",
        danger: "bg-red-600 text-white shadow-card hover:bg-red-500",
        ghost: "text-slate-700 hover:bg-slate-100 px-2",
      },
      size: {
        sm: "px-3 py-1.5 text-xs",
        md: "",
        lg: "px-5 py-2.5 text-base",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ variant, size, className, ...props }: ButtonProps): JSX.Element {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

const fieldBase =
  "w-full rounded-xl border border-slate-200 bg-surface px-3 py-2 text-sm text-slate-900 shadow-card placeholder:text-slate-400 transition-colors hover:border-slate-300 focus:border-teal-600";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
): JSX.Element {
  return <input ref={ref} className={cn(fieldBase, className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
): JSX.Element {
  return <textarea ref={ref} className={cn(fieldBase, className)} {...props} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
): JSX.Element {
  return (
    <select ref={ref} className={cn(fieldBase, "pr-8", className)} {...props}>
      {children}
    </select>
  );
});

export function Field({ label, error, hint, children, htmlFor }: { label: string; error?: string; hint?: string; children: ReactNode; htmlFor?: string }): JSX.Element {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-800">
        {label}
      </label>
      {children}
      {hint && !error ? <p className="text-xs text-slate-500">{hint}</p> : null}
      {error ? (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }): JSX.Element {
  return <section className={cn("rounded-xl border border-slate-200 bg-surface p-5 shadow-card", className)}>{children}</section>;
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }): JSX.Element {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4 animate-fade-up">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[28px] sm:leading-9">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-slate-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const badgeTones: Record<string, { box: string; dot: string }> = {
  slate: { box: "bg-slate-100 text-slate-800 ring-slate-200", dot: "bg-slate-400" },
  green: { box: "bg-emerald-50 text-emerald-900 ring-emerald-200", dot: "bg-emerald-500" },
  amber: { box: "bg-amber-50 text-amber-900 ring-amber-200", dot: "bg-amber-500" },
  red: { box: "bg-red-50 text-red-900 ring-red-200", dot: "bg-red-500" },
  blue: { box: "bg-sky-50 text-sky-900 ring-sky-200", dot: "bg-sky-500" },
};

export function Badge({ tone = "slate", children }: { tone?: keyof typeof badgeTones; children: ReactNode }): JSX.Element {
  const t = badgeTones[tone] ?? badgeTones.slate!;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", t.box)}>
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", t.dot)} />
      {children}
    </span>
  );
}

export function statusTone(status: string): keyof typeof badgeTones {
  if (["PUBLISHED", "APPROVED", "ACCEPTED", "ACTIVE", "READY", "SENT", "AGREED", "DEEMED"].includes(status)) return "green";
  if (["DRAFT", "SUBMITTED", "TRIAGING", "ESTIMATING", "PENDING_APPROVAL", "PROPOSED", "IN_PROGRESS", "PENDING"].includes(status)) return "amber";
  if (["REJECTED", "EXPIRED", "INVALIDATED", "OUT_OF_SCOPE", "DELETED"].includes(status)) return "red";
  return "blue";
}

export function Spinner(): JSX.Element {
  const { t } = useLocale();
  return (
    <span role="status" aria-label={t("common.loadingLabel")} className="inline-block size-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal-600 motion-reduce:animate-none" />
  );
}

/** Shared tab bar (inbox sections, project sections): segmented pill style. */
export function Tabs<T extends string>({ tabs, active, onChange, label }: {
  tabs: Array<{ id: T; label: string }>;
  active: T;
  onChange: (id: T) => void;
  label: string;
}): JSX.Element {
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100/70 p-1" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            "tap whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium",
            active === t.id ? "bg-surface text-slate-900 shadow-card ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Keyboard hint, e.g. <Kbd>Ctrl K</Kbd>. */
export function Kbd({ children }: { children: ReactNode }): JSX.Element {
  return (
    <kbd className="inline-flex items-center gap-0.5 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-600 shadow-[0_1px_0_rgb(var(--slate-200))]">
      {children}
    </kbd>
  );
}

/** Shimmering content placeholder for loading views. */
export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div aria-hidden="true" className={cn("skeleton h-4 w-full", className)} />;
}

/** Card-shaped loading placeholder used while lists load. */
export function SkeletonCards({ count = 3 }: { count?: number }): JSX.Element {
  return (
    <div role="status" aria-busy="true" className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-surface p-5 shadow-card">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="mt-3 h-3.5 w-2/3" />
          <Skeleton className="mt-2 h-3.5 w-1/2" />
        </div>
      ))}
    </div>
  );
}

/** Full-page loading placeholder: title block plus card skeletons. */
export function PageSkeleton(): JSX.Element {
  const { t } = useLocale();
  return (
    <div role="status" aria-label={t("common.loadingLabel")} className="animate-fade-in">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8"><SkeletonCards count={3} /></div>
    </div>
  );
}

/** Small stroke icon helper (lucide-style 24px paths). */
export function Icon({ d, className }: { d: string | readonly string[]; className?: string }): JSX.Element {
  const paths = Array.isArray(d) ? d : [d];
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={cn("size-4 shrink-0", className)}>
      {paths.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}

export const ICONS = {
  folder: "M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",
  inbox: ["M22 12h-6l-2 3h-4l-2-3H2", "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],
  lock: ["M7 11V7a5 5 0 0 1 10 0v4", "M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z"],
  search: ["m21 21-4.3-4.3", "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"],
  sun: ["M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  moon: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",
  logout: ["M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4", "m16 17 5-5-5-5", "M21 12H9"],
  settings: ["M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"],
  check: "M20 6 9 17l-5-5",
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
  shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z", "m9 12 2 2 4-4"],
  pulse: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  git: ["M6 3v12", "M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z", "M18 9a9 9 0 0 1-9 9"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  clock: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 6v6l4 2"],
  users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M22 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  menu: ["M4 6h16", "M4 12h16", "M4 18h16"],
  close: ["M18 6 6 18", "m6 6 12 12"],
  sparkle: ["M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"],
  plus: ["M5 12h14", "M12 5v14"],
  chevron: "m9 18 6-6-6-6",
  file: ["M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z", "M14 2v6h6", "M16 13H8", "M16 17H8"],
} as const;

export function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: keyof typeof ICONS }): JSX.Element {
  return (
    <div className="animate-fade-in rounded-xl border border-dashed border-slate-300 bg-surface px-6 py-12 text-center">
      <span aria-hidden="true" className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-teal-50 text-teal-700 ring-8 ring-teal-50/50">
        <Icon d={ICONS[icon ?? "sparkle"]} className="size-5" />
      </span>
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {hint ? <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ErrorBanner({ message, correlationId }: { message: string; correlationId?: string }): JSX.Element {
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p>{message}</p>
      {correlationId ? <p className="mt-1 text-xs text-red-700">Reference: {correlationId}</p> : null}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }): JSX.Element {
  const { t } = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn("max-h-[90vh] w-full animate-pop-in overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-6 shadow-pop", wide ? "max-w-3xl" : "max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t("common.closeDialog")} className="tap rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <Icon d={ICONS.close} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function formatMoney(minor: number | null | undefined, currency = "USD"): string {
  if (minor === null || minor === undefined) return "—";
  return `${currency} ${(minor / 100).toFixed(2)}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** ScopeLock mark: a rounded square with a padlock-shaped lock-in. */
export function LogoMark({ className }: { className?: string }): JSX.Element {
  return (
    <span aria-hidden="true" className={cn("inline-flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-teal-500 to-teal-700 text-white shadow-card ring-1 ring-inset ring-white/20", className)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="size-[18px]">
        <path d="M7 11V8a5 5 0 0 1 10 0v3" />
        <rect x="4.5" y="11" width="15" height="10" rx="2.5" />
        <path d="m9.5 16 1.8 1.8 3.2-3.4" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight text-slate-900", className)}>
      <LogoMark />
      <span className="text-[17px]">ScopeLock</span>
    </span>
  );
}

/** Light / dark / system theme (persisted; applied before first paint by index.html). */
export type ThemeChoice = "light" | "dark" | "system";

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function ThemeToggle({ className }: { className?: string }): JSX.Element {
  const { t } = useLocale();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const toggle = (): void => {
    const next: ThemeChoice = dark ? "light" : "dark";
    try {
      localStorage.setItem("sl-theme", next);
    } catch {
      // storage unavailable: the theme still applies for this session
    }
    applyTheme(next);
    setDark(!dark);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t("shell.theme")}
      title={t("shell.theme")}
      className={cn("tap inline-flex size-9 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900", className)}
    >
      <Icon d={dark ? ICONS.sun : ICONS.moon} className="size-[18px]" />
    </button>
  );
}

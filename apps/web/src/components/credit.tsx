/**
 * "Developed by CodeJBorg" credit elements.
 *
 * Theme mapping for this project (no hardcoded colors): the primary token is
 * teal-700, muted/foreground text is slate-*, borders are slate-*. The cursor
 * blink uses `motion-safe:` so it respects prefers-reduced-motion.
 */
import { cn } from "./ui.js";
import { useLocale } from "../lib/i18n/index.js";

const CREDIT_HREF = "https://junaidul.pro.bd/codejborg";

function CodeIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </svg>
  );
}

function ArrowUpRightIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

function CreditName({ className }: { className?: string }): JSX.Element {
  return (
    <span className={cn("font-semibold", className)}>
      <span className="text-link">&lt;</span>CodeJBorg<span className="text-link"> /&gt;</span>
    </span>
  );
}

/** Pill/badge variant for footers: icon disc, name, blinking cursor, arrow. */
export function CreditPill({ className }: { className?: string }): JSX.Element {
  const { t } = useLocale();
  return (
    <a
      href={CREDIT_HREF}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t("credit.visit")}
      className={cn(
        "group inline-flex items-center gap-2 rounded-full border border-slate-300 bg-surface py-1.5 pl-1.5 pr-3 font-mono text-[11px] tracking-wide text-slate-600 transition-colors duration-300 hover:border-teal-600 hover:bg-teal-50 hover:text-slate-900",
        className,
      )}
    >
      <span className="flex size-6 items-center justify-center rounded-full bg-teal-700 text-white">
        <CodeIcon className="size-3.5" />
      </span>
      <span>{t("credit.developedBy")}</span>
      <CreditName className="text-slate-900" />
      <span aria-hidden="true" className="inline-block h-3.5 w-[2px] bg-teal-700 motion-safe:animate-pulse" />
      <ArrowUpRightIcon className="size-3.5 opacity-40 transition-all duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:opacity-100" />
    </a>
  );
}

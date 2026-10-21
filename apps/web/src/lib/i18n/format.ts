/**
 * Intl-based formatters for NEW ui. Minor money units are always hundredths
 * (see @scopelock/domain money). Existing screens keep the legacy
 * `formatMoney`/`formatDate` in components/ui.tsx until Phase 6 migrates
 * every string; new screens must use these helpers via `useLocale()`.
 */
export function formatMoneyIntl(minor: number | null | undefined, currency: string, locale = "en"): string {
  if (minor === null || minor === undefined) return "—";
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
  } catch {
    // Never crash a render on display: fall back to the legacy spelling.
    return `${currency} ${(minor / 100).toFixed(2)}`;
  }
}

export function formatDateIntl(iso: string | null | undefined, locale = "en"): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export function formatNumberIntl(value: number, locale = "en"): string {
  return new Intl.NumberFormat(locale).format(value);
}

/** "in 3 days" / "2 hours ago" / "yesterday". Null when missing or too far out (caller shows the date). */
export function formatRelativeIntl(iso: string | null | undefined, locale = "en", nowMs = Date.now()): string | null {
  if (!iso) return null;
  const diffMs = new Date(iso).getTime() - nowMs;
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (abs < 45_000) return locale === "bn" ? "এইমাত্র" : "just now";
    if (abs < hour) {
      const m = Math.round(abs / minute);
      return rtf.format(diffMs < 0 ? -m : m, "minute");
    }
    if (abs < 22 * hour) {
      const h = Math.round(abs / hour);
      return rtf.format(diffMs < 0 ? -h : h, "hour");
    }
    if (abs < 45 * day) {
      const d = Math.round(abs / day);
      return rtf.format(diffMs < 0 ? -d : d, "day");
    }
    return null;
  } catch {
    return null;
  }
}

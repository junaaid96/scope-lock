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

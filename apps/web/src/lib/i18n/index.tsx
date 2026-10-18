import { createContext, useContext, type ReactNode } from "react";
import en from "./messages.en.json" with { type: "json" };
import { formatDateIntl, formatMoneyIntl, formatNumberIntl } from "./format.js";

export type Messages = typeof en;
export type MessageKey = DotPaths<Messages>;
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

/** Only English ships until Phase 6 adds Bangla; the catalog shape is final. */
export const SUPPORTED_LOCALES = ["en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const catalogs: Record<Locale, Messages> = { en };

export function defaultLocale(): Locale {
  return "en";
}

function lookup(locale: Locale, key: string): string | null {
  let node: unknown = catalogs[locale];
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null || !(part in node)) return null;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : null;
}

/** Translate a catalog key, interpolating `{name}` placeholders. Falls back to the key itself. */
export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const template = lookup(locale, key) ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name] ?? `{${name}}`));
}

const LocaleContext = createContext<Locale>("en");

export function LocaleProvider({ locale, children }: { locale?: Locale; children: ReactNode }): ReactNode {
  return <LocaleContext.Provider value={locale ?? defaultLocale()}>{children}</LocaleContext.Provider>;
}

export interface LocaleApi {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (minor: number | null | undefined, currency: string) => string;
  date: (iso: string | null | undefined) => string;
  number: (value: number) => string;
}

/** Per-user language plugs in here in Phase 6 (provider value from session). */
export function useLocale(): LocaleApi {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    money: (minor, currency) => formatMoneyIntl(minor, currency, locale),
    date: (iso) => formatDateIntl(iso, locale),
    number: (value) => formatNumberIntl(value, locale),
  };
}

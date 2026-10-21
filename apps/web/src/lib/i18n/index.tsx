import { createContext, useContext, useEffect, type ReactNode } from "react";
import en from "./messages.en.json" with { type: "json" };
import bn from "./messages.bn.json" with { type: "json" };
import { formatDateIntl, formatMoneyIntl, formatNumberIntl, formatRelativeIntl } from "./format.js";
import { useSession } from "../auth.js";

export type Messages = typeof en;
export type MessageKey = DotPaths<Messages>;
type DotPaths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${DotPaths<T[K]>}`;
}[keyof T & string];

export const SUPPORTED_LOCALES = ["en", "bn"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
const catalogs: Record<Locale, Messages> = { en, bn: bn as Messages };

export function defaultLocale(): Locale {
  return "en";
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "bn";
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
  const resolved = locale ?? defaultLocale();
  useEffect(() => {
    document.documentElement.lang = resolved;
  }, [resolved]);
  return <LocaleContext.Provider value={resolved}>{children}</LocaleContext.Provider>;
}

/** Authenticated shell locale: the signed-in user's preference, else English. */
export function SessionLocaleProvider({ children }: { children: ReactNode }): ReactNode {
  const { session } = useSession();
  const locale = session && isLocale(session.user.locale) ? session.user.locale : defaultLocale();
  return <LocaleProvider locale={locale}>{children}</LocaleProvider>;
}

export interface LocaleApi {
  locale: Locale;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  money: (minor: number | null | undefined, currency: string) => string;
  date: (iso: string | null | undefined) => string;
  number: (value: number) => string;
  relative: (iso: string | null | undefined) => string | null;
}

export function useLocale(): LocaleApi {
  const locale = useContext(LocaleContext);
  return {
    locale,
    t: (key, vars) => translate(locale, key, vars),
    money: (minor, currency) => formatMoneyIntl(minor, currency, locale),
    date: (iso) => formatDateIntl(iso, locale),
    number: (value) => formatNumberIntl(value, locale),
    relative: (iso) => formatRelativeIntl(iso, locale),
  };
}

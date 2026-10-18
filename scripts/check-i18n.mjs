/* global process, console */
// CI check: every t("key") used in the web client must exist in the English
// catalog, keys must be static string literals (no dynamic construction),
// and every non-English catalog must hold the exact same key set with the
// exact same {placeholders} per key.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "web", "src");
const I18N = join(SRC, "lib", "i18n");

function flatten(node, prefix = "") {
  const out = new Map();
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.set(full, value);
    else if (value && typeof value === "object") for (const [k, v] of flatten(value, full)) out.set(k, v);
  }
  return out;
}

function placeholders(value) {
  return new Set([...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]));
}

const errors = [];
const en = flatten(JSON.parse(readFileSync(join(I18N, "messages.en.json"), "utf8")));

// Per-locale parity: same keys, same placeholders.
for (const entry of readdirSync(I18N)) {
  const m = /^messages\.([a-z]{2})\.json$/.exec(entry);
  if (!m || m[1] === "en") continue;
  const locale = m[1];
  const other = flatten(JSON.parse(readFileSync(join(I18N, entry), "utf8")));
  for (const key of en.keys()) {
    if (!other.has(key)) errors.push(`messages.${locale}.json: missing key "${key}"`);
  }
  for (const key of other.keys()) {
    if (!en.has(key)) errors.push(`messages.${locale}.json: extra key "${key}" (not in en)`);
    else {
      const a = [...placeholders(en.get(key))].sort().join(",");
      const b = [...placeholders(other.get(key))].sort().join(",");
      if (a !== b) errors.push(`messages.${locale}.json: placeholder mismatch on "${key}" (en:{${a}} ${locale}:{${b}})`);
    }
  }
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) yield full;
  }
}

let uses = 0;
for (const file of walk(SRC)) {
  if (file.endsWith(join("lib", "i18n", "index.tsx"))) continue;
  const text = readFileSync(file, "utf8");
  const callRe = /\bt\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let match;
  while ((match = callRe.exec(text)) !== null) {
    const raw = match[1];
    if (raw.startsWith("`") && raw.includes("${")) {
      errors.push(`${file}: dynamic t() key is forbidden (use a literal key): ${raw.slice(0, 60)}`);
      continue;
    }
    const key = raw.slice(1, -1);
    uses++;
    if (!en.has(key)) errors.push(`${file}: unknown i18n key "${key}" (add it to messages.en.json)`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`i18n: ${e}`);
  process.exit(1);
}
console.log(`i18n check: ${uses} key uses, en+bn catalogs in parity (${en.size} keys)`);

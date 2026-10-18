/* global process, console */
// CI check: every t("key") used in the web client must exist in the English
// catalog, and keys must be static string literals (no dynamic construction).
// Phase 6 extends this to per-locale parity once Bangla lands.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "apps", "web", "src");

function flatten(node, prefix = "") {
  const out = new Set();
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out.add(full);
    else if (value && typeof value === "object") for (const k of flatten(value, full)) out.add(k);
  }
  return out;
}

const catalog = flatten(JSON.parse(readFileSync(join(SRC, "lib", "i18n", "messages.en.json"), "utf8")));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) yield full;
  }
}

const errors = [];
let uses = 0;
for (const file of walk(SRC)) {
  if (file.endsWith(join("lib", "i18n", "index.tsx"))) continue;
  const text = readFileSync(file, "utf8");
  const callRe = /\bt\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = callRe.exec(text)) !== null) {
    const raw = m[1];
    if (raw.startsWith("`") && raw.includes("${")) {
      errors.push(`${file}: dynamic t() key is forbidden (use a literal key): ${raw.slice(0, 60)}`);
      continue;
    }
    const key = raw.slice(1, -1);
    uses++;
    if (!catalog.has(key)) errors.push(`${file}: unknown i18n key "${key}" (add it to messages.en.json)`);
  }
}

if (errors.length > 0) {
  for (const e of errors) console.error(`i18n: ${e}`);
  process.exit(1);
}
console.log(`i18n check: ${uses} key uses, all present in messages.en.json`);

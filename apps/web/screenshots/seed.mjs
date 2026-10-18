/* global process, console */
// Screenshot seed step (`prescreenshots` hook): wipe + reseed the portfolio
// workspace into screenshots-data/ BEFORE Playwright boots its web servers.
// (Playwright starts webServer before globalSetup, so file-based seeding must
// live outside the Playwright run — the API loads DATA_FILE once at boot and
// never reloads it.) Captures the pending Haat review path for the spec.
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const HERE = import.meta.dirname;
const ROOT = join(HERE, "..", "..", "..");
const DATA_DIR = join(HERE, "..", "screenshots-data");

rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(join(DATA_DIR, "uploads"), { recursive: true });
const { stdout } = await execFileAsync("npx", ["tsx", join(ROOT, "prisma", "seed-portfolio.ts")], {
  cwd: ROOT,
  env: {
    ...process.env,
    DATABASE_URL: "",
    DATA_FILE: join(DATA_DIR, "scopelock.json"),
    UPLOAD_DIR: join(DATA_DIR, "uploads"),
    WEB_URL: "http://localhost:5200",
    API_URL: "http://localhost:4200",
    OUTBOX_AUTODRAIN: "false",
    RATE_LIMIT_DISABLED: "1",
  },
  maxBuffer: 16 * 1024 * 1024,
  timeout: 600_000,
});
const match = stdout.match(/\/review\/[A-Za-z0-9_-]+/);
writeFileSync(join(DATA_DIR, "review-link.json"), JSON.stringify({ reviewPath: match?.[0] ?? null }));
console.log(`seeded screenshots-data (${match ? "review link captured" : "NO review link found"})`);

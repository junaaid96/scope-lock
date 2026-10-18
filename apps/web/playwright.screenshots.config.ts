import { defineConfig } from "@playwright/test";
import { join } from "node:path";

const API_PORT = 4200;
const WEB_PORT = 5200;
const DATA_DIR = join(import.meta.dirname, "screenshots-data");

// Dedicated config for `npm run screenshots`: boots the compiled API against
// the file store seeded by the `prescreenshots` hook (screenshots/seed.mjs)
// and captures docs/screenshots/*.png. Never reuses existing servers — the
// data file is wiped and reseeded before every run for deterministic shots.
export default defineConfig({
  testDir: "./screenshots",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1440, height: 900 },
    animations: "disabled",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Requires `npm run build -w apps/api` first (uses the compiled server).
      command: `node ../api/dist/index.js`,
      env: {
        NODE_ENV: "test",
        PORT: String(API_PORT),
        WEB_URL: `http://localhost:${WEB_PORT}`,
        API_URL: `http://localhost:${API_PORT}`,
        DATABASE_URL: "",
        DATA_FILE: join(DATA_DIR, "scopelock.json"),
        UPLOAD_DIR: join(DATA_DIR, "uploads"),
        RATE_LIMIT_DISABLED: "1",
        OUTBOX_AUTODRAIN: "false",
      },
      port: API_PORT,
      reuseExistingServer: false,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
        PORT: String(WEB_PORT),
      },
      port: WEB_PORT,
      reuseExistingServer: false,
    },
  ],
});

import { defineConfig } from "@playwright/test";

const API_PORT = 4100;
const WEB_PORT = 5100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
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
        DATA_FILE: ":memory:",
        RATE_LIMIT_DISABLED: "1",
        OUTBOX_AUTODRAIN: "false",
      },
      port: API_PORT,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      env: {
        API_URL: `http://localhost:${API_PORT}`,
        PORT: String(WEB_PORT),
      },
      port: WEB_PORT,
      reuseExistingServer: !process.env.CI,
    },
  ],
});

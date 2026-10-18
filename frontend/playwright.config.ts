import { defineConfig } from "@playwright/test";
const base = (process.env.NEXT_PUBLIC_BASE_PATH || "").replace(/\/$/, "");
export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.pw.ts",
  timeout: 120_000,
  workers: 1,
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "webkit", use: { browserName: "webkit" } }],
  use: { baseURL: `http://127.0.0.1:3100${base}/` },
  webServer: { command: "node scripts/serve-static.mjs", url: `http://127.0.0.1:3100${base}/`, reuseExistingServer: false },
});

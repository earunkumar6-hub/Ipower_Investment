import { defineConfig, devices } from "@playwright/test";

// Acceptance checks for "CRM Changes 20-10.xlsx" (items #1–#32): e2e/changes-20-10.check.ts.
// Runs against a DEMO install (it adds receipts, entries and logins), never against real data:
//   cd D:\IPower_qa; docker compose -p ipower_qa up -d          # demo copy on port 3100 (INSTALL_MODE="demo")
//   docker compose -p ipower_qa exec app pnpm db:seed           # fresh demo day before each run
//   pnpm exec playwright test -c playwright.changes.config.ts
// No global setup here on purpose: `pnpm e2e`'s setup reseeds the dev database.
export default defineConfig({
  testDir: "e2e",
  testMatch: "changes-20-10.check.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: [["list"], ["json", { outputFile: "e2e-changes/results.json" }], ["html", { open: "never", outputFolder: "e2e-changes/report" }]],
  outputDir: "e2e-changes/artifacts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3100",
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
});

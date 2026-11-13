import { defineConfig, devices } from "@playwright/test";
import { QA_BASE_URL, QA_DB_URL, QA_PORT } from "./support/env";

// GRM QA suite (Phase 3). Separate from e2e/: own test database (flcrm_qa) and own app server (port 3100).
//   pnpm qa                       full suite
//   pnpm qa --project=chrome-1366 specs/customers.spec.ts   one module
// One worker: every suite shares one database and resets it in beforeAll.
const desktop = (width: number, height: number) => ({ ...devices["Desktop Chrome"], viewport: { width, height } });
const MODULE_SPECS = /\/specs\/(?!browser|volume).*\.spec\.ts$/;

export default defineConfig({
  testDir: ".",
  testMatch: /specs\/.*\.spec\.ts$/,
  globalSetup: "./support/global-setup.ts",
  outputDir: "./report/artifacts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "./report/html" }],
    ["json", { outputFile: "./report/results.json" }],
  ],
  use: {
    baseURL: QA_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: true,
  },
  projects: [
    // Every module, journey and cross-cutting spec – Chrome at 1366x768.
    { name: "chrome-1366", use: desktop(1366, 768), testMatch: MODULE_SPECS },
    // Browser check (smoke) at both sizes in Chrome and Edge.
    { name: "browser-chrome-1366", use: desktop(1366, 768), testMatch: /specs\/browser\.spec\.ts$/ },
    { name: "browser-chrome-1920", use: desktop(1920, 1080), testMatch: /specs\/browser\.spec\.ts$/ },
    { name: "browser-edge-1366", use: { ...desktop(1366, 768), channel: "msedge" }, testMatch: /specs\/browser\.spec\.ts$/ },
    { name: "browser-edge-1920", use: { ...desktop(1920, 1080), channel: "msedge" }, testMatch: /specs\/browser\.spec\.ts$/ },
    // Volume last: it loads 2,000 customers / 10,000 policies and resets the database afterwards.
    // (No `dependencies`: a failing module test must not stop the volume run. With one worker projects run in order.)
    { name: "volume", use: desktop(1366, 768), testMatch: /specs\/volume\.spec\.ts$/ },
  ],
  webServer: {
    command: `pnpm exec next dev --turbopack -p ${QA_PORT}`,
    cwd: "..",
    url: `${QA_BASE_URL}/login`,
    reuseExistingServer: true,
    timeout: 180_000,
    env: { DATABASE_URL: QA_DB_URL },
  },
});

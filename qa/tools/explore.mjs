// Dev aid for writing the QA suite: signs in on the QA app and saves the accessibility tree of each page.
// node qa/tools/explore.mjs <outDir> <username> <path> [<path> …]   (QA app on http://localhost:3100, test DB only)
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const [outDir, username, ...paths] = process.argv.slice(2);
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3100";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto(`${BASE}/login`);
await page.getByLabel("Username").fill(username);
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "demo1234");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
for (const p of paths) {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 120_000 });
  // Close the call reminder if it is closable, so the page underneath is read.
  const snap = await page.locator("body").ariaSnapshot();
  writeFileSync(`${outDir}/${username}${p.replace(/[/?=&]/g, "_")}.txt`, `URL ${page.url()}\n${snap}`);
  console.log("saved", p, snap.length);
}
await browser.close();

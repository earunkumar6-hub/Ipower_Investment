// Dev aid: visits every main page on the QA app (test DB only) and lists browser console errors / warnings and
// page errors – what Next's red "N Issues" badge in developer mode is made of. node qa/tools/console-scan.mjs [user]
import { chromium } from "@playwright/test";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3100";
const user = process.argv[2] ?? "superadmin";
const pages = [
  "/dashboard", "/leads", "/followups", "/quotations", "/quotations/new", "/proposals", "/customers", "/renewals", "/receipts", "/receipts/new", "/receipts/combined/new",
  "/receipts/groups", "/receipts/verification", "/direct-bills", "/direct-bills/new", "/esevai", "/expenses", "/daybook", "/pnl", "/commission", "/messages",
  "/tickets", "/tickets/new", "/settings", "/settings/accounts", "/settings/payment-modes", "/settings/dropdowns", "/settings/esevai-rates", "/settings/daybook",
  "/settings/users", "/settings/roles", "/settings/log", "/settings/products/new",
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
let current = "login";
const found = new Map();
const note = (kind, text) => {
  const key = `${kind}: ${text.replace(/\s+/g, " ").slice(0, 260)}`;
  if (!found.has(key)) found.set(key, new Set());
  found.get(key).add(current);
};
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") note(m.type(), m.text()); });
page.on("pageerror", (e) => note("pageerror", e.message));
await page.goto(`${BASE}/login`);
await page.getByLabel("Username").fill(user);
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "demo1234");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
for (const p of pages) {
  current = p;
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
}
for (const [msg, where] of found) console.log(`${msg}\n    on: ${[...where].join(", ")}\n`);
console.log(found.size ? `${found.size} distinct message(s)` : "No console errors or warnings on any page");
await browser.close();

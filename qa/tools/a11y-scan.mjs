// Dev aid (QA D-09): signs in on the QA app (test DB only) and lists, for every page, form fields with no accessible
// name and element ids used more than once. node qa/tools/a11y-scan.mjs [username] [path…]
import { chromium } from "@playwright/test";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3100";
const [username = "superadmin", ...extra] = process.argv.slice(2);
const pages = extra.length ? extra : [
  "/dashboard", "/leads", "/followups", "/quotations", "/proposals", "/customers", "/renewals", "/receipts", "/receipts/groups", "/receipts/verification",
  "/direct-bills", "/direct-bills/new", "/esevai", "/expenses", "/daybook", "/pnl", "/commission", "/messages", "/tickets", "/tickets/new",
  "/settings", "/settings/accounts", "/settings/payment-modes", "/settings/dropdowns", "/settings/esevai-rates", "/settings/daybook", "/settings/users", "/settings/roles", "/settings/log",
  "/settings/products/new",
];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto(`${BASE}/login`);
await page.getByLabel("Username").fill(username);
await page.getByLabel("Password").fill(process.env.QA_PASSWORD ?? "demo1234");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });

const scan = () => page.evaluate(() => {
  const named = (el) => {
    if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title")) return true;
    if (el.labels && el.labels.length) return true;
    return !!el.closest("label");
  };
  const fields = [...document.querySelectorAll("input:not([type=hidden]):not([aria-hidden=true]), select, textarea")].filter((el) => !el.closest("[aria-hidden=true]") && el.offsetParent !== null || el.type === "checkbox" || el.type === "radio");
  const unnamed = fields.filter((el) => !named(el)).map((el) => `${el.tagName.toLowerCase()}${el.type ? `[${el.type}]` : ""} name="${el.name}" id="${el.id}"`);
  const ids = {};
  document.querySelectorAll("[id]").forEach((el) => { if (el.id) ids[el.id] = (ids[el.id] ?? 0) + 1; });
  return { unnamed, dup: Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`) };
});

let problems = 0;
for (const p of pages) {
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle", timeout: 120_000 }).catch(() => undefined);
  // Close the follow-up reminder if it is closable.
  const r = await scan();
  if (r.unnamed.length || r.dup.length) { problems++; console.log(`\n${p}\n  unlabelled: ${r.unnamed.join(" | ") || "–"}\n  duplicate ids: ${r.dup.join(", ") || "–"}`); }
}
console.log(`\n${problems} of ${pages.length} pages with problems`);
await browser.close();

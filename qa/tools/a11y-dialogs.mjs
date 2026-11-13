// Dev aid (QA D-09): same scan as a11y-scan.mjs but for dialogs and record pages. QA app + test DB only.
import { chromium } from "@playwright/test";
const BASE = process.env.QA_BASE_URL ?? "http://localhost:3100";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
await page.goto(`${BASE}/login`);
await page.getByLabel("Username").fill("superadmin");
await page.getByLabel("Password").fill("demo1234");
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));
const scan = () => page.evaluate(() => {
  const named = (el) => !!(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.labels && el.labels.length) || el.closest("label"));
  const root = document.querySelector("[role=dialog]") ?? document.body;
  const fields = [...root.querySelectorAll("input:not([type=hidden]):not([aria-hidden=true]), select, textarea")].filter((el) => !el.closest("[aria-hidden=true]"));
  const ids = {}; document.querySelectorAll("[id]").forEach((el) => { ids[el.id] = (ids[el.id] ?? 0) + 1; });
  return { unnamed: fields.filter((el) => !named(el)).map((el) => `${el.tagName.toLowerCase()}[${el.type}] name="${el.name}" id="${el.id}"`), dup: Object.entries(ids).filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`) };
});
const show = async (label) => { const r = await scan(); console.log(`${label}: unlabelled=${r.unnamed.join(" | ") || "none"}; duplicate ids=${r.dup.join(", ") || "none"}`); };
const cust = (await (await page.request.get(`${BASE}/customers?q=Rajesh`)).text()).match(/\/customers\/([a-z0-9]{20,})/)[1];
const prop = (await (await page.request.get(`${BASE}/proposals`)).text()).match(/\/proposals\/([a-z0-9]{20,})/)?.[1];

await page.goto(`${BASE}/leads`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Add lead" }).first().click(); await page.waitForTimeout(500); await show("Leads → Add lead dialog");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/followups`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Schedule call" }).click(); await page.waitForTimeout(500); await show("Follow-ups → Schedule call");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/customers/${cust}`, { waitUntil: "networkidle" });
await show("Customer page");
await page.getByRole("button", { name: "Edit details" }).click(); await page.waitForTimeout(800); await show("Customer → Edit details");
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /Aadhaar \/ PAN/ }).click(); await page.waitForTimeout(500); await show("Customer → Aadhaar / PAN");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/customers/${cust}/add-product`, { waitUntil: "networkidle" }); await show("Add product directly");
await page.goto(`${BASE}/receipts/new?customerId=${cust}`, { waitUntil: "networkidle" }); await show("New receipt");
await page.goto(`${BASE}/receipts/combined/new`, { waitUntil: "networkidle" }); await show("Combined receipt");
await page.goto(`${BASE}/quotations/new?customerId=${cust}`, { waitUntil: "networkidle" }); await show("New quotation");
if (prop) { await page.goto(`${BASE}/proposals/${prop}`, { waitUntil: "networkidle" }); await show("Proposal page"); }
await page.goto(`${BASE}/renewals`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Deactivate/ }).first().click(); await page.waitForTimeout(500); await show("Renewals → Deactivate / delete");
await page.keyboard.press("Escape");
await page.goto(`${BASE}/daybook`, { waitUntil: "networkidle" }); await show("Day Book (whole page)");
await browser.close();

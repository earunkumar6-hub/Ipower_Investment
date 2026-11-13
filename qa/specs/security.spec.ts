import { request as pwRequest } from "@playwright/test";
import { LeadsPage } from "../pages/leads-page";
import { TicketsPage } from "../pages/tickets-page";
import { resetDb } from "../support/db";
import { QA_BASE_URL } from "../support/env";
import { expect, stamp, test } from "../support/fixtures";

// Basic security: XSS / SQL injection strings, APIs without a session, a User calling admin-only APIs and pages.
test.beforeAll(async () => resetDb());

const XSS = [`<img src=x onerror="window.__xss=1">`, `<script>window.__xss=1</script>`];
const SQLI = [`' OR 1=1 --`, `'; DROP TABLE "Customer"; --`, `" OR ""="`];

test("[SEC-01] XSS strings in a lead name and a ticket title are shown as text and never run", async ({ page, loginAs, db }) => {
  let dialogs = 0;
  page.on("dialog", (d) => { dialogs++; return d.dismiss(); });
  await loginAs("arun");
  const leads = new LeadsPage(page);
  await leads.goto();
  const m = `9${stamp()}111`;
  await leads.addLead({ first: XSS[0], last: "QA", mobile: m });
  await expect.poll(() => db.lead.count({ where: { mobile: m } })).toBe(1);
  await leads.goto();
  await expect(page.getByText(XSS[0]).first()).toBeVisible();

  const t = new TicketsPage(page);
  const title = `QA ${XSS[1]} ${stamp()}`;
  await t.raise({ title, screen: "Leads", type: "Problem", priority: /^Low/, details: XSS[0] });
  await expect.poll(() => db.ticket.count({ where: { title } })).toBe(1);
  await page.goto("/tickets");
  await expect(page.getByText(title)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(dialogs).toBe(0);
});

test("[SEC-02] SQL injection strings in search and filters return no extra rows and no error", async ({ page, loginAs, db }) => {
  const before = await db.customer.count();
  await loginAs("admin");
  for (const s of SQLI) {
    const res = await page.goto(`/customers?q=${encodeURIComponent(s)}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
    const r2 = await page.goto(`/receipts?q=${encodeURIComponent(s)}&policyNo=${encodeURIComponent(s)}`);
    expect(r2?.status()).toBe(200);
    const r3 = await page.goto(`/leads?q=${encodeURIComponent(s)}`);
    expect(r3?.status()).toBe(200);
  }
  expect(await db.customer.count()).toBe(before);
});

test("[SEC-03] APIs return no data without a session", async ({ db }) => {
  const anon = await pwRequest.newContext({ baseURL: QA_BASE_URL });
  const receipt = await db.receipt.findFirstOrThrow();
  const customer = await db.customer.findFirstOrThrow();
  const quote = await db.quotation.findFirstOrThrow();
  for (const path of ["/api/export/customers", "/api/export/pnl", `/api/receipts/${receipt.id}/pdf`, `/api/customers/${customer.id}/photo`, `/api/quotations/${quote.id}/pdf`, "/api/attachments/x", "/api/instalment-bills"]) {
    const res = await anon.get(path, { maxRedirects: 0 });
    const type = res.headers()["content-type"] ?? "";
    expect([301, 302, 303, 307, 308, 401, 403, 404], `${path} → ${res.status()}`).toContain(res.status());
    expect(type, path).not.toMatch(/spreadsheet|pdf|image/);
  }
  await anon.dispose();
});

test("[SEC-04] a User calling admin-only exports gets 403", async ({ page, loginAs }) => {
  await loginAs("arun");
  for (const r of ["pnl", "commission", "daybook", "customers"]) {
    expect((await page.request.get(`/api/export/${r}`)).status(), r).toBe(403);
  }
});

test("[SEC-05] a User opening Super-Admin pages is denied", async ({ page, loginAs, shell }) => {
  await loginAs("arun");
  for (const p of ["/settings/roles", "/pnl", "/commission", "/settings/users", "/settings/log"]) {
    await page.goto(p);
    await shell.expectDenied();
  }
});

test("[SEC-06] an unknown report name is 404", async ({ page, loginAs }) => {
  await loginAs("admin");
  expect((await page.request.get("/api/export/not-a-report")).status()).toBe(404);
});

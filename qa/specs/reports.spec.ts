import ExcelJS from "exceljs";
import { sheetRows } from "../pages/renewals-page";
import { resetDb } from "../support/db";
import { expect, test } from "../support/fixtures";

// Reports and dashboard: totals equal DB queries; exports equal the screen.
test.beforeAll(async () => resetDb());

async function getXlsx(page: import("@playwright/test").Page, path: string) {
  const res = await page.request.get(path);
  expect(res.status(), `${path} status`).toBe(200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.body()) as unknown as ArrayBuffer);
  return wb;
}

const istToday = () => new Date(`${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

test("[DASH-01] dashboard 'Collected' this month equals saved receipts + ESEVAI collections", async ({ page, loginAs, db }) => {
  const today = istToday();
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  const r = await db.receipt.aggregate({ where: { status: "Saved", receiptDate: { gte: from, lt: to } }, _sum: { amount: true } });
  const s = await db.serviceTransaction.aggregate({ where: { status: "Saved", txnDate: { gte: from, lt: to } }, _sum: { customerAmount: true } });
  const expected = Number(r._sum.amount ?? 0) + Number(s._sum.customerAmount ?? 0);
  await loginAs("superadmin");
  await page.goto("/dashboard");
  await expect.poll(async () => (await page.locator("main").innerText()).replace(/\s+/g, " ")).toContain(`Collected ${inr(expected)}`);
});

test("[DASH-02] 'Renewals due this week' lists exactly the DB's bills due in the next 7 days", async ({ page, loginAs, db }) => {
  const today = istToday();
  const expected = await db.renewalItem.count({ where: { status: "Due", dueDate: { gte: today, lt: new Date(today.getTime() + 7 * 86_400_000) } } });
  await loginAs("superadmin");
  await page.goto("/dashboard");
  const table = page.locator("table").filter({ has: page.getByRole("columnheader", { name: "Due" }) }).filter({ has: page.getByRole("columnheader", { name: "Product" }) }).first();
  // The panel lists the first 15 and says how many more (D-04 fix, 13 Nov 2026).
  await expect(table.locator("tbody tr").filter({ hasNotText: /^Nothing|No renewals|more due this week/ })).toHaveCount(Math.min(expected, 15));
  if (expected > 15) await expect(table.getByText(`…and ${expected - 15} more due this week`)).toBeVisible();
});

test("[RPT-06] customer list Excel has every customer and every customer column", async ({ page, loginAs, db }) => {
  await loginAs("admin");
  const wb = await getXlsx(page, "/api/export/customers");
  const { header, rows } = sheetRows(wb.worksheets[0]);
  expect(rows.length).toBe(await db.customer.count());
  for (const col of ["Email", "Address", "PAN", "Aadhaar", "Consent taken", "Staff", "Added on"]) expect(header).toContain(col);
  // Mobiles masked in exports.
  const mobileCols = header.map((h, i) => (/mobile|whatsapp/i.test(h) ? i + 1 : 0)).filter(Boolean);
  for (const r of rows) for (const c of mobileCols) { const v = String(r.getCell(c).value ?? ""); if (v) expect(v).toMatch(/x{4,}/); }
});

test("[RPT-05] a one-customer download has no owner-paid slips", async ({ page, loginAs, db }) => {
  const withSlip = await db.ownerPaidSlip.findFirst({ select: { customerId: true } });
  const c = withSlip ? { id: withSlip.customerId } : await db.customer.findFirstOrThrow();
  await loginAs("admin");
  const wb = await getXlsx(page, `/api/export/customer?id=${c.id}`);
  expect(wb.worksheets.map((w) => w.name).join("|")).not.toMatch(/owner/i);
  wb.eachSheet((ws) => ws.eachRow((r) => expect(String(r.values)).not.toMatch(/\bOPS-\d+/)));
});

test("[RPT-07] receipts Excel lists the same receipt numbers as the screen", async ({ page, loginAs }) => {
  await loginAs("admin");
  await page.goto("/receipts");
  const screen = (await page.locator("main table").first().locator("tbody tr td:nth-child(2)").allInnerTexts()).map((s) => s.trim()).filter(Boolean);
  const wb = await getXlsx(page, "/api/export/receipts");
  const { rows } = sheetRows(wb.worksheets[0]);
  const excel = rows.map((r) => String(r.getCell(1).value));
  for (const no of screen) expect(excel).toContain(no);
});

test("[RPT-08] Users cannot download exports", async ({ page, loginAs }) => {
  await loginAs("arun");
  const res = await page.request.get("/api/export/customers");
  expect(res.status()).toBe(403);
});

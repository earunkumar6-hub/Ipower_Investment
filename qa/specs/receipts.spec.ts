import { ReceiptForm } from "../pages/receipt-page";
import { resetDb } from "../support/db";
import { expect, test } from "../support/fixtures";

// Receipts: payment modes, cash notes, change given back, AA- numbering, cancel, combined receipt (#5 #6 #21 #37 #44 #45 #47).
test.beforeAll(async () => resetDb());

async function customerWithDue(db: import("@prisma/client").PrismaClient, name: string) {
  return db.customer.findFirstOrThrow({ where: { name } });
}

test("[RCPT-10] the bills table has no Bill column", async ({ page, loginAs, db }) => {
  const c = await customerWithDue(db, "Rajesh Kumar");
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  const headers = (await page.locator("main table").first().locator("th").allInnerTexts()).map((s) => s.trim());
  expect(headers).not.toContain("Bill");
});

test("[RCPT-06] cash notes must add up to the amount", async ({ page, loginAs, db }) => {
  const c = await customerWithDue(db, "Rajesh Kumar");
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  await f.dueBoxes().first().check();
  const amt = await f.amountValue();
  expect(amt).toBeGreaterThan(0);
  await f.payCash(amt - 10);
  await expect(f.save()).toBeDisabled();
  await f.payCash(amt);
  await expect(f.save()).toBeEnabled();
});

test("[RCPT-02] UPI needs a reference", async ({ page, loginAs, db }) => {
  const c = await customerWithDue(db, "Rajesh Kumar");
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  await f.dueBoxes().first().check();
  await f.mode("UPI").click();
  await expect(f.save()).toBeDisabled();
});

test("[RCPT-01] a cash receipt for one due gets an AA- number and pays the bill", async ({ page, loginAs, db, shell }) => {
  const c = await customerWithDue(db, "Meena R");
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  await f.dueBoxes().first().check();
  const amt = await f.amountValue();
  await f.payCash(amt);
  await f.save().click();
  if (await page.getByRole("dialog").filter({ hasText: "Check before saving" }).count()) await shell.confirmSave();
  await page.waitForURL(/\/(receipts|payments)\/c/);
  const id = page.url().split("/").pop()!;
  const r = await db.receipt.findUniqueOrThrow({ where: { id } });
  expect(r.receiptNo).toMatch(/^AA-\d{2,}$/);
  expect(r.mode).toBe("Cash");
  expect(Number(r.amount)).toBe(amt);
  expect(await db.renewalItem.count({ where: { paidReceiptId: id, status: "Paid" } })).toBeGreaterThan(0);
  expect(await db.dayBookEntry.count({ where: { sourceId: id } })).toBeGreaterThan(0);
  await expect(page.getByText(r.receiptNo).first()).toBeVisible();
});

test("[RCPT-07] change given back: received − change = amount", async ({ page, loginAs, db, shell }) => {
  const c = await customerWithDue(db, "Saranya L");
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  await f.dueBoxes().first().check();
  const amt = await f.amountValue();
  // Received: enough ₹500 notes to exceed the amount; change = the difference in ₹10s / coins.
  const received = Math.ceil((amt + 1) / 500) * 500;
  const change = received - amt;
  await f.mode("Cash").click();
  await f.notes()[500].fill(String(received / 500));
  await expect(f.save()).toBeDisabled();
  await page.getByRole("button", { name: "+ Change given back" }).click();
  const ch = f.notes("change");
  if (Math.floor(change / 10)) await ch[10].fill(String(Math.floor(change / 10)));
  if (change % 10) await ch.coins.fill(String(change % 10));
  await expect(f.save()).toBeEnabled();
  await f.save().click();
  if (await page.getByRole("dialog").filter({ hasText: "Check before saving" }).count()) await shell.confirmSave();
  await page.waitForURL(/\/(receipts|payments)\/c/);
  const r = await db.receipt.findUniqueOrThrow({ where: { id: page.url().split("/").pop()! } });
  expect(JSON.stringify(r.denominations)).toContain("change");
  expect(Number(r.amount)).toBe(amt);
});

test("[RCPT-21] a cancelled receipt number is never reused", async ({ page, loginAs, db, shell }) => {
  const last = await db.receipt.findFirstOrThrow({ where: { receiptNo: { startsWith: "AA-" } }, orderBy: { createdAt: "desc" } });
  await loginAs("admin");
  await page.goto(`/receipts/${last.id}`);
  await page.getByLabel("Reason (required)").fill("QA cancel test");
  await page.getByRole("button", { name: /cancel/i }).last().click();
  await expect.poll(async () => (await db.receipt.findUniqueOrThrow({ where: { id: last.id } })).status).toBe("Cancelled");

  const c = await customerWithDue(db, "Karthik V");
  const f = new ReceiptForm(page);
  await f.gotoCustomer(c.id);
  await f.dueBoxes().first().check();
  await f.payCash(await f.amountValue());
  await f.save().click();
  if (await page.getByRole("dialog").filter({ hasText: "Check before saving" }).count()) await shell.confirmSave();
  await page.waitForURL(/\/(receipts|payments)\/c/);
  const fresh = await db.receipt.findUniqueOrThrow({ where: { id: page.url().split("/").pop()! } });
  const num = (s: string) => Number(s.replace(/\D/g, ""));
  expect(num(fresh.receiptNo)).toBeGreaterThan(num(last.receiptNo));
  const dupes = await db.receipt.groupBy({ by: ["tenantId", "receiptNo"], _count: true, having: { receiptNo: { _count: { gt: 1 } } } });
  expect(dupes).toEqual([]);
});

test("[RCPT-25] a combined receipt for two customers' bills is ONE AA- receipt with lines", async ({ page, loginAs, db, shell }) => {
  await loginAs("arun");
  const f = new ReceiptForm(page);
  await f.gotoCombined();
  const boxes = f.dueBoxes();
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByLabel("Paid by").fill("QA Payer");
  await page.getByLabel(/Payer's mobile/).fill("9876543210");
  const amt = await f.amountValue();
  await f.payCash(amt);
  await f.save().click();
  if (await page.getByRole("dialog").filter({ hasText: "Check before saving" }).count()) await shell.confirmSave();
  await page.waitForURL(/\/payments\/c/);
  const pay = await db.payment.findUniqueOrThrow({ where: { id: page.url().split("/").pop()! }, include: { receipts: true } });
  expect(pay.paymentNo).toMatch(/^AA-\d{2,}$/);
  expect(pay.kind).toBe("Combined");
  expect(pay.receipts.length).toBe(2);
  for (const r of pay.receipts) expect(r.receiptNo).toMatch(new RegExp(`^${pay.paymentNo}/\\d+$`));
  expect(await db.payment.count({ where: { paymentNo: { startsWith: "PAY-" }, createdAt: { gte: pay.createdAt } } })).toBe(0);
  await expect(page.getByRole("heading", { name: /Receipt/ }).first()).toBeVisible();
});

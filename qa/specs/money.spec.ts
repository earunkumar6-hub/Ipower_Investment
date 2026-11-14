import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// Expenses (#42), Day Book (#6 #22 #32 #43), Esevai & CSC (#15 #16 #46, UTR/notes removed).
// The expense form's boxes have no accessible names (A11Y-01): found by field name there.
test.beforeAll(async () => resetDb());

const expenseForm = (page: import("@playwright/test").Page) => page.locator("main form").filter({ has: page.getByRole("button", { name: "Submit" }) });

async function fillExpense(page: import("@playwright/test").Page, e: { amount: string; vendor: string; billNo?: string; mode: string; reference?: string; notes?: string }) {
  const f = expenseForm(page);
  await f.getByLabel("Purpose").selectOption({ index: 1 });
  await f.locator('[name="description"]').fill("QA stationery");
  await f.locator('[name="amount"]').fill(e.amount);
  await f.locator('[name="vendor"]').fill(e.vendor);
  if (e.billNo !== undefined) await f.locator('[name="billNo"]').fill(e.billNo);
  await f.locator('select[name="mode"]').selectOption({ label: e.mode });
  // Non-cash expenses are paid from a bank account (office cash would ask for notes).
  if (e.mode !== "Cash") await f.locator('select[name="fromAccount"]').selectOption({ label: (await f.locator('select[name="fromAccount"] option').allInnerTexts()).find((o) => /SBI|••/.test(o))! });
  if (e.reference !== undefined && (await f.locator('[name="reference"]').count())) await f.locator('[name="reference"]').fill(e.reference);
  if (e.mode === "Cash") await f.getByLabel("₹10 ×", { exact: true }).fill(String(Number(e.amount) / 10));
  await f.locator('[name="notes"]').fill(e.notes ?? "QA expense");
  return f;
}

test.describe("Expenses (#42)", () => {
  test("[EXP-01] a UPI expense needs a transaction ID", async ({ page, loginAs, db }) => {
    const vendor = `QA Vendor ${stamp()}`;
    await loginAs("arun");
    await page.goto("/expenses");
    const f = await fillExpense(page, { amount: "250", vendor, mode: "UPI", reference: "" });
    await f.getByRole("button", { name: "Submit" }).click();
    await expect(f.getByText(/transaction/i).last()).toBeVisible();
    expect(await db.expense.count({ where: { vendor: { name: vendor } } })).toBe(0);
  });

  test("[EXP-02] cash has no transaction ID box", async ({ page, loginAs }) => {
    await loginAs("arun");
    await page.goto("/expenses");
    const f = expenseForm(page);
    await f.locator('select[name="mode"]').selectOption({ label: "Cash" });
    await expect(f.locator('[name="reference"]')).toHaveCount(0);
  });

  test("[EXP-03][EXP-04] bill no. is optional; the same vendor's bill no. twice opens the pop-up", async ({ page, loginAs, db }) => {
    const vendor = `QA Vendor ${stamp()}`;
    await loginAs("arun");
    await page.goto("/expenses");
    // No bill number: saved.
    let f = await fillExpense(page, { amount: "120", vendor, mode: "UPI", reference: `UTR${stamp()}` });
    await f.getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => db.expense.count({ where: { vendor: { name: vendor } } })).toBe(1);
    // Bill QA-1 once: saved; twice: pop-up, not saved.
    await page.goto("/expenses");
    f = await fillExpense(page, { amount: "130", vendor, billNo: "QA-1", mode: "UPI", reference: `UTR${stamp()}1` });
    await f.getByRole("button", { name: "Submit" }).click();
    await expect.poll(() => db.expense.count({ where: { vendor: { name: vendor } } })).toBe(2);
    await page.goto("/expenses");
    f = await fillExpense(page, { amount: "140", vendor, billNo: "QA-1", mode: "UPI", reference: `UTR${stamp()}2` });
    await f.getByRole("button", { name: "Submit" }).click();
    await expect(page.getByRole("dialog").filter({ hasText: "Bill already entered" })).toBeVisible();
    expect(await db.expense.count({ where: { vendor: { name: vendor } } })).toBe(2);
  });

  test("[EXP-05] the form's help text matches the rule (bill no. optional)", async ({ page, loginAs }) => {
    await loginAs("arun");
    await page.goto("/expenses");
    await expect(page.getByText(/Bill number is required/)).toHaveCount(0);
  });
});

test.describe("Day Book", () => {
  const formWith = (page: import("@playwright/test").Page, button: RegExp) => page.locator("form").filter({ has: page.getByRole("button", { name: button }) });

  test("[DB-15] ATM 'Withdrawn by' defaults to the signed-in person", async ({ page, loginAs }) => {
    await loginAs("arun");
    await page.goto("/daybook");
    const f = formWith(page, /Record ATM withdrawal/);
    await expect(f.getByLabel("Withdrawn by").locator("option:checked")).toHaveText("Arun");
  });

  test("[DB-01] ATM withdrawal notes must add up", async ({ page, loginAs, db }) => {
    await loginAs("admin");
    await page.goto("/daybook");
    const f = formWith(page, /Record ATM withdrawal/);
    await expect(f.getByLabel("Bank account").locator("option:checked")).not.toHaveText(""); // the only bank is pre-selected
    await f.getByLabel("Amount").fill("1000");
    await f.getByLabel("Transaction no.").fill(`ATM${stamp()}`);
    await f.getByLabel("Reason").fill("QA float");
    const txn = await f.getByLabel("Transaction no.").inputValue();
    await f.getByLabel("₹500 ×", { exact: true }).fill("1"); // ₹500 counted for ₹1,000
    await f.getByRole("button", { name: /Record ATM withdrawal/ }).click();
    await expect(f.getByText(/must come to|short|add up/i).first()).toBeVisible();
    expect(await db.dayBookEntry.count({ where: { sourceNo: txn } })).toBe(0);
  });

  test("[DB-05] other income in cash asks for the notes", async ({ page, loginAs }) => {
    await loginAs("admin");
    await page.goto("/daybook");
    const f = formWith(page, /Record other income/);
    await f.getByLabel("Received in").selectOption({ label: "Cash" });
    await expect(f.getByLabel("₹500 ×", { exact: true })).toBeVisible();
  });

  test("[DB-11] Cash / UPI exchange needs the UPI transaction no.", async ({ page, loginAs, db }) => {
    const before = await db.dayBookEntry.count({ where: { entryType: "CashUpiExchange" } });
    await loginAs("admin");
    await page.goto("/daybook");
    const f = formWith(page, /Record exchange/);
    await f.getByRole("button", { name: "Cash given · UPI received" }).click();
    await f.getByLabel("Amount").fill("500");
    await expect(f.getByLabel("UPI received into").locator("option:checked")).not.toHaveText("");
    await f.getByLabel("Person").fill("QA Person");
    await f.getByLabel("₹500 ×", { exact: true }).fill("1");
    await f.getByRole("button", { name: /Record exchange/ }).click();
    await page.waitForLoadState("networkidle");
    expect(await db.dayBookEntry.count({ where: { entryType: "CashUpiExchange" } })).toBe(before);
  });

  test("[DB-10] Cash / UPI exchange is one contra row, not income or expense", async ({ page, loginAs, db }) => {
    const txn = `UPI${stamp()}`;
    await loginAs("admin");
    await page.goto("/daybook");
    const f = formWith(page, /Record exchange/);
    await f.getByRole("button", { name: "Cash given · UPI received" }).click();
    await f.getByLabel("Amount").fill("500");
    await expect(f.getByLabel("UPI received into").locator("option:checked")).not.toHaveText("");
    await f.getByLabel("UPI transaction no.").fill(txn);
    await f.getByLabel("Person").fill("QA Person");
    await f.getByLabel("₹500 ×", { exact: true }).fill("1");
    await f.getByRole("button", { name: /Record exchange/ }).click();
    await expect.poll(() => db.dayBookEntry.count({ where: { sourceNo: txn } })).toBeGreaterThan(0);
    const lines = await db.dayBookEntry.findMany({ where: { sourceNo: txn } });
    expect(lines.every((l) => l.entryType === "CashUpiExchange")).toBe(true);
    const signed = lines.reduce((t, l) => t + (l.direction === "In" ? 1 : -1) * Number(l.amount), 0);
    expect(signed).toBe(0); // cash down, bank up by the same amount
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: /Cash \/ UPI exchange/ }).first()).toBeVisible();
  });
});

test.describe("Esevai & CSC", () => {
  test("[ESV-10][ESV-11][ESV-12] named Esevai & CSC; entry button is Save; no UTR / Notes", async ({ page, loginAs }) => {
    await loginAs("arun");
    await expect(page.getByRole("complementary").getByRole("link", { name: "Esevai & CSC" })).toBeVisible();
    await page.goto("/esevai");
    await expect(page.getByRole("heading", { name: "New Esevai & CSC entry" })).toBeVisible();
    const f = page.locator("form").filter({ has: page.getByRole("heading", { name: "New Esevai & CSC entry" }) }).first();
    const scope = (await f.count()) ? f : page.locator("main");
    await expect(page.getByRole("button", { name: "Save", exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /print/i })).toHaveCount(0);
    await expect(scope.getByLabel(/UTR/i)).toHaveCount(0);
    await expect(page.locator('form [name="notes"], form [name="utr"]')).toHaveCount(0);
  });

  test("[ESV-20] the rates page lists EB slabs and fixed rates with start dates", async ({ page, loginAs }) => {
    await loginAs("admin");
    await page.goto("/settings/esevai-rates");
    await expect(page.getByText(/EB/).first()).toBeVisible();
    await expect(page.getByText(/PAN/).first()).toBeVisible();
    await expect(page.getByText(/\d{2}\/\d{2}\/\d{4}/).first()).toBeVisible();
  });

  test("[ESV-22] an EB bill of ₹1,500 has no slab rate: nothing is pre-filled and staff type the charge (Q9)", async ({ page, loginAs, db }) => {
    await loginAs("arun");
    await page.goto("/esevai");
    const svc = page.getByLabel("Service", { exact: true });
    await svc.selectOption({ label: (await svc.locator("option").allInnerTexts()).find((o) => /^EB/.test(o.trim()))!.trim() });
    await page.getByLabel("EB amount paid").fill("1500");
    // No slab for ₹1,000–1,999: nothing is filled in for "Collected"; the entry saves with what staff type.
    await expect(page.getByLabel("Collected from customer")).toHaveValue("");
    await page.locator('[name="providerRef"]').fill("QA-EB-1500");
    await page.getByLabel("Mobile", { exact: true }).fill("9876512345");
    await page.getByLabel("Name", { exact: true }).fill("QA EB");
    await page.getByLabel("Gender").selectOption({ index: 1 });
    await page.getByLabel("Collected from customer").fill("1520");
    await page.getByLabel("₹500 ×", { exact: true }).first().fill("3");
    await page.getByLabel("₹10 ×", { exact: true }).first().fill("2");
    await page.getByRole("button", { name: "Save", exact: true }).first().click();
    await expect.poll(() => db.serviceTransaction.count({ where: { providerRef: "QA-EB-1500" } })).toBe(1);
  });
});

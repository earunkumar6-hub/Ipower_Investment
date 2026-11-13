import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// Settings: products (bill rule, category), bank accounts (MICR), payment modes.
test.beforeAll(async () => resetDb());

async function addProduct(page: import("@playwright/test").Page, p: { name: string; type: string; partner: string; category: string; bills: string; payModes: string[] }) {
  await page.goto("/settings/products/new");
  await page.getByLabel("Product name").fill(p.name);
  await page.getByLabel("Type").selectOption({ label: p.type });
  await page.getByLabel("Partner").fill(p.partner);
  await page.getByLabel("Category (quotation product list)").fill(p.category);
  await page.getByLabel("Bills (invoice rule)").selectOption({ label: p.bills });
  for (const m of ["One-time", "Monthly", "Quarterly", "Half-yearly", "Yearly"]) await page.getByRole("checkbox", { name: m, exact: true }).setChecked(p.payModes.includes(m));
  await page.getByRole("button", { name: /^Add product$/ }).click();
}

test("[PROD-10] a new Category typed on a product becomes a quotation group", async ({ page, loginAs, db }) => {
  const name = `QA Car ${stamp()}`;
  await loginAs("admin");
  await addProduct(page, { name, type: "Insurance", partner: "QA General", category: "QA Motor", bills: "Per pay mode until the premium paying term ends", payModes: ["Yearly"] });
  await page.waitForURL(/\/settings\/products\/c/);
  expect((await db.product.findFirstOrThrow({ where: { name } })).category).toBe("QA Motor");
  const c = await db.customer.findFirstOrThrow({ where: { name: "Meena R" } });
  await page.goto(`/quotations/new?customerId=${c.id}`);
  expect(await page.locator("main table tbody tr").first().getByLabel("Product").locator("option").allInnerTexts()).toContain("QA Motor");
});

test("[PROD-11] a blank Category is set from the type", async ({ page, loginAs, db }) => {
  const name = `QA Fund ${stamp()}`;
  await loginAs("admin");
  await addProduct(page, { name, type: "Mutual fund", partner: "QA AMC", category: "", bills: "No bills", payModes: ["Monthly", "One-time"] });
  await page.waitForURL(/\/settings\/products\/c/);
  expect((await db.product.findFirstOrThrow({ where: { name } })).category).toBe("Mutual fund");
});

test("[PROD-12] a Category over 40 characters is refused", async ({ page, loginAs, db }) => {
  const name = `QA Long ${stamp()}`;
  await loginAs("admin");
  await addProduct(page, { name, type: "Insurance", partner: "QA General", category: "X".repeat(41), bills: "Per pay mode until the premium paying term ends", payModes: ["Yearly"] });
  await expect(page.getByText(/at most 40/)).toBeVisible();
  expect(await db.product.count({ where: { name } })).toBe(0);
});

test("[PROD-01] changing a product's bill rule is saved and logged", async ({ page, loginAs, db }) => {
  const p = await db.product.findFirstOrThrow({ where: { name: "Comprehensive", partner: "Star Health" } });
  await loginAs("admin");
  await page.goto(`/settings/products/${p.id}`);
  await page.getByLabel("Bills (invoice rule)").selectOption({ label: "Per pay mode until the premium paying term ends" });
  await page.getByRole("button", { name: /^Save/ }).first().click();
  await expect.poll(async () => (await db.product.findUniqueOrThrow({ where: { id: p.id } })).invoiceRule).toBe("UntilPremiumTerm");
  expect(await db.auditLog.count({ where: { entityId: p.id, action: "Updated" } })).toBeGreaterThan(0);
});

test("[SET-01] a bank account saves without MICR", async ({ page, loginAs, db }) => {
  const acct = `9${stamp()}12`;
  await loginAs("admin");
  await page.goto("/settings/accounts");
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Add bank account" }) });
  await f.getByLabel("Bank", { exact: true }).fill("QA Bank");
  await f.getByLabel("Branch").fill("QA Branch");
  await f.getByLabel("Account number").fill(acct);
  await f.getByLabel("Account type").selectOption({ label: "Savings" });
  await f.getByLabel("IFSC").fill("QABK0001234");
  await f.getByLabel("Opening balance today (₹)").fill("0");
  await f.getByRole("button", { name: "Add bank account" }).click();
  await expect.poll(() => db.account.count({ where: { bankName: "QA Bank", last4: acct.slice(-4) } })).toBe(1);
});

test("[SET-02] a typed MICR must be 9 digits", async ({ page, loginAs, db }) => {
  await loginAs("admin");
  await page.goto("/settings/accounts");
  const f = page.locator("form").filter({ has: page.getByRole("button", { name: "Add bank account" }) });
  await f.getByLabel("Bank", { exact: true }).fill("QA Bank MICR");
  await f.getByLabel("Branch").fill("QA Branch");
  await f.getByLabel("Account number").fill(`8${stamp()}34`);
  await f.getByLabel("Account type").selectOption({ label: "Savings" });
  await f.getByLabel("IFSC").fill("QABK0001234");
  await f.getByLabel("MICR code (optional)").fill("12345");
  await f.getByRole("button", { name: "Add bank account" }).click();
  await expect(page.getByText(/MICR/).last()).toBeVisible();
  expect(await db.account.count({ where: { bankName: "QA Bank MICR" } })).toBe(0);
});

test("[SET-05][SET-07] add an own pay mode, see it on receipts, then delete it", async ({ page, loginAs, db }) => {
  await loginAs("admin");
  await page.goto("/settings/payment-modes");
  await page.getByLabel("Name").fill("QA PhonePe");
  await page.getByLabel("Works like").selectOption({ label: "UPI" });
  await page.getByRole("button", { name: "Add pay mode" }).click();
  await expect(page.getByRole("row").filter({ hasText: "QA PhonePe" })).toBeVisible();
  const c = await db.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
  await page.goto(`/receipts/new?customerId=${c.id}`);
  await expect(page.getByRole("button", { name: "QA PhonePe", exact: true })).toBeVisible();
  await page.goto("/settings/payment-modes");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row").filter({ hasText: "QA PhonePe" }).getByRole("button", { name: /delete/i }).click();
  await expect(page.getByRole("row").filter({ hasText: "QA PhonePe" })).toHaveCount(0);
});

test("[SET-06] a built-in mode switched off is not offered on receipts", async ({ page, loginAs, db }) => {
  await loginAs("admin");
  await page.goto("/settings/payment-modes");
  await page.getByRole("row").filter({ hasText: /^Cheque/ }).getByRole("button", { name: "Switch off" }).click();
  await expect(page.getByRole("row").filter({ hasText: /^Cheque/ }).getByRole("button", { name: /Switch on/ })).toBeVisible();
  const c = await db.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
  await page.goto(`/receipts/new?customerId=${c.id}`);
  await expect(page.getByRole("button", { name: "Cheque", exact: true })).toHaveCount(0);
  await page.goto("/settings/payment-modes");
  await page.getByRole("row").filter({ hasText: /^Cheque/ }).getByRole("button", { name: /Switch on/ }).click();
});

test("[SET-08] Payment modes has no customer bank list", async ({ page, loginAs }) => {
  await loginAs("admin");
  await page.goto("/settings/payment-modes");
  await expect(page.getByText(/Customer banks/i)).toHaveCount(0);
});

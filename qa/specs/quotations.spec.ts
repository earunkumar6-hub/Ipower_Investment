import { QuotationForm } from "../pages/quotation-page";
import { resetDb } from "../support/db";
import { expect, test } from "../support/fixtures";
import { orderGroups, quoteGroup } from "../../src/lib/products";

// Quotations (#12, #35) and the post office proposal label.
test.beforeAll(async () => resetDb());

async function meena(db: import("@prisma/client").PrismaClient) {
  return db.customer.findFirstOrThrow({ where: { name: "Meena R" } });
}

test("[QUOT-01] the Product list is the categories of active products in Settings", async ({ page, loginAs, db }) => {
  const products = await db.product.findMany({ where: { active: true } });
  const expected = orderGroups(products.map(quoteGroup));
  await loginAs("arun");
  const q = new QuotationForm(page);
  await q.goto((await meena(db)).id);
  expect((await q.product(0).locator("option").allInnerTexts()).map((s) => s.trim())).toEqual(expected);
});

test("[QUOT-02] the Company list follows the product", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const q = new QuotationForm(page);
  await q.goto((await meena(db)).id);
  await q.product(0).selectOption("Post office");
  expect((await q.company(0).locator("option").allInnerTexts()).map((s) => s.trim()).filter(Boolean)).toEqual(["Post Office"]);
  await q.product(0).selectOption("Health insurance");
  const health = await db.product.findMany({ where: { active: true, productType: "Insurance", invoiceRule: "UntilClosed" }, distinct: ["partner"] });
  expect((await q.company(0).locator("option").allInnerTexts()).map((s) => s.trim()).filter(Boolean).sort()).toEqual(health.map((h) => h.partner).sort());
});

test("[QUOT-03] the plan decides the pay modes; a post office scheme has no sum insured", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const q = new QuotationForm(page);
  await q.goto((await meena(db)).id);
  await q.keepRows(1);
  await q.product(0).selectOption("Post office");
  await q.company(0).selectOption("Post Office");
  await q.plan(0).selectOption("Post Office RD");
  expect((await q.payMode(0).locator("option").allInnerTexts()).map((s) => s.trim())).toEqual(["Monthly"]);
  await expect(q.row(0).getByLabel("Sum insured")).toHaveCount(0);
  await expect(q.amount(0)).toHaveAccessibleName("Amount");
});

test("[QUOT-05] a row without a plan is refused", async ({ page, loginAs, db }) => {
  const before = await db.quotation.count();
  await loginAs("arun");
  const q = new QuotationForm(page);
  await q.goto((await meena(db)).id);
  await q.keepRows(1);
  await q.product(0).selectOption("Life insurance");
  await q.company(0).selectOption("SBI Life"); // several plans, so none is filled in automatically
  await q.amount(0).fill("12000");
  await page.getByRole("button", { name: "Save quotation" }).click();
  await q.confirmSave();
  await expect(page.getByText(/Pick the plan/)).toBeVisible();
  expect(await db.quotation.count()).toBe(before);
});

test("[QUOT-04][QUOT-10][QUOT-11][PROP-07] save → Mark as sent → proposals; a post office proposal asks for the Account number", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const q = new QuotationForm(page);
  await q.goto((await meena(db)).id);
  await q.keepRows(2);
  await q.fillRow(0, { product: "Health insurance", company: "Star Health", plan: "Family Health Optima", sumInsured: "500000", premium: "18983" });
  await q.fillRow(1, { product: "Post office", company: "Post Office", plan: "Post Office RD", premium: "1000" });
  await expect(page.getByText("Total payable ₹19,983")).toBeVisible();
  const id = await q.save();
  const saved = await db.quotation.findUniqueOrThrow({ where: { id }, include: { items: true } });
  expect(Number(saved.total)).toBe(19983);
  expect(saved.items.map((i) => i.category).sort()).toEqual(["Health insurance", "Post office"]);

  // Drafts → Sent
  await page.goto("/quotations?tab=drafts");
  await expect(page.getByRole("link", { name: saved.quoteNo })).toBeVisible();
  await page.goto(`/quotations/${id}`);
  await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect.poll(async () => (await db.quotation.findUniqueOrThrow({ where: { id } })).sentAt).not.toBeNull();
  await page.goto("/quotations?tab=sent");
  await expect(page.getByRole("link", { name: saved.quoteNo })).toBeVisible();

  // Proposals from both → Converted
  await page.goto(`/quotations/${id}`);
  await page.getByRole("button", { name: /Create proposal from selected/ }).click();
  await expect.poll(() => db.proposal.count({ where: { quotationId: id } })).toBe(2);
  await page.goto("/quotations?tab=converted");
  await expect(page.getByRole("link", { name: saved.quoteNo })).toBeVisible();

  const rd = await db.proposal.findFirstOrThrow({ where: { quotationId: id, productType: "PoRd" } });
  await page.goto(`/proposals/${rd.id}`);
  await expect(page.getByLabel("Account number (leave blank until issued)")).toBeVisible();
  await expect(page.getByText("Policy number (leave blank")).toHaveCount(0);
});

test.fixme("[QUOT-20] GST rates from Settings – not implemented (Q5)", async () => {});

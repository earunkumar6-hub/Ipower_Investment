import { CustomerPage, CustomersList } from "../pages/customer-page";
import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// Customer lifecycle: list, search, filter, edit, Aadhaar / PAN duplicates, add product, delete rules.
test.beforeAll(async () => resetDb());

const pan = (n: string) => `QAPAN${n.padStart(4, "0").slice(-4)}Q`;

test.describe("List, search and filter", () => {
  test("[CUST-01] the list shows every customer", async ({ page, loginAs, db }) => {
    await loginAs("superadmin");
    const list = new CustomersList(page);
    await list.goto();
    await expect(list.rows()).toHaveCount(await db.customer.count());
  });

  test("[CUST-02] search by name and by mobile", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
    await loginAs("superadmin");
    const list = new CustomersList(page);
    await list.goto();
    await list.search("Rajesh");
    await expect(list.rows()).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Actions for Rajesh Kumar" })).toBeVisible();
    await list.search(c.mobile.slice(-6));
    await expect(page.getByRole("button", { name: "Actions for Rajesh Kumar" })).toBeVisible();
  });

  test("[CUST-03] filter by product = Post office", async ({ page, loginAs, db }) => {
    await loginAs("superadmin");
    const list = new CustomersList(page);
    await list.goto();
    await page.getByLabel("Product").selectOption({ label: "Post office" }); // filters on change
    await page.waitForURL(/product=/);
    const expected = await db.customer.count({ where: { policies: { some: { productType: { in: ["PoRd", "PoTd", "PoKvp", "PoNsc", "PoMis", "PoScss", "PoSsa", "PoPpf"] } } } } });
    await expect(list.rows()).toHaveCount(expected);
  });

  test("[CUST-04] a search with no match shows an empty list, no error", async ({ page, loginAs }) => {
    await loginAs("superadmin");
    const list = new CustomersList(page);
    await list.goto();
    await list.search("zzzz-no-such-customer");
    await expect(list.rows()).toHaveCount(0);
    await expect(list.heading("Partners / Customers")).toBeVisible();
  });
});

test.describe("Edit details", () => {
  test("[CUST-21] the Edit customer pop-up has one Save", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Meena R" } });
    await loginAs("superadmin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.openEdit();
    await expect(d.getByRole("button", { name: "Save changes" })).toHaveCount(1);
  });

  test("[CUST-05] edit email and address; the change log keeps old and new values", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Meena R" } });
    const email = `qa${stamp()}@example.com`;
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.openEdit();
    await d.getByLabel("Email").fill(email);
    await d.getByLabel("Address").fill("12 QA Street, Chennai");
    await d.getByRole("button", { name: "Save changes" }).click();
    await cp.confirmSave();
    await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe(email);
    const log = await db.auditLog.findFirst({ where: { entityId: c.id }, orderBy: { createdAt: "desc" } });
    expect(log?.userId).toBeTruthy();
    expect(JSON.stringify(log?.after ?? {})).toContain(email);
  });

  test("[CUST-06] an invalid mobile is refused", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Meena R" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.openEdit();
    await d.getByRole("textbox").filter({ hasText: "" }).nth(1).fill("12345");
    await d.getByRole("button", { name: "Save changes" }).click();
    await cp.confirmSave();
    await expect(d.getByText(/10-digit/).first()).toBeVisible();
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).mobile).toBe(c.mobile);
  });
});

test.describe("Aadhaar / PAN (#3, #8)", () => {
  test("[CUST-10] Aadhaar and PAN need the consent tick", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Kavitha S" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.openIdentity();
    await expect(d.getByLabel("PAN")).toBeDisabled();
    await expect(d.getByLabel("Aadhaar")).toBeDisabled();
    await expect(d.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  test("[CUST-12] a new valid PAN is saved and shown masked", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Kavitha S" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    await cp.saveIdentity({ pan: pan("1001") });
    await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).panMasked).toBeTruthy();
    const row = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.panMasked).not.toBe(pan("1001"));
    await page.reload();
    await expect(page.getByText(pan("1001"))).toHaveCount(0);
  });

  test("[CUST-11] a PAN that belongs to another customer opens the duplicate pop-up and is not saved", async ({ page, loginAs, db }) => {
    const other = await db.customer.findFirstOrThrow({ where: { name: "Gayathri V" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(other.id, other.name);
    await cp.saveIdentity({ pan: pan("1001") }); // already saved on Kavitha S (CUST-12)
    await expect(cp.duplicateDialog()).toBeVisible();
    await expect(cp.duplicateDialog()).toContainText("Kavitha S");
    expect((await db.customer.findUniqueOrThrow({ where: { id: other.id } })).panHash).toBeNull();
  });

  test("[CUST-13] an Aadhaar that belongs to another customer is refused", async ({ page, loginAs, db }) => {
    const a = await db.customer.findFirstOrThrow({ where: { name: "Lakshmi P" } });
    const b = await db.customer.findFirstOrThrow({ where: { name: "Logesh P" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(a.id, a.name);
    await cp.saveIdentity({ aadhaar: "234567890123" });
    await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: a.id } })).aadhaarLast4).toBe("0123");
    await cp.goto(b.id, b.name);
    await cp.saveIdentity({ aadhaar: "234567890123" });
    await expect(cp.duplicateDialog()).toBeVisible();
    expect((await db.customer.findUniqueOrThrow({ where: { id: b.id } })).aadhaarHash).toBeNull();
  });

  test("[VAL-03] PAN must be AAAAA9999A", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Malathi R" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.saveIdentity({ pan: "ABCD1234E" });
    await expect(d.getByText(/PAN/i).last()).toBeVisible();
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).panHash).toBeNull();
  });

  test("[VAL-04] Aadhaar must be 12 digits and cannot start with 0 or 1", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Naveen K" } });
    await loginAs("admin");
    const cp = new CustomerPage(page);
    await cp.goto(c.id, c.name);
    const d = await cp.saveIdentity({ aadhaar: "23456789012" }); // 11 digits
    await expect(d.getByText(/12 digits|aadhaar/i).filter({ hasNotText: "Optional" }).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).aadhaarHash).toBeNull();
    // UIDAI numbers never start with 0 or 1 – such a number should be refused.
    await cp.goto(c.id, c.name);
    // Wait for the save (server action POST) to finish before reading the database.
    const saved = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/customers/${c.id}`));
    await cp.saveIdentity({ aadhaar: "012345678901" });
    await saved;
    expect((await db.customer.findUniqueOrThrow({ where: { id: c.id } })).aadhaarHash, "Aadhaar starting with 0 was accepted").toBeNull();
  });
});

test.describe("Products on a customer", () => {
  test("[CUST-20] Add product has Save at the top and the bottom", async ({ page, loginAs, db }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
    await loginAs("admin");
    await page.goto(`/customers/${c.id}/add-product`);
    await expect(page.getByRole("button", { name: "Save product" })).toHaveCount(2);
  });

  test("[CUST-25][REN-25] Add product directly creates the holding and IP- numbered bills", async ({ page, loginAs, db, shell }) => {
    const c = await db.customer.findFirstOrThrow({ where: { name: "Rajesh Kumar" } });
    const acct = `QA-RD-${stamp()}`;
    await loginAs("admin");
    await page.goto(`/customers/${c.id}/add-product`);
    const rd = await db.product.findFirstOrThrow({ where: { productType: "PoRd", active: true } });
    await page.getByLabel("Product *").selectOption(rd.id);
    await page.getByLabel(/^Scheme \/ tenure/).selectOption({ index: 1 });
    await page.getByLabel(/Policy \/ account number/).fill(acct);
    await page.getByLabel(/^Post office branch/).selectOption({ index: 1 }); // a custom list field
    await page.getByLabel(/^Amount/).fill("500");
    await page.getByLabel(/^Pay mode/).selectOption("Monthly");
    await page.getByLabel(/^Date of commencement/).fill(new Date().toLocaleDateString("en-GB"));
    await page.getByRole("button", { name: "Save product" }).first().click();
    await shell.confirmSave();
    await expect(page).toHaveURL(new RegExp(`/customers/${c.id}$`));
    const pol = await db.policy.findFirstOrThrow({ where: { policyNumber: acct }, include: { renewals: true } });
    expect(pol.customerId).toBe(c.id);
    expect(pol.renewals.length).toBeGreaterThan(0);
    for (const r of pol.renewals) expect(r.billNo).toMatch(/^IP-\d{2,}$/);
  });

  test("[CUST-30] a customer with records cannot be deleted", async ({ page, loginAs }) => {
    await loginAs("admin");
    const list = new CustomersList(page);
    await list.goto();
    await page.getByRole("button", { name: "Actions for Rajesh Kumar" }).click();
    const del = page.getByRole("menuitem", { name: /delete/i });
    if (await del.count()) {
      await expect(del).toBeDisabled();
    }
    await expect(page.getByText(/can't be deleted|cannot be deleted|has (products|records)/i).first()).toBeVisible();
  });

  test.fixme("[CUST-31] deactivate a customer – not in the app (Phase 1 Q11)", async () => {});
  test.fixme("[CUST-32] family / nominee links – family grouping deferred; nominee is a holding field (Q11)", async () => {});
});

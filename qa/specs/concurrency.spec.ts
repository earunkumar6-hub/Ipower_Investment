import { CustomerPage } from "../pages/customer-page";
import { LeadsPage } from "../pages/leads-page";
import { ReceiptForm } from "../pages/receipt-page";
import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// LAN simulation: several signed-in browsers (staff PCs) acting on the same records at the same time.
test.beforeAll(async () => resetDb());

test("[CONC-01] two users editing the same customer: the second is told who is editing and cannot save; nothing is overwritten", async ({ page, loginAs, otherUser, db, shell }) => {
  const c = await db.customer.findFirstOrThrow({ where: { name: "Hari Prasad" } });
  await loginAs("admin");
  const arun = await otherUser("arun");
  const a = new CustomerPage(page), b = new CustomerPage(arun);
  await a.goto(c.id, c.name);
  await b.goto(c.id, c.name);
  const da = await a.openEdit(); // Admin takes the "editing" ticket
  const db2 = await b.openEdit(); // Arun opens while Admin is editing
  await expect(db2.getByRole("alert")).toContainText(/R\. Murali is editing this customer/);
  await expect(db2.getByRole("button", { name: "Save changes" })).toBeDisabled();
  await expect(db2.getByLabel("Address")).toBeDisabled();
  await expect(db2.getByRole("button", { name: "Take over editing" })).toHaveCount(0); // a User cannot take over

  await da.getByLabel("Email").fill("first.save@example.com");
  await da.getByRole("button", { name: "Save changes" }).click();
  await shell.confirmSave();
  await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe("first.save@example.com");

  // Arun reopens: now free, sees Admin's email, and his own change keeps it.
  await arun.keyboard.press("Escape");
  const db3 = await b.openEdit();
  await expect(db3.getByRole("alert")).toHaveCount(0);
  await expect(db3.getByLabel("Email")).toHaveValue("first.save@example.com");
  await db3.getByLabel("Address").fill("Second save, fresh form");
  await db3.getByRole("button", { name: "Save changes" }).click();
  await new CustomerPage(arun).confirmSave();
  await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).address).toBe("Second save, fresh form");
  const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(after.email, "first user's email must survive").toBe("first.save@example.com");
});

test("[CONC-04] an expired ticket: a stale form is still refused by the version check, nothing is lost", async ({ page, loginAs, otherUser, db, shell }) => {
  const c = await db.customer.findFirstOrThrow({ where: { name: "Kavitha S" } });
  await loginAs("admin");
  const arun = await otherUser("arun");
  const a = new CustomerPage(page), b = new CustomerPage(arun);
  await a.goto(c.id, c.name);
  await b.goto(c.id, c.name);
  const db2 = await b.openEdit(); // Arun takes the ticket and keeps his form open …
  await expect.poll(() => db.customerEditLock.count({ where: { customerId: c.id } })).toBe(1);
  await db.customerEditLock.update({ where: { customerId: c.id }, data: { expiresAt: new Date(Date.now() - 1000) } }); // … until it runs out
  const da = await a.openEdit(); // Admin can now take it
  await expect(da.getByRole("alert")).toHaveCount(0);
  await da.getByLabel("Email").fill("admin.wins@example.com");
  await da.getByRole("button", { name: "Save changes" }).click();
  await shell.confirmSave();
  await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe("admin.wins@example.com");

  await db2.getByLabel("Address").fill("Stale form address");
  await db2.getByRole("button", { name: "Save changes" }).click();
  await new CustomerPage(arun).confirmSave();
  await expect(db2.getByText(/was just changed by/)).toBeVisible();
  const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  expect(after.email).toBe("admin.wins@example.com");
  expect(after.address).not.toBe("Stale form address");
});

test("[CONC-05] leaving the page with Edit details open gives the editing ticket back at once", async ({ page, loginAs, db }) => {
  const c = await db.customer.findFirstOrThrow({ where: { name: "Logesh P" } });
  await loginAs("arun");
  const cp = new CustomerPage(page);
  await cp.goto(c.id, c.name);
  await cp.openEdit();
  await expect.poll(() => db.customerEditLock.count({ where: { customerId: c.id } })).toBe(1);
  await page.goto("/dashboard"); // leave without Cancel or Save
  await expect.poll(() => db.customerEditLock.count({ where: { customerId: c.id } }), { timeout: 10_000 }).toBe(0);
});

test("[CONC-02] two users take a receipt for the same bill at once: the bill is paid once", async ({ page, loginAs, otherUser, db }) => {
  const c = await db.customer.findFirstOrThrow({ where: { name: "Indira G" } });
  await loginAs("arun");
  const divya = await otherUser("divya");
  const fa = new ReceiptForm(page), fb = new ReceiptForm(divya);
  await fa.gotoCustomer(c.id);
  await fb.gotoCustomer(c.id);
  const label = await fa.dueBoxes().first().getAttribute("aria-label");
  await fa.dueBoxes().first().check();
  await fb.page.getByRole("checkbox", { name: label! }).check();
  const amt = await fa.amountValue();
  await fa.payCash(amt);
  await fb.payCash(amt);
  const before = await db.receipt.count({ where: { customerId: c.id, status: "Saved" } });
  await Promise.all([fa.save().click(), fb.save().click()]);
  await page.waitForLoadState("networkidle");
  await divya.waitForLoadState("networkidle");
  await expect.poll(() => db.receipt.count({ where: { customerId: c.id, status: "Saved" } }), { timeout: 20_000 }).toBeGreaterThan(before);
  await page.waitForTimeout(0);
  const made = await db.receipt.count({ where: { customerId: c.id, status: "Saved" } }) - before;
  const fresh = await db.receipt.findMany({ where: { customerId: c.id, status: "Saved" }, orderBy: { createdAt: "desc" }, take: made, select: { receiptNo: true, amount: true, policyId: true } });
  test.info().annotations.push({ type: "result", description: `${made} receipt(s) for "${label}": ${fresh.map((r) => `${r.receiptNo} ₹${r.amount}`).join(", ")}` });
  expect(made, "both receipts were saved for the same bill").toBe(1);
});

test("[CONC-03] leads created at the same time get distinct RR numbers", async ({ page, loginAs, otherUser, db }) => {
  await loginAs("arun");
  const others = [await otherUser("divya"), await otherUser("admin")];
  const pages = [page, ...others];
  const tag = stamp();
  await Promise.all(pages.map((p, i) => new LeadsPage(p).addLead({ first: `QA Conc${i}`, last: tag, mobile: `9${tag}${i}0${i}0`.slice(0, 10) })));
  await expect.poll(() => db.lead.count({ where: { lastName: tag } }), { timeout: 30_000 }).toBe(pages.length);
  const nos = (await db.lead.findMany({ where: { lastName: tag }, select: { leadNo: true } })).map((l) => l.leadNo);
  expect(new Set(nos).size).toBe(nos.length);
  for (const n of nos) expect(n).toMatch(/^RR-\d{2,}$/);
});

import { CustomerPage } from "../pages/customer-page";
import { LeadsPage } from "../pages/leads-page";
import { ReceiptForm } from "../pages/receipt-page";
import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// LAN simulation: several signed-in browsers (staff PCs) acting on the same records at the same time.
test.beforeAll(async () => resetDb());

test("[CONC-01] two users editing the same customer: the second save must not silently overwrite the first", async ({ page, loginAs, otherUser, db, shell }) => {
  const c = await db.customer.findFirstOrThrow({ where: { name: "Hari Prasad" } });
  await loginAs("admin");
  const arun = await otherUser("arun");
  const a = new CustomerPage(page), b = new CustomerPage(arun);
  await a.goto(c.id, c.name);
  await b.goto(c.id, c.name);
  const da = await a.openEdit(), db2 = await b.openEdit(); // both read the same version
  await da.getByLabel("Email").fill("first.save@example.com");
  await da.getByRole("button", { name: "Save changes" }).click();
  await shell.confirmSave();
  await expect.poll(async () => (await db.customer.findUniqueOrThrow({ where: { id: c.id } })).email).toBe("first.save@example.com");

  await db2.getByLabel("Address").fill("Second save, stale form");
  await db2.getByRole("button", { name: "Save changes" }).click();
  const secondSave = arun.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/customers/${c.id}`));
  await new CustomerPage(arun).confirmSave();
  await secondSave; // the stale form really was submitted
  const after = await db.customer.findUniqueOrThrow({ where: { id: c.id } });
  test.info().annotations.push({ type: "result", description: `email=${after.email ?? "∅"} address=${after.address ?? "∅"}` });
  const warned = await arun.getByText(/changed by|someone else|reload|out of date|was updated/i).count();
  // Pass only if the stale save was refused / warned, or it kept the first user's email.
  expect(warned > 0 || after.email === "first.save@example.com", `stale form overwrote email with "${after.email}"`).toBe(true);
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

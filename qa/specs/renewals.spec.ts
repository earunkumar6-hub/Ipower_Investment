import { RenewalsPage, sheetRows } from "../pages/renewals-page";
import { resetDb } from "../support/db";
import { expect, test } from "../support/fixtures";

// Renewals: view / dates, Maturity tab, reminders + Sent messages, deactivate / delete, Excel download.
test.beforeAll(async () => resetDb());

const dmy = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;

test("[REN-01] View offers the agreed quick picks", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto();
  const options = (await r.view().locator("option").allInnerTexts()).map((s) => s.trim());
  for (const o of ["Today", "This week", "This month", "Next 30 days", "Next 3 months", "Last month", "Custom dates"]) expect(options).toContain(o);
});

test("[REN-02] a custom one-day range shows only bills due that day", async ({ page, loginAs, db }) => {
  const item = await db.renewalItem.findFirstOrThrow({ where: { status: "Due", policy: { status: "Active" } }, orderBy: { dueDate: "asc" }, include: { policy: true } });
  const day = dmy(item.dueDate);
  const expected = await db.renewalItem.count({ where: { status: "Due", dueDate: item.dueDate, policy: { status: "Active" } } });
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto();
  await r.setRange(day, day);
  await expect(r.bodyRows()).toHaveCount(expected);
  for (const cell of await r.bodyRows().locator("td:nth-child(4)").allInnerTexts()) expect(cell).toContain(day);
});

test("[REN-05] Maturity is its own tab; maturities are not on Due", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=maturity&range=next3m");
  await expect(r.tab("Maturity")).toBeVisible();
  const maturityPolicies = (await r.bodyRows().locator("td:nth-child(3)").allInnerTexts()).map((s) => s.trim()).filter(Boolean);
  expect(maturityPolicies.length).toBeGreaterThan(0);
  await r.goto("?tab=due&range=next3m");
  const dueText = await r.bodyRows().allInnerTexts();
  for (const p of maturityPolicies) expect(dueText.join("\n"), `${p} also on Due`).not.toContain(p);
});

test("[REN-10][MSG-01] Send reminder is counted and logged in Sent messages", async ({ page, loginAs, db, shell }) => {
  await loginAs("arun");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  const row = r.bodyRows().filter({ has: page.getByRole("button", { name: "Send reminder" }) }).first();
  const policyNo = (await row.locator("td:nth-child(3)").innerText()).trim();
  const customer = (await row.locator("td:nth-child(1)").innerText()).trim();
  const before = await db.messageLog.count();
  await row.getByRole("button", { name: "Send reminder" }).click();
  await expect(r.rowFor(policyNo).getByRole("button", { name: /^1/ })).toBeVisible();
  await expect.poll(() => db.messageLog.count()).toBe(before + 1);
  const msg = await db.messageLog.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  expect(msg.status).toBe("Sent (mock)");
  expect(msg.body).toContain(customer.split(" ")[0]);
  expect(msg.createdById).toBeTruthy();

  await shell.open("/messages", "Sent messages");
  await expect(page.locator("tbody tr").first()).toContainText(/WhatsApp/);
  await expect(page.locator("tbody tr").first()).toContainText(customer.split(" ")[0]);
});

test("[REN-11] the reminder count opens the full history", async ({ page, loginAs }) => {
  await loginAs("arun");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  await r.bodyRows().getByRole("button", { name: /^1/ }).first().click();
  const d = page.getByRole("dialog").filter({ hasText: "Reminders sent" });
  await expect(d).toBeVisible();
  await expect(d).toContainText(/WhatsApp/);
  await expect(d).toContainText("Arun");
});

test("[REN-13] Deactivate needs a reason", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  await r.bodyRows().getByRole("button", { name: "Deactivate" }).first().click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Deactivate" }).click();
  await expect(d.getByText(/reason/i).last()).toBeVisible();
  await expect(d).toBeVisible();
});

test("[REN-14] an Admin gets Deactivate but no Delete", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  await expect(r.bodyRows().getByRole("button", { name: "Deactivate / delete" })).toHaveCount(0);
  await r.bodyRows().getByRole("button", { name: "Deactivate" }).first().click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Delete product" })).toHaveCount(0);
});

test("[REN-12] Deactivate stops the product's unpaid bills", async ({ page, loginAs, db }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  const row = r.bodyRows().filter({ has: page.getByRole("button", { name: "Deactivate" }) }).last();
  const policyNo = (await row.locator("td:nth-child(3)").innerText()).trim();
  await row.getByRole("button", { name: "Deactivate" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Reason").fill("QA – customer asked to stop");
  await d.getByRole("button", { name: "Deactivate" }).click();
  await expect(d).toBeHidden();
  const pol = await db.policy.findFirstOrThrow({ where: { policyNumber: policyNo }, include: { renewals: true } });
  expect(pol.status).toBe("Deactivated");
  expect(pol.renewals.filter((x) => x.status === "Due" || x.status === "Overdue")).toHaveLength(0);
  expect(await db.auditLog.count({ where: { entityId: pol.id } })).toBeGreaterThan(0);
  await expect(r.rowFor(policyNo)).toHaveCount(0);
});

test("[REN-20] Download offers only the current tab", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto();
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByRole("menuitem")).toHaveCount(2);
  await expect(page.getByText(/This tab – Due/)).toBeVisible();
});

test("[REN-21] Due Excel has the agreed 9 columns, '25 Oct 2026' dates, ₹ amounts and the screen's rows", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  const screenPolicies = (await r.bodyRows().locator("td:nth-child(3)").allInnerTexts()).map((s) => s.trim());
  const ws = await r.downloadExcel();
  const { header, rows } = sheetRows(ws);
  expect(header).toEqual(["Customer", "Phone", "Product", "Policy / account", "Due", "Amount", "Status", "Reminders sent", "Last reminder"]);
  expect(rows.map((x) => String(x.getCell(4).value))).toEqual(screenPolicies);
  expect(ws.getColumn(5).numFmt).toBe("dd mmm yyyy");
  expect(ws.getColumn(6).numFmt).toContain("₹");
  for (const x of rows) expect(String(x.getCell(2).value)).toMatch(/^\d{2}x+\d{2}$/); // masked phone
});

test("[REN-22] Paid tab Excel columns (documented – Q6)", async ({ page, loginAs }) => {
  await loginAs("admin");
  const r = new RenewalsPage(page);
  await r.goto("?tab=paid&range=month");
  const { header } = sheetRows(await r.downloadExcel());
  test.info().annotations.push({ type: "columns", description: header.join(" | ") });
  expect(header.slice(0, 7)).toEqual(["Customer", "Phone", "Product", "Policy / account", "Due", "Amount", "Status"]);
});

test.fixme("[MSG-02] provider failure and retry – the provider is a mock; no failure / retry state (Q13)", async () => {});

import { TicketsPage } from "../pages/tickets-page";
import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// Tickets: required fields and who sees what (the full raise → update → see flow is journey J2).
test.beforeAll(async () => resetDb());

test("[TKT-02] a ticket needs a title and details", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const before = await db.ticket.count();
  await page.goto("/tickets/new");
  await page.getByRole("button", { name: "Raise ticket" }).click();
  await expect(page).toHaveURL(/\/tickets\/new/);
  expect(await db.ticket.count()).toBe(before);
});

test("[TKT-04] a User sees only their own tickets", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const t = new TicketsPage(page);
  const title = `QA own ticket ${stamp()}`;
  await t.raise({ title, screen: "Receipts", type: "Question", priority: /^Low/, details: "Visibility check" });
  await expect.poll(() => db.ticket.count({ where: { title } })).toBe(1);
  const divya = await (await import("../support/fixtures")).newSignedInPage(page.context().browser()!, "divya");
  await divya.goto("/tickets");
  await expect(divya.getByText(title)).toHaveCount(0);
  await divya.context().close();
});

import { resetDb, userId } from "../support/db";
import { expect, test } from "../support/fixtures";

// Follow-ups and call reminders: overdue, due today, completed, outcome rules. The overdue call is kept (quietCalls: false).
test.beforeAll(async () => resetDb({ quietCalls: false }));

const reminder = (page: import("@playwright/test").Page) => page.getByRole("dialog").filter({ has: page.getByRole("radio", { name: "Interested" }) });

test("[FUP-01] an overdue call shows as Overdue and pops up for its owner", async ({ page, loginAs, db }) => {
  const overdue = await db.call.findFirstOrThrow({ where: { outcome: null, ownerId: await userId("arun"), dueAt: { lt: new Date() } } });
  await loginAs("arun");
  await expect(reminder(page)).toBeVisible(); // pops up on any screen
  expect(overdue).toBeTruthy();
  await page.goto("/followups");
  await expect(page.getByRole("cell", { name: /^Overdue/ }).first()).toBeVisible();
});

test("[FUP-04] No answer needs a new call time", async ({ page, loginAs }) => {
  await loginAs("arun");
  const d = reminder(page);
  await expect(d).toBeVisible();
  await d.getByRole("radio", { name: "No answer / call back" }).check();
  const next = d.getByRole("textbox", { name: /Reschedule call to|Next call/ });
  await next.fill("");
  await d.getByRole("button", { name: /Save/ }).click();
  await expect(d).toBeVisible();
});

test("[FUP-03] completing a call closes it", async ({ page, loginAs, db }) => {
  const arun = await userId("arun");
  const before = await db.call.count({ where: { outcome: null, ownerId: arun, dueAt: { lt: new Date() } } });
  await loginAs("arun");
  const d = reminder(page);
  await expect(d).toBeVisible();
  await d.getByLabel("Notes").fill("QA – spoke, interested");
  await d.getByRole("radio", { name: "Interested", exact: true }).check();
  await d.getByRole("button", { name: /^Save/ }).click();
  await expect.poll(() => db.call.count({ where: { outcome: null, ownerId: arun, dueAt: { lt: new Date() } } })).toBe(before - 1);
});

test("[FUP-02] a call scheduled for today is listed as due", async ({ page, loginAs, db }) => {
  // Move Arun's other open calls ahead so their reminder pop-up does not cover the page.
  await db.call.updateMany({ where: { outcome: null, ownerId: await userId("arun") }, data: { dueAt: new Date(Date.now() + 3 * 86_400_000) } });
  await loginAs("arun");
  await page.goto("/followups");
  await page.getByRole("button", { name: "Schedule call" }).click();
  const d = page.getByRole("dialog").filter({ hasText: "Schedule call" });
  await d.getByRole("radio", { name: "Lead" }).check();
  await d.getByRole("combobox", { name: "Lead" }).selectOption({ index: 1 });
  const later = new Date(Date.now() + 2 * 3600_000);
  await d.getByRole("textbox", { name: "Date" }).fill(new Date().toLocaleDateString("en-GB"));
  await d.getByLabel("Time").fill(`${String(later.getHours()).padStart(2, "0")}:${String(later.getMinutes()).padStart(2, "0")}`);
  await d.getByRole("textbox", { name: "Note" }).fill("QA call today");
  await d.getByRole("button", { name: /Schedule|Save/ }).last().click();
  await expect(d).toBeHidden();
  await expect.poll(() => db.call.count({ where: { note: "QA call today", outcome: null } })).toBe(1);
  await page.reload();
  await page.getByRole("link", { name: /^Due later today \(/ }).click();
  await expect(page.getByRole("row").filter({ hasText: "QA call today" })).toBeVisible();
});

test.fixme("[FUP-05] reassign a follow-up to another employee – not in the app (Q12)", async () => {});

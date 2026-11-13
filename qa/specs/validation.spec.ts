import { LeadsPage } from "../pages/leads-page";
import { resetDb } from "../support/db";
import { expect, stamp, test } from "../support/fixtures";

// Indian data validation (mobile, dates, rupee grouping) and form accessibility.
test.beforeAll(async () => resetDb());

const mobile = () => `9${stamp()}${String(Math.floor(Math.random() * 1000)).padStart(3, "0")}`;

test("[VAL-01] a lead mobile must be exactly 10 digits", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const leads = new LeadsPage(page);
  await leads.goto();
  // 9 digits: refused with a message.
  const d = await leads.addLead({ first: "QA Val9", mobile: "987654321" });
  await expect(d.getByText(/is not a 10-digit mobile number/).first()).toBeVisible();
  expect(await db.lead.count({ where: { firstName: "QA Val9" } })).toBe(0);
  // 11 digits: the box takes at most 10 characters.
  const box = d.getByLabel("Mobile number 1");
  await box.fill("");
  await box.pressSequentially("98765432101");
  expect((await box.inputValue()).length).toBe(10);
});

test("[VAL-02] a mobile must start with 6, 7, 8 or 9", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const leads = new LeadsPage(page);
  await leads.goto();
  const d = await leads.addLead({ first: "QA Val5", mobile: "5123456789" });
  await expect(d.getByText(/is not a 10-digit mobile number/).first()).toBeVisible();
  expect(await db.lead.count({ where: { firstName: "QA Val5" } })).toBe(0);
});

test("[VAL-06] dates are shown dd/mm/yyyy", async ({ page, loginAs }) => {
  await loginAs("admin");
  await page.goto("/receipts");
  const cells = await page.locator("tbody tr td:nth-child(3)").allInnerTexts();
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells.slice(0, 10)) expect(c.trim()).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
});

test("[VAL-07] an impossible date is not accepted", async ({ page, loginAs }) => {
  await loginAs("admin");
  await page.goto("/renewals");
  const from = page.getByLabel("From date");
  await from.fill("31/02/2026");
  await page.getByRole("button", { name: "Show renewals" }).click();
  await expect(page).not.toHaveURL(/from=2026-02-31/);
  const valid = await from.evaluate((el: HTMLInputElement) => el.validity.valid);
  expect(valid).toBe(false);
});

test("[VAL-08] rupee amounts use lakh grouping", async ({ page, loginAs }) => {
  await loginAs("superadmin");
  await page.goto("/dashboard");
  const text = await page.locator("main").innerText();
  const big = text.match(/₹\d{1,2}(,\d{2})+,\d{3}/g) ?? [];
  expect(big.length, "at least one amount ≥ ₹1,00,000 on the dashboard").toBeGreaterThan(0);
  expect(text).not.toMatch(/₹\d{3},\d{3}\b/); // western grouping like ₹127,520
});

test("[A11Y-01] form fields have accessible names (Raise ticket, Add expense)", async ({ page, loginAs }) => {
  await loginAs("admin");
  const unnamed: string[] = [];
  for (const path of ["/tickets/new", "/expenses"]) {
    await page.goto(path);
    const fields = page.locator("main form").first().locator("input:not([type=hidden]):not([type=file]):not([aria-hidden=true]), select, textarea");
    for (const f of await fields.all()) {
      const name = await f.evaluate((el) => (el as HTMLInputElement).labels?.length || el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") ? "ok" : (el as HTMLInputElement).name);
      if (name !== "ok") unnamed.push(`${path}: ${name || (await f.evaluate((el) => el.outerHTML.slice(0, 160)))}`);
    }
  }
  expect(unnamed, `fields without a label: ${unnamed.join(", ")}`).toEqual([]);
});

test.fixme("[VAL-05] PIN code – no PIN field in the app (Q15)", async () => {});

test("[LEAD-05] a new lead is numbered RR-nn", async ({ page, loginAs, db }) => {
  await loginAs("arun");
  const leads = new LeadsPage(page);
  await leads.goto();
  const m = mobile();
  await leads.addLead({ first: "QA Number", last: stamp(), mobile: m });
  await expect.poll(() => db.lead.count({ where: { mobile: m } })).toBe(1);
  expect((await db.lead.findFirstOrThrow({ where: { mobile: m } })).leadNo).toMatch(/^RR-\d{2,}$/);
});

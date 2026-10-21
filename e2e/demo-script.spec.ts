// fl_crm_demo.json → demo_script, steps 1–11, with three people signed in at the same time
// (Arun in "Chrome", R. Murali in "Incognito", the Owner in "Edge" → three separate browser contexts).
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const rupees = (text: string) => Number(text.replace(/[^\d.]/g, ""));
/** Fill a cash denomination grid (ids `<prefix>-500`, `<prefix>-coins`) with ₹500 notes and the rest in coins. */
async function fillCash(page: Page, prefix: string, amount: number) {
  await page.locator(`#${prefix}-500`).fill(String(Math.floor(amount / 500)));
  await page.locator(`#${prefix}-coins`).fill(String(amount % 500));
}

async function signIn(browser: Browser, username: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo1234");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  return { context, page };
}

test.describe.serial("Demo script – three roles on the same data", () => {
  let contexts: BrowserContext[] = [];
  let arun: Page, admin: Page, owner: Page;

  test.beforeAll(async ({ browser }) => {
    const sessions = await Promise.all([signIn(browser, "arun"), signIn(browser, "admin"), signIn(browser, "superadmin")]);
    contexts = sessions.map((s) => s.context);
    [arun, admin, owner] = sessions.map((s) => s.page);
  });

  test.afterAll(async () => {
    await Promise.all(contexts.map((c) => c.close()));
  });

  test("1. Arun: call reminder for the overdue lead blocks the screen; save Interested + new time", async () => {
    const reminder = arun.getByRole("dialog");
    await expect(reminder.getByText(/Call reminder · (overdue|due now)/)).toBeVisible();
    await expect(reminder.getByText("Revathi M")).toBeVisible();
    await arun.keyboard.press("Escape");
    await expect(reminder).toBeVisible(); // can't be dismissed without an outcome
    await reminder.getByRole("radio", { name: "Interested", exact: true }).check();
    // Interested: the next call is optional; book one for tomorrow 11:00.
    const tomorrow = new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
    await reminder.getByLabel("Next call (optional)").fill(tomorrow);
    await reminder.getByLabel("Time").fill("11:00");
    await reminder.getByRole("button", { name: "Save", exact: true }).click();
    await expect(reminder).toBeHidden();
    // Revathi's new call, Priya's call later today and Gopinath's call tomorrow
    await expect(arun.getByRole("button", { name: "3 calls open" })).toBeVisible();
  });

  test("2. Quotation for Meena R: two products + 18% GST, export PDF, customer accepts one product", async () => {
    await arun.goto("/quotations/new?q=Meena");
    await arun.getByRole("link", { name: /Meena R/ }).click();
    const [insurer, plan, premium] = [arun.getByLabel("Insurer"), arun.getByLabel("Plan"), arun.getByLabel("Premium")];
    await insurer.nth(0).fill("Star Health");
    await plan.nth(0).fill("Family Health Optima");
    await premium.nth(0).fill("18983");
    await insurer.nth(1).fill("SBI Life");
    await plan.nth(1).fill("eShield Next");
    await premium.nth(1).fill("10500");
    await expect(arun.getByText("₹34,789.94")).toBeVisible(); // live total incl. GST
    await arun.getByRole("button", { name: "Save quotation" }).click();
    await expect(arun.getByText("Check before saving")).toBeVisible();
    await arun.getByRole("button", { name: "Yes, save" }).click();
    await arun.waitForURL(/\/quotations\/c/);
    await expect(arun.getByRole("heading", { name: /Quotation Q-\d+ · Meena R/ })).toBeVisible();

    const download = arun.waitForEvent("download");
    await arun.getByRole("link", { name: "Export PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(/^Q-\d+\.pdf$/);

    // The customer takes the Star Health plan only: untick SBI Life, then create the proposal.
    await arun.getByLabel("Select SBI Life – eShield Next").uncheck();
    await arun.getByRole("button", { name: "Create proposal from selected (1)" }).click();
    await expect(arun.getByText("Accepted", { exact: true }).first()).toBeVisible();
    await expect(arun.getByText("Not accepted").first()).toBeVisible();
  });

  test("3. Proposal: optional PAN stored masked; policy number creates customer + renewal (no OTP consent)", async () => {
    await arun.getByRole("link", { name: /^P-\d+$/ }).first().click();
    await arun.waitForURL(/\/proposals\/c/);
    await arun.getByLabel("PAN").fill("ABCDE1234M");
    await arun.getByRole("button", { name: "Save Aadhaar / PAN" }).click();
    await expect(arun.getByText("ABCxxxxx4M").first()).toBeVisible();
    await expect(arun.getByText("ABCDE1234M")).toHaveCount(0); // full PAN never shown back

    // Pay mode comes from the quotation (Yearly); enter the term and start date.
    await arun.getByLabel("Term (years)").fill("1");
    await arun.getByLabel("Start date").fill(new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10));
    await arun.getByRole("button", { name: "Save details" }).last().click(); // Save is at the top and bottom
    await arun.getByRole("button", { name: "Yes, save" }).click();
    await expect(arun.getByText("Policy details saved")).toBeVisible();
    await arun.getByLabel("Policy number (leave blank until issued)").fill("STAR-P-700123");
    await arun.getByRole("button", { name: "Save policy number" }).click();
    await expect(arun.getByText(/Policy STAR-P-700123 issued and moved to Partners \/ Customers under Meena R/)).toBeVisible();
    await expect(arun.getByText(/Next renewal due/)).toBeVisible();
  });

  test("4. RD cash receipts for Lakshmi P; E-Sevai EB ₹850 collected as ₹860 by UPI", async () => {
    for (let i = 0; i < 2; i++) {
      await arun.goto("/receipts/new?q=Lakshmi");
      await arun.getByRole("link", { name: /Lakshmi P/ }).click();
      // The earliest due (this month's RD instalment) is picked by default.
      const pick = arun.getByRole("combobox", { name: /Instalments for RD 2231-10/ }).first();
      await expect(pick).toHaveValue("1");
      await expect(pick).toContainText("1 · Oct");
      await arun.locator("#note-500").fill("2"); // cash denomination must add up to ₹1,000
      await arun.getByRole("button", { name: "Save receipt" }).click();
      await arun.waitForURL(/\/receipts\/c/);
      await expect(arun.getByText("Collected", { exact: true })).toBeVisible();
    }

    await arun.goto("/esevai");
    await arun.getByLabel("EB amount paid").fill("850");
    await expect(arun.getByText("Provider ₹850 · profit ₹10")).toBeVisible();
    await arun.getByLabel("Collected by").selectOption("UPI");
    await arun.getByLabel("Consumer / reference no.").fill("TNEB-55821");
    await arun.getByRole("button", { name: "Save entry" }).click();
    await expect(arun.getByRole("row", { name: /TNEB-55821.*₹850.*₹860.*₹10.*UPI/ })).toBeVisible();
  });

  test("5. ₹3,200 stationery expense waits for Admin; the same bill number again is refused", async () => {
    await arun.goto("/expenses");
    const fill = async (amount: string, desc: string) => {
      await arun.locator("#description").fill(desc);
      await arun.locator("#amount").fill(amount);
      await arun.locator("#vendor").fill("Sri Stationers");
      await arun.locator("#billNo").fill("B-1045");
      await arun.locator("#notes").fill("Monthly stationery for the counter");
      await fillCash(arun, "note", Number(amount)); // paid from office cash
      await arun.getByRole("button", { name: "Submit" }).click();
    };
    await fill("3200", "Printer paper, pens, files");
    await expect(arun.getByRole("row", { name: /B-1045.*₹3,200.*Waiting – Admin/ })).toBeVisible();
    await fill("1600", "Second half of the same bill");
    await expect(arun.getByText(/Bill B-1045 from Sri Stationers is already entered/)).toBeVisible();
  });

  test("6. R. Murali (Admin, same data, own session): approve ₹3,200; commission column on receipts", async () => {
    await admin.goto("/expenses?tab=approve");
    await expect(admin.getByRole("row", { name: /Laptop/ })).toHaveCount(0); // above ₹5,000: not an Admin's approval
    await admin.getByRole("row", { name: /B-1045/ }).getByRole("button", { name: "Approve" }).click();
    await expect(admin.getByText(/EXP-\d+ approved/)).toBeVisible(); // wait for the server to confirm
    await admin.goto("/expenses");
    await expect(admin.getByRole("row", { name: /B-1045.*Approved – Admin/ })).toBeVisible();

    await admin.goto("/receipts");
    await expect(admin.getByRole("columnheader", { name: "Commission" })).toBeVisible();
    await expect(admin.getByRole("row", { name: /Lakshmi P.*₹1,000.*₹4/ }).first()).toBeVisible(); // 0.4% RD commission
  });

  test("7. Rajesh Kumar pays ₹1,000 cash: owner-paid pop-up → receipt created, OWN slip closed", async () => {
    await arun.goto("/receipts/new?q=Rajesh");
    await arun.getByRole("link", { name: /Rajesh Kumar/ }).click();
    await arun.getByLabel("Amount received (₹)").fill("1000");
    await arun.locator("#note-500").fill("2");
    await arun.getByRole("button", { name: "Save receipt" }).click();
    const popup = arun.getByRole("dialog");
    await expect(popup.getByText("Rajesh Kumar paid ₹1,000 (Cash)")).toBeVisible();
    await expect(popup.getByRole("row", { name: /OWN-0014.*RD 1124-778.*7781 2290/ })).toBeVisible();
    await expect(popup.getByText("Difference ₹0")).toBeVisible();
    await popup.getByRole("button", { name: "Adjust and create receipt" }).click();
    await arun.waitForURL(/\/receipts\/c/);
    await expect(arun.getByText("Owner-paid slips closed").locator("xpath=following-sibling::dd")).toHaveText("OWN-0014");

    await arun.goto("/receipts?tab=owner");
    await expect(arun.getByRole("row", { name: /OWN-0014.*Collected – return to owner/ })).toBeVisible();
  });

  test("8. Day Book: ATM for UPI-paid RD, deposit to PO under one receipt no., count cash → TALLIED → verify → close", async () => {
    await admin.goto("/daybook");
    await expect(admin.getByText("OPEN", { exact: true })).toBeVisible();

    await admin.getByLabel("Tick all").check();
    const upi = rupees(await admin.getByText("Paid by UPI").locator("xpath=following-sibling::div[1]").innerText());
    expect(upi).toBeGreaterThan(0);
    await admin.locator("#atmAmount").fill(String(upi));
    await admin.locator("#atmNotes").fill("For UPI-paid RD");
    await admin.getByRole("button", { name: "Record ATM withdrawal" }).click();
    await expect(admin.getByText("UPI vs ATM").locator("xpath=following-sibling::div[1]")).toHaveText("₹0");

    await admin.locator("#poReceiptNo").fill("7781 2290");
    const selected = await admin.getByText("Selected", { exact: true }).locator("xpath=following-sibling::div[1]").innerText();
    await fillCash(admin, "po", rupees(selected.split("·")[1]));
    await admin.getByRole("button", { name: "Save deposit" }).click();
    await expect(admin.getByText("No RD money waiting to be deposited.")).toBeVisible();

    const computed = rupees(await admin.locator("dt", { hasText: "Computed cash" }).locator("xpath=following-sibling::dd").innerText());
    await admin.locator("#cash-GRM").fill(String(computed - 1500));
    await admin.locator("#cash-ESevai").fill("1000");
    await admin.locator("#cash-PAN").fill("500");
    await admin.getByRole("button", { name: "Save cash count" }).click();
    await expect(admin.getByText("TALLIED – counted cash matches the Day Book.")).toBeVisible();

    await admin.getByLabel("Verified by").selectOption({ label: "R. Murali" });
    await admin.getByRole("button", { name: "Save verification" }).click();
    await expect(admin.getByRole("button", { name: "Close Day Book" })).toBeEnabled();
    await admin.getByRole("button", { name: "Close Day Book" }).click();
    await expect(admin.getByText("CLOSED", { exact: true })).toBeVisible();
  });

  test("9. A closed day can't be changed (server refuses)", async () => {
    await admin.locator("#atmAmount").fill("1000");
    await admin.getByRole("button", { name: "Record ATM withdrawal" }).click();
    await expect(admin.getByText(/Day Book for .* is closed; closed days are read-only/).first()).toBeVisible();
  });

  test("10. Owner: approve the ₹38,000 laptop; P&L shows it", async () => {
    await owner.goto("/expenses?tab=approve");
    await owner.getByRole("row", { name: /Laptop/ }).getByRole("button", { name: "Approve" }).click();
    await expect(owner.getByText(/mark it paid on the next open day/)).toBeVisible(); // today's Day Book is closed
    await owner.getByRole("link", { name: "Profit & Loss" }).click();
    await owner.waitForURL("**/pnl");
    await expect(owner.getByRole("row", { name: /Equipment.*₹38,000/ })).toBeVisible();
    await expect(owner.getByRole("row", { name: /^Profit/ })).toBeVisible();
  });

  test("11. Back as Arun: P&L menu and commission figures are hidden", async () => {
    await arun.goto("/dashboard");
    await expect(arun.getByRole("link", { name: "Profit & Loss" })).toHaveCount(0);
    await expect(arun.getByText("Commission this month")).toHaveCount(0);
    await expect(arun.getByText("Profit this month")).toHaveCount(0);
    await arun.goto("/pnl");
    await expect(arun).toHaveURL(/\/dashboard\?denied=1/);
    await arun.goto("/receipts");
    await expect(arun.getByRole("columnheader", { name: "Commission" })).toHaveCount(0);
  });
});

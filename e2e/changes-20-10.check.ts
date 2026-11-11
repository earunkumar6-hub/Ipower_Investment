// Acceptance checks for "Requirement_Analysis_3/CRM Changes 20-10.xlsx" (#1–#32), run with
// playwright.changes.config.ts against a freshly seeded DEMO install. Three people are signed in:
// Owner (Super Admin), R. Murali (Admin) and Divya (User). Every check saves a screenshot in e2e-changes/shots.
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

const SHOTS = "e2e-changes/shots";
const istToday = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
const istPlusDays = (n: number) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const rupees = (s: string) => Number(s.replace(/[^\d.]/g, ""));
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAGklEQVR4nGP4z8BAEmIY1TCqYVTDqIbhqwEAh8Ef0WvFcQIAAAAASUVORK5CYII=",
  "base64",
);

async function signIn(browser: Browser, username: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("demo1234");
  // Sign-in is rate-limited (a few tries per 10 s), so wait and retry when several people sign in at once.
  for (let attempt = 1; ; attempt++) {
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL("**/dashboard", { timeout: 8_000 });
      return { context, page };
    } catch (e) {
      if (attempt === 4) throw e;
      await page.waitForTimeout(11_000);
    }
  }
}

/** Cash denomination grid `<prefix>-500 … <prefix>-coins`: ₹500 notes and the rest in coins. */
async function fillCash(page: Page, prefix: string, amount: number) {
  await page.locator(`#${prefix}-500`).fill(String(Math.floor(amount / 500)));
  await page.locator(`#${prefix}-coins`).fill(String(amount % 500));
}

async function openProposal(page: Page) {
  await page.goto("/proposals");
  await page.locator("main a[href^='/proposals/c']").first().click();
  await page.waitForURL(/\/proposals\/c/);
}

async function openCustomer(page: Page, name: string) {
  await page.goto(`/customers?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name, exact: true }).first().click();
  await page.waitForURL(/\/customers\/c/);
}

/** Total of the ticked bill rows (last ₹ amount in each row). */
async function tickedTotal(page: Page) {
  const rows = page.locator("tr", { has: page.locator("input[type=checkbox]:checked") });
  let sum = 0;
  for (const text of await rows.allInnerTexts()) {
    const all = text.match(/₹[\d,]+(\.\d+)?/g);
    if (all) sum += rupees(all[all.length - 1]);
  }
  return sum;
}

/** Fill "Amount received" when the form leaves it empty; returns the amount. */
async function amountFor(page: Page, expected: number) {
  const amount = page.locator("#amount");
  const now = rupees(await amount.inputValue());
  if (!now) await amount.fill(String(expected));
  return now || expected;
}

/** Select the first option whose text matches. */
async function pickOption(select: Locator, re: RegExp) {
  const texts = await select.locator("option").allInnerTexts();
  const label = texts.find((t) => re.test(t));
  if (!label) throw new Error(`No option matching ${re} in: ${texts.join(" | ")}`);
  await select.selectOption({ label });
}

const shot = (page: Page, item: string) => page.screenshot({ path: `${SHOTS}/${item}.png`, fullPage: true });
const errorText = (page: Page | Locator, re: RegExp) => page.getByText(re).first();

test.describe("CRM Changes 20-10 – acceptance", () => {
  let contexts: BrowserContext[] = [];
  let owner: Page, admin: Page, user: Page;

  test.beforeAll(async ({ browser }) => {
    const s = [await signIn(browser, "superadmin"), await signIn(browser, "admin"), await signIn(browser, "divya")];
    contexts = s.map((x) => x.context);
    [owner, admin, user] = s.map((x) => x.page);
  });
  test.afterAll(async () => Promise.all(contexts.map((c) => c.close())));

  // ── Proposals: #1 consent, #12 joint account, #2 KYC optional + issue, #26 save top/bottom ──
  test("#1 Consent – Aadhaar/PAN need 'Customer consent taken' (no OTP)", async () => {
    await owner.goto("/quotations");
    await owner.getByRole("link", { name: "Q-0416" }).click();
    await expect(owner.getByRole("heading", { name: /Customer decision/ })).toBeVisible();
    const create = owner.getByRole("button", { name: /Create proposal from selected/ });
    if (await create.count()) {
      await create.click();
      await expect(owner.getByText(/P-\d{4}/).first()).toBeVisible();
    }
    await openProposal(owner);
    await expect(owner.getByText(/OTP/i)).toHaveCount(0);
    await expect(owner.getByText("Needed before Aadhaar / PAN can be saved")).toBeVisible();
    await expect(owner.locator("#pan")).toBeDisabled(); // locked until consent is ticked
    await expect(owner.locator("#aadhaar")).toBeDisabled();
    await owner.getByLabel("Customer consent taken").check();
    await owner.locator("#pan").fill("QAQPA1234Q");
    await owner.getByRole("button", { name: "Save proposal" }).click(); // one Save for the whole proposal (3 Nov 2026)
    await owner.getByRole("button", { name: "Yes, save" }).click();
    await expect(owner.getByText(/QAQxxxxx4Q/).first()).toBeVisible();
    await shot(owner, "01");
  });

  test("#12 Joint account – second holder picked from existing customers, both CIFs", async () => {
    await openProposal(owner);
    await owner.getByLabel("Joint account").check();
    await owner.getByText("Existing customer", { exact: true }).click();
    await owner.locator("#jh-search").fill("Karthik");
    await owner.getByRole("button", { name: /Karthik V/ }).first().click();
    await expect(owner.getByText(/Karthik V/).first()).toBeVisible();
    await expect(owner.locator("#jh-cif1")).toHaveCount(0); // company CIF only for post office products (3 Nov 2026)
    await owner.getByRole("button", { name: "Save proposal" }).click(); // one Save for the whole proposal (3 Nov 2026)
    await owner.getByRole("button", { name: "Yes, save" }).click();
    await owner.waitForTimeout(1500);
    await owner.reload();
    await expect(owner.getByText(/Karthik V/).first()).toBeVisible();
    await shot(owner, "12");
  });

  test("#2 KYC upload optional – proposal saved and issued with no documents (+#26 Save at top and bottom)", async () => {
    await openProposal(owner);
    await expect(owner.getByText("Not required to save or submit")).toBeVisible();
    await expect(owner.getByText("0 uploaded")).toBeVisible();
    await expect(owner.getByRole("button", { name: "Save proposal" })).toHaveCount(1); // one Save for details + policy number (owner, 3 Nov 2026)
    await owner.locator("#schemeId").selectOption({ label: "Individual" });
    await owner.locator("#frequency").selectOption({ label: "Yearly" });
    await owner.locator("#term").fill("1");
    await owner.locator("#sumInsured").fill("500000"); // insurance needs the sum assured before the policy number (3 Nov 2026)
    await owner.locator("#startDate").fill(istToday());
    await owner.getByRole("button", { name: "Save proposal" }).click(); // blank policy number: details saved only
    await expect(owner.getByText("Check before saving")).toBeVisible(); // #26 check-before-saving pop-up
    await owner.getByRole("button", { name: "Yes, save" }).click();
    await expect(owner.getByText(/Proposal saved/)).toBeVisible();
    await owner.locator("#policyNumber").fill("CARE-QA-0002");
    await owner.getByRole("button", { name: "Save proposal" }).click();
    await owner.getByRole("button", { name: "Yes, save" }).click();
    await expect(owner.getByText(/Policy CARE-QA-0002 issued/)).toBeVisible();
    // KYC can still be uploaded: attach a PAN copy
    await owner.getByLabel("What is the file").selectOption("PAN");
    await owner.getByLabel("File", { exact: true }).setInputFiles({ name: "pan.png", mimeType: "image/png", buffer: PNG });
    await owner.getByRole("button", { name: "Attach file" }).click();
    await expect(owner.getByText("pan.jpg").first()).toBeVisible(); // Aadhaar / PAN copies are turned into a small JPG
    await shot(owner, "02");
    // #12 continued: the second holder's page lists the joint account
    await openCustomer(owner, "Karthik V");
    await expect(owner.getByText(/Joint accounts – second holder/)).toBeVisible();
    await shot(owner, "12b");
  });

  // ── Receipts ──
  test("#3 Bank account on receipt – UPI receipt must name the company account it came into", async () => {
    await user.goto("/receipts/new?q=Karthik");
    await user.getByRole("link", { name: /Karthik V/ }).first().click();
    const bills = user.getByRole("checkbox", { name: /^Pay / });
    if (!(await user.locator("input[type=checkbox]:checked").count())) await bills.first().check();
    await user.getByRole("button", { name: "UPI", exact: true }).click();
    await user.locator("#reference").fill("UTR-QA-0003");
    await expect(user.locator("#intoAccountId option")).toContainText(["", "SBI ••1234"]); // company accounts to pick from
    await user.locator("#intoAccountId").selectOption({ label: "SBI ••1234" });
    await user.getByRole("button", { name: "Save receipt" }).click();
    await user.waitForURL(/\/(receipts|payments)\/c/);
    await shot(user, "03");
    await user.goto("/receipts?q=Karthik");
    await expect(user.locator("tbody tr").filter({ hasText: "Karthik V" }).filter({ hasText: "UPI" }).first()).toContainText("SBI ••1234");
  });

  test("#4 Multiple dues, one receipt – two bills paid together → one PAY- with a line per bill", async () => {
    await owner.goto("/receipts/new?q=Anitha");
    await owner.getByRole("link", { name: /Anitha S/ }).first().click();
    const boxes = owner.getByRole("checkbox", { name: /^Pay / });
    for (let i = 0; i < 2; i++) await boxes.nth(i).check();
    const amount = await amountFor(owner, await tickedTotal(owner));
    await fillCash(owner, "note", amount);
    await owner.getByRole("button", { name: /Generate one receipt/ }).click();
    await owner.waitForURL(/\/payments\/c/);
    await expect(owner.getByText(/PAY-\d+/).first()).toBeVisible();
    await expect(owner.getByText(/RCPT-\d+/)).toHaveCount(2);
    await shot(owner, "04");
  });

  test("#5 Combined receipt – bills of different customers ticked → one receipt", async () => {
    await owner.goto("/receipts/combined/new");
    await owner.getByRole("checkbox", { name: /Pay RD 2231-104/ }).check();
    await owner.getByRole("checkbox", { name: /Pay RD 3111-277/ }).check();
    await owner.locator("#payerName").fill("QA Combined Payer");
    await owner.locator("#payerMobile").fill("9876500005");
    const amount = await amountFor(owner, await tickedTotal(owner));
    await fillCash(owner, "note", amount);
    await owner.getByRole("button", { name: "Generate one receipt" }).click();
    await owner.waitForURL(/\/payments\/c/);
    await expect(owner.getByText(/PAY-\d+/).first()).toBeVisible();
    await shot(owner, "05");
    await owner.goto("/receipts?tab=combined");
    await expect(owner.getByRole("link", { name: /Combined receipts 1/ })).toBeVisible();
  });

  test("#22 Receipts filter – name, customer ID, group, product, policy, mode, account, status, dates", async () => {
    await owner.goto("/receipts");
    for (const l of ["Name or mobile", "Bill group", "Product", "Policy / account no.", "Payment mode", "Account", "Status"])
      await expect(owner.getByLabel(l, { exact: true })).toBeVisible();
    await expect(owner.locator("#rf-from")).toBeVisible();
    await expect(owner.locator("#rf-to")).toBeVisible();
    await owner.getByLabel("Payment mode", { exact: true }).selectOption({ label: "UPI" });
    await owner.getByRole("button", { name: "Filter" }).click();
    await owner.waitForURL(/mode=/);
    const rows = owner.locator("tbody tr");
    expect(await rows.count()).toBeGreaterThan(0);
    for (const t of await rows.allInnerTexts()) expect(t).toMatch(/UPI/);
    await shot(owner, "22");
  });

  test("#23 Instalments by date – From/To picks advance instalments into one receipt", async () => {
    await owner.goto("/receipts/new?q=Lakshmi");
    await owner.getByRole("link", { name: /Lakshmi P/ }).first().click();
    const before = await owner.locator("input[type=checkbox]:checked").count();
    await owner.locator("#bills-to").fill(istPlusDays(95));
    await owner.getByRole("button", { name: "Show instalments" }).click();
    await expect.poll(async () => owner.locator("input[type=checkbox]:checked").count()).toBeGreaterThan(before + 1);
    await shot(owner, "23");
  });

  test("#24 Payment modes – Cash, UPI, Net banking (NEFT/IMPS/RTGS + bank + txn), Cheque, Card; direct bill by NEFT", async () => {
    await user.goto("/direct-bills/new");
    for (const m of ["Cash", "UPI", "Net banking", "Cheque", "Card"]) await expect(user.getByRole("button", { name: m, exact: true })).toBeVisible();
    await user.locator("#payerName").fill("QA Walk-in");
    await user.locator("#payerMobile").fill("9876500024");
    await user.locator("#purpose").fill("Form filling");
    await user.locator("#amount").fill("500");
    await user.getByRole("button", { name: "Net banking", exact: true }).click();
    await expect(user.locator("#netType option")).toHaveText(["", "NEFT", "IMPS", "RTGS"]);
    await user.locator("#netType").selectOption("NEFT");
    await user.locator("#bankName").selectOption({ label: "HDFC" });
    await user.locator("#reference").fill("NEFT-QA-0024");
    await user.locator("#intoAccountId").selectOption({ label: "SBI ••1234" });
    await user.getByRole("button", { name: "Save bill" }).click();
    await user.waitForURL(/\/direct-bills\/c/);
    await expect(user.getByText(/NEFT/).first()).toBeVisible();
    await expect(user.getByText(/HDFC/).first()).toBeVisible();
    await shot(user, "24");
  });

  test("#25 Cash denomination – grid on every cash form; total must equal the amount", async () => {
    await owner.goto("/receipts/new?q=Ramesh");
    await owner.getByRole("link", { name: /Ramesh B/ }).first().click();
    const amount = await amountFor(owner, (await tickedTotal(owner)) || 1000);
    await owner.locator("#note-500").fill("1"); // ₹500 – doesn't add up
    await expect(errorText(owner, /must add up/i)).toBeVisible();
    await expect(owner.getByRole("button", { name: /Save receipt|Generate one receipt/ })).toBeDisabled();
    await shot(owner, "25");
    expect(amount).toBeGreaterThan(500);
    await owner.goto("/daybook");
    for (const p of ["atm", "bd", "ow"]) await expect(owner.locator(`#${p}-500`)).toBeVisible(); // ATM, deposit, owner money
    await owner.goto("/esevai");
    await expect(owner.locator("#sv-500")).toBeVisible();
  });

  test("#32 Receipt tabs – Customer, Owner-paid, Combined, Family grouped (with counts)", async () => {
    await owner.goto("/receipts");
    for (const t of ["Customer receipts", "Owner-paid receipts", "Combined receipts", "Family grouped receipts"])
      await expect(owner.getByRole("link", { name: new RegExp(`^${t} \\d+`) })).toBeVisible();
    await shot(owner, "32");
  });

  test("#21 Bill groups – Admin creates a group; a User can't; one receipt for the group", async () => {
    await user.goto("/receipts/groups");
    await expect(user.getByRole("button", { name: "Create bill group" })).toHaveCount(0);
    await admin.goto("/receipts/groups");
    await admin.locator("#bg-name").fill("QA Family group");
    await admin.locator("#bg-contact").fill("QA Head");
    await admin.getByRole("button", { name: "Create bill group" }).click();
    await admin.waitForURL(/\/receipts\/groups\/c/);
    await shot(admin, "21");
  });

  // ── E-Sevai ──
  test("#6 Wallets – CSC / E-Sevai / Other; recharge from a bank with transaction no.; statement", async () => {
    await admin.goto("/settings/accounts");
    await expect(admin.locator("#walletKind option")).toHaveText(["", "CSC wallet", "E-Sevai wallet", "Other"]);
    await admin.locator("#walletKind").selectOption({ label: "E-Sevai wallet" });
    await admin.locator("#wOpening").fill("1000");
    await admin.getByRole("button", { name: "Add wallet" }).click();
    await expect(admin.getByRole("row", { name: /E-Sevai wallet/ }).first()).toBeVisible();
    await admin.goto("/esevai");
    await pickOption(admin.locator("#walletId"), /E-Sevai/);
    await admin.locator("#rechargeAmount").fill("500");
    await pickOption(admin.locator("#bankAccountId"), /SBI/);
    await admin.getByRole("button", { name: "Recharge" }).click();
    await expect(admin.getByText("Enter the transaction number").first()).toBeVisible(); // transaction no. required
    await admin.locator("#rechargeRef").fill("RCH-QA-0006");
    await admin.getByRole("button", { name: "Recharge" }).click();
    await expect(admin.getByText("Enter the transaction number")).toHaveCount(0);
    await admin.getByRole("row", { name: /E-Sevai wallet/ }).first().getByRole("link", { name: "Statement" }).click();
    await expect(admin.getByText(/RCH-QA-0006/).first()).toBeVisible();
    await shot(admin, "06");
  });

  test("#7 E-Sevai entry – service types, Other with typed name, wallet or GPay/Net banking, txn no. required", async () => {
    await user.goto("/esevai");
    await expect(user.locator("#serviceCode option")).toContainText(["EB bill", "PAN application", "Certificate", "Other"]);
    await expect(user.locator("#paidVia option")).toContainText(["GPay direct", "Net banking direct"]);
    await expect(user.locator("#mode option")).toHaveText(["Cash", "UPI"]);
    await user.locator("#serviceCode").selectOption("OTHER");
    const otherName = user.getByLabel(/service name|what service|Other/i).first();
    await otherName.fill("Ration card QA");
    await user.locator("#providerRef").fill("APP-QA-0007");
    await user.locator("#customerMobile").fill("9876500007");
    await user.locator("#customerName").fill("QA E-Sevai customer");
    await user.locator("#paidAmount").fill("50");
    await user.locator("#collected").fill("80");
    await user.locator("#mode").selectOption("Cash");
    await user.locator("#sv-50").fill("1");
    await user.locator("#sv-20").fill("1");
    await user.locator("#sv-10").fill("1");
    await user.getByRole("button", { name: "Save and print receipt" }).click();
    await expect(user.getByText("Enter the transaction number").first()).toBeVisible(); // transaction no. required
    await user.locator("#providerTxnNo").fill("TXN-QA-0007");
    const popup = user.waitForEvent("popup", { timeout: 10_000 }).catch(() => null);
    await user.getByRole("button", { name: "Save and print receipt" }).click();
    await (await popup)?.close();
    await user.goto("/esevai");
    await expect(user.getByRole("row", { name: /Ration card QA.*TXN-QA-0007|TXN-QA-0007/ }).first()).toBeVisible();
    await shot(user, "07");
  });

  // ── Expenses ──
  test("#8 Expense types and 'From account' (company banks + office cash)", async () => {
    await user.goto("/expenses");
    await expect(user.locator("#category option")).toContainText(["Staff salary", "Pooja", "Customer incentives", "Bank charges"]);
    const from = await user.locator("#fromAccount option").allInnerTexts();
    expect(from).toContain("Office cash");
    expect(from.some((o) => /••\d{4}/.test(o))).toBe(true);
    await shot(user, "08");
  });

  test("#31 Expense notes mandatory and #30 'Other' needs typed text, added to the list", async () => {
    await user.goto("/expenses");
    await user.locator("#category").selectOption("Other");
    const other = user.getByLabel(/– other$/).first();
    await expect(other).toBeVisible(); // #30 a text box appears for "Other"
    await user.locator("#description").fill("Courier charges");
    await user.locator("#amount").fill("300");
    await user.locator("#vendor").fill("QA Couriers");
    await user.locator("#billNo").fill("QA-31");
    await fillCash(user, "note", 300);
    await user.locator("#notes").fill("Courier to head office");
    await user.getByRole("button", { name: "Submit" }).click();
    const missing = (l: Locator) => l.evaluate((el) => (el as HTMLInputElement).validity.valueMissing);
    expect(await missing(other)).toBe(true); // #30 the browser refuses to submit while the text box is empty
    await other.fill("Courier QA");
    await user.locator("#notes").fill("");
    await user.getByRole("button", { name: "Submit" }).click();
    expect(await missing(user.locator("#notes"))).toBe(true); // #31 Notes required
    await expect(user.getByRole("row", { name: /Courier QA/ })).toHaveCount(0);
    await user.locator("#notes").fill("Courier to head office");
    await user.getByRole("button", { name: "Submit" }).click();
    await expect(user.getByRole("row", { name: /Courier QA/ }).first()).toBeVisible();
    await shot(user, "30-31");
    await owner.goto("/settings/dropdowns?list=expensePurpose");
    await expect(owner.getByRole("row", { name: /Courier QA/ })).toBeVisible();
    await user.goto("/expenses");
    await expect(user.locator("#category option", { hasText: "Courier QA" })).toHaveCount(1); // offered next time
    await owner.getByRole("row", { name: /Courier QA/ }).getByRole("button", { name: "Remove" }).click();
    await expect(owner.getByRole("row", { name: /Courier QA/ })).toContainText(/Removed|Hidden|Off/i);
    await shot(owner, "30b");
    await user.goto("/expenses");
    await expect(user.locator("#category option", { hasText: "Courier QA" })).toHaveCount(0); // removed by the Admin
  });

  // ── Day Book ──
  test("#9 ATM withdrawal – bank, amount, reason, txn no. (required), withdrawn by staff/owner, denomination", async () => {
    await user.goto("/daybook");
    await expect(user.locator("#atmBy option")).toContainText([/Owner/]);
    await user.locator("#atmAmount").fill("2000");
    await user.locator("#atmBy").selectOption({ index: 0 });
    await user.locator("#atmReason").fill("Cash for counter");
    await fillCash(user, "atm", 2000);
    await user.getByRole("button", { name: "Record ATM withdrawal" }).click();
    await expect(user.getByText("Enter the transaction number").first()).toBeVisible();
    await user.locator("#atmRef").fill("ATM-QA-0009");
    await user.getByRole("button", { name: "Record ATM withdrawal" }).click();
    await expect(user.getByText(/ATM-QA-0009/).first()).toBeVisible();
    await shot(user, "09");
  });

  test("#16 Deposit to bank – bank, amount, slip no., denomination; cash down, bank up", async () => {
    await user.goto("/daybook");
    await user.locator("#bdAmount").fill("1000");
    await user.locator("#bdRef").fill("SLIP-QA-0016");
    await fillCash(user, "bd", 1000);
    await user.getByRole("button", { name: "Record deposit to bank" }).click();
    await expect(user.getByText(/SLIP-QA-0016/).first()).toBeVisible();
    await shot(user, "16");
  });

  test("#19 Owner withdrawal and #20 contribution – recorded by staff, confirmed by the owner, in the Owner statement", async () => {
    await user.goto("/daybook");
    await user.getByRole("button", { name: "Owner withdrawal", exact: true }).click();
    await user.locator("#owAmount").fill("3000");
    await pickOption(user.locator("#owAccount"), /cash/i);
    await user.locator("#owReason").fill("QA owner withdrawal");
    await fillCash(user, "ow", 3000);
    await user.getByRole("button", { name: "Record owner withdrawal" }).click();
    await expect(user.getByText(/QA owner withdrawal/).first()).toBeVisible();
    await user.getByRole("button", { name: "Owner contribution", exact: true }).click();
    await user.locator("#owAmount").fill("5000");
    await pickOption(user.locator("#owAccount"), /cash/i);
    await user.locator("#owReason").fill("QA owner contribution");
    await fillCash(user, "ow", 5000);
    await user.getByRole("button", { name: /Record owner contribution/ }).click();
    await expect(user.getByText(/QA owner contribution/).first()).toBeVisible();
    await expect(user.locator("li", { hasText: "QA owner withdrawal" }).getByRole("button", { name: "Confirm" })).toHaveCount(0); // staff can't confirm
    await shot(user, "19-20");
    await owner.goto("/daybook");
    for (const r of ["QA owner withdrawal", "QA owner contribution"]) {
      const li = owner.locator("li", { hasText: r });
      await li.getByRole("button", { name: "Confirm" }).click();
      await expect(li).toContainText("Confirmed");
    }
    await owner.goto("/pnl");
    await expect(owner.getByRole("row", { name: /QA owner withdrawal.*Confirmed|Confirmed.*QA owner withdrawal/ })).toBeVisible();
    await expect(owner.getByRole("row", { name: /QA owner contribution/ })).toBeVisible();
    await shot(owner, "19-20b");
  });

  test("#10 Grace period – setting (3 days) and the Day Book shows open/closed state", async () => {
    await owner.goto("/settings/daybook");
    await expect(owner.locator("#graceDays")).toHaveValue("3");
    await admin.goto("/daybook");
    await expect(admin.getByText(/^OPEN/).first()).toBeVisible();
    await shot(owner, "10");
  });

  // ── Settings / customers ──
  test("#17 Bank accounts – add (bank, branch, masked no., IFSC, MICR, type), shown in money screens, switch off", async () => {
    await owner.goto("/settings/accounts");
    await owner.locator("#bankName").fill("HDFC");
    await owner.locator("#branch").fill("Anna Nagar");
    await owner.locator("#accountNo").fill("50100012345678");
    await owner.locator("#accountKind").selectOption("Savings");
    await owner.locator("#ifsc").fill("HDFC0001234");
    await owner.locator("#micr").fill("600240002");
    await owner.locator("#openingBalance").fill("5000");
    await owner.getByRole("button", { name: "Add bank account" }).click();
    const row = owner.getByRole("row", { name: /HDFC/ }).first();
    await expect(row).toContainText("••••5678");
    await expect(row).toContainText("MICR 600240002");
    await expect(owner.getByText("50100012345678")).toHaveCount(0); // never shown in full
    await owner.getByRole("row", { name: /HDFC/ }).first().getByRole("link", { name: "Edit" }).click();
    await expect(owner.getByRole("heading", { name: "Edit bank account" })).toBeVisible();
    await expect(owner.locator("#branch")).toHaveValue("Anna Nagar");
    await owner.locator("#branch").fill("Anna Nagar West");
    await owner.getByRole("button", { name: "Save changes" }).click();
    await expect(owner.getByRole("heading", { name: "Add bank account" })).toBeVisible();
    await expect(owner.getByRole("row", { name: /HDFC/ }).first()).toContainText("Anna Nagar West");
    await owner.goto("/direct-bills/new");
    await owner.getByRole("button", { name: "UPI", exact: true }).click();
    await expect(owner.locator("#intoAccountId option", { hasText: "HDFC ••5678" })).toHaveCount(1);
    await owner.goto("/settings/accounts");
    await owner.getByRole("row", { name: /HDFC/ }).first().getByRole("button", { name: "Switch off" }).click();
    await expect(owner.getByRole("row", { name: /HDFC/ }).first()).toContainText(/Off|Switched off|Inactive/i);
    await shot(owner, "17");
    await owner.goto("/direct-bills/new");
    await owner.getByRole("button", { name: "UPI", exact: true }).click();
    await expect(owner.locator("#intoAccountId option", { hasText: "HDFC ••5678" })).toHaveCount(0);
  });

  test("#11 MICR and account type – on bank accounts and on products / customer holdings", async () => {
    await owner.goto("/settings/accounts");
    await expect(owner.locator("#micr")).toBeVisible();
    await expect(owner.locator("#accountKind option")).toHaveText(["", "Savings", "Current"]);
    await owner.goto("/settings");
    await owner.getByRole("row", { name: /Post Office TD/ }).getByRole("link", { name: "Edit" }).click();
    await owner.locator("input[name=bankFields][value=micr]").check();
    await owner.locator("input[name=bankFields][value=accountType]").check();
    await owner.getByRole("button", { name: "Save product" }).first().click();
    const yes = owner.getByRole("button", { name: "Yes, save" });
    if (await yes.isVisible().catch(() => false)) await yes.click();
    await expect(owner.getByText(/saved/i).first()).toBeVisible();
    await openCustomer(owner, "Anitha S");
    await owner.getByRole("link", { name: "Add product directly" }).click();
    await expect(owner.locator("#productId option", { hasText: "Post Office TD" })).toHaveCount(1);
    await pickOption(owner.locator("#productId"), /Post Office TD/);
    await expect(owner.getByLabel(/MICR/).first()).toBeVisible();
    await expect(owner.getByLabel(/Account type/).first()).toBeVisible();
    await shot(owner, "11");
  });

  test("#13 Unique customer ID and #28 duplicate pop-up – same PAN on a second customer is refused", async () => {
    await openCustomer(owner, "Balaji K");
    await expect(owner.getByText(/CIF-\d{6}/)).toHaveCount(0); // the CRM's own customer ID is no longer shown (10 Nov 2026)
    await owner.getByRole("button", { name: "Add Aadhaar / PAN" }).click();
    const dlg = owner.getByRole("dialog");
    await dlg.getByLabel("Customer consent taken").check();
    await dlg.locator("#ci-pan").fill("QAQPB5678R");
    await dlg.getByRole("button", { name: "Save" }).click();
    await expect(owner.getByText(/QAQxxxxx8R/).first()).toBeVisible();
    await openCustomer(owner, "Chitra N");
    await owner.getByRole("button", { name: "Add Aadhaar / PAN" }).click();
    const dlg2 = owner.getByRole("dialog");
    await dlg2.getByLabel("Customer consent taken").check();
    await dlg2.locator("#ci-pan").fill("QAQPB5678R");
    await dlg2.getByRole("button", { name: "Save" }).click();
    const dup = owner.getByRole("dialog", { name: /PAN already belongs to Balaji K/ });
    await expect(dup).toBeVisible();
    await expect(dup.getByRole("link", { name: "Open existing customer" })).toBeVisible();
    await expect(dup.getByRole("button", { name: "Go back and correct" })).toBeVisible();
    await shot(owner, "13-28");
  });

  test("#14 Customer photo – shown at the top, Change photo", async () => {
    await openCustomer(owner, "Dinesh R");
    await owner.locator("input[name=photo]").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: PNG });
    await expect(owner.locator("img[src*='/photo']").first()).toBeVisible();
    await shot(owner, "14");
  });

  test("#15 Overdue in months – up to 30 days in days, then months + days", async () => {
    await owner.goto("/renewals?tab=overdue");
    await expect(owner.getByRole("row", { name: /Vijay A/ }).first()).toContainText(/1 month \d+ days?/);
    await expect(owner.locator("tbody td").filter({ hasText: /^\d{1,2} days? overdue$/ }).first()).toBeVisible(); // under 30 days: in days
    await shot(owner, "15");
    await owner.goto("/dashboard");
    await expect(owner.getByText(/Oldest 1 month \d+ days? overdue/)).toBeVisible();
  });

  test("#26 Save at top and bottom – customer edit and add product, with check before saving", async () => {
    await openCustomer(owner, "Gayathri V");
    await owner.getByRole("button", { name: "Edit details" }).click();
    await expect(owner.getByRole("dialog").getByRole("button", { name: "Save changes" })).toHaveCount(2);
    await owner.getByRole("dialog").getByRole("button", { name: "Save changes" }).first().click();
    await expect(owner.getByText("Check before saving")).toBeVisible();
    await shot(owner, "26");
    await owner.keyboard.press("Escape");
  });

  test("#27 Premature closure – product settings; Close early hidden / greyed / active; MF Withdraw", async () => {
    await owner.goto("/settings");
    await owner.getByRole("row", { name: /Post Office TD/ }).getByRole("link", { name: "Edit" }).click();
    await expect(owner.getByText("Premature closure allowed")).toBeVisible();
    await expect(owner.getByText("Can be closed during the lock-in period")).toBeVisible();
    await openCustomer(owner, "Rajesh Kumar");
    const rows = owner.locator("tr");
    await expect(rows.filter({ hasText: "TD 2210-045" }).getByRole("button", { name: "Close early" })).toBeEnabled(); // lock-in over
    await expect(rows.filter({ hasText: "RD 1124-778" }).getByRole("button", { name: "Close early" })).toBeDisabled(); // inside lock-in
    await expect(rows.filter({ hasText: "FOLIO-1102345" }).getByRole("button", { name: "Withdraw" })).toBeVisible(); // mutual fund
    await shot(owner, "27");
    await openCustomer(owner, "Oviya M");
    const nsc = owner.locator("tr").filter({ hasText: "NSC 4410-22" });
    await expect(nsc).toContainText("Not allowed"); // product forbids early closure
    await expect(nsc.getByRole("button", { name: "Close early" })).toHaveCount(0);
    await shot(owner, "27b");
  });

  test("#29 Follow-ups on the customer – badge, table, joins 'calls open'", async () => {
    await openCustomer(user, "Suresh M");
    const calls = rupees(await user.getByRole("button", { name: /calls? open/ }).innerText());
    await user.locator("#fu-date").fill(istPlusDays(1));
    await user.locator("#fu-time").fill("10:30");
    await user.locator("#fu-note").fill("QA follow-up call");
    await user.getByRole("button", { name: "Add follow-up" }).click();
    await expect(user.getByText(/Follow-up due/).first()).toBeVisible();
    await expect(user.getByRole("row", { name: /QA follow-up call/ })).toBeVisible();
    await expect.poll(async () => rupees(await user.getByRole("button", { name: /calls? open/ }).innerText())).toBe(calls + 1);
    await shot(user, "29");
  });

  // ── Commission (#18) – hidden by the owner's later decision (23 Oct 2026) ──
  test("#18 Commission received – Super Admin only; now hidden from the menu and the P&L line removed", async () => {
    await expect(owner.getByRole("link", { name: "Commission", exact: true })).toHaveCount(0);
    await admin.goto("/commission");
    await expect(admin).toHaveURL(/denied=1|\/dashboard/);
    await user.goto("/commission");
    await expect(user).toHaveURL(/denied=1|\/dashboard/);
    await owner.goto("/settings/roles");
    await expect(owner.getByRole("checkbox", { name: "Admin: Commission received", exact: true })).toBeDisabled();
    await owner.goto("/pnl");
    await expect(owner.getByText(/Commission earned/)).toHaveCount(0);
    await shot(owner, "18");
  });

  test("Roles – Users don't see Settings, P&L or Commission; Admins don't see Roles", async () => {
    await user.goto("/dashboard");
    for (const l of ["Settings", "Profit & Loss", "Commission"]) await expect(user.getByRole("link", { name: l, exact: true })).toHaveCount(0);
    await admin.goto("/settings/roles");
    await expect(admin).toHaveURL(/denied=1|\/dashboard|\/settings$/);
    await shot(user, "roles");
  });
});

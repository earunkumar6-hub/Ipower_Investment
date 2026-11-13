import { LeadsPage } from "../../pages/leads-page";
import { QuotationForm } from "../../pages/quotation-page";
import { ReceiptForm } from "../../pages/receipt-page";
import { RenewalsPage } from "../../pages/renewals-page";
import { TicketsPage } from "../../pages/tickets-page";
import { resetDb, userId } from "../../support/db";
import { duplicateNumbers, fkColumns, orphanCounts, REQUIRED_FKS, USER_REFS } from "../../support/integrity";
import { expect, newSignedInPage, stamp, test } from "../../support/fixtures";

// Cross-module journeys, then data-integrity checks on what they wrote.
// One worker keeps file order (journeys first, integrity after); no serial mode, so one failure does not hide the rest.
test.beforeAll(async () => resetDb());

const tag = stamp();
const leadFirst = `Journey${tag}`;
const leadMobile = `98${tag}77`.slice(0, 10);
const policyNo = `QA-J1-${tag}`;
const premium = 12000;

const dmy = (d: Date) => d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" });

test("[J1][PROP-05] lead → quotation → proposal → policy → reminder → receipt → dashboard & report", async ({ page, loginAs, db, shell }) => {
  test.setTimeout(300_000);
  // 1. Employee adds a lead.
  await loginAs("arun");
  const leads = new LeadsPage(page);
  await leads.goto();
  await leads.addLead({ first: leadFirst, last: "QA", mobile: leadMobile });
  const lead = await expect.poll(() => db.lead.findFirst({ where: { mobile: leadMobile } })).toBeTruthy().then(() => db.lead.findFirstOrThrow({ where: { mobile: leadMobile } }));
  expect(lead.ownerId).toBe(await userId("arun"));

  // 2. Quotation for the lead (life cover from Settings).
  const q = new QuotationForm(page);
  await page.goto(`/quotations/new?leadId=${lead.id}`);
  await expect(q.heading("New quotation")).toBeVisible();
  await q.keepRows(1);
  await q.fillRow(0, { product: "Life insurance", company: "SBI Life", plan: "Smart Shield", payMode: "Yearly", sumInsured: "1000000", premium: String(premium) });
  const quoteId = await q.save();

  // 3. Proposal from the quotation.
  await page.getByRole("button", { name: /Create proposal from selected/ }).click();
  await expect.poll(() => db.proposal.count({ where: { quotationId: quoteId } })).toBe(1);
  const proposal = await db.proposal.findFirstOrThrow({ where: { quotationId: quoteId } });

  // 4. Issue: commenced a year ago less 3 days, so the first renewal falls due in 3 days.
  const doc = new Date(Date.now() - (365 - 3) * 86_400_000);
  await page.goto(`/proposals/${proposal.id}`);
  const plan = page.getByLabel(/^Plan/);
  if (await plan.count()) await plan.selectOption({ index: 1 });
  await page.getByLabel("Pay mode").selectOption("Yearly");
  await page.getByLabel(/^Sum assured/).fill("1000000");
  await page.getByLabel(/^Term \(years\)/).fill("10");
  const ppt = page.getByLabel(/^Premium paying term/);
  if (await ppt.count()) await ppt.fill("10");
  await page.getByLabel(/^Date of commencement/).fill(dmy(doc));
  await page.getByLabel(/number \(leave blank until issued\)/).fill(policyNo);
  await page.getByRole("button", { name: "Save proposal" }).click();
  await shell.confirmSave();
  await expect.poll(async () => (await db.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, { timeout: 30_000 }).toBe("Issued");
  const policy = await db.policy.findFirstOrThrow({ where: { policyNumber: policyNo }, include: { renewals: { orderBy: { dueDate: "asc" } } } });
  const customer = await db.customer.findUniqueOrThrow({ where: { id: policy.customerId } });
  expect(customer.name).toContain(leadFirst);

  // PROP-05: issued proposals leave the list; "Show issued proposals" finds them.
  await page.goto("/proposals");
  await expect(page.getByText(proposal.proposalNo)).toHaveCount(0);
  await page.goto("/proposals?issued=1");
  await expect(page.getByText(proposal.proposalNo).first()).toBeVisible();

  // 5. The premium falls due → on Renewals → reminder → logged in Sent messages.
  const due = policy.renewals.find((r) => r.status === "Due");
  expect(due, "a renewal is due").toBeTruthy();
  const r = new RenewalsPage(page);
  await r.goto("?tab=due&range=next30");
  const row = r.rowFor(policyNo);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "Send reminder" }).click();
  await expect.poll(() => db.messageLog.count({ where: { relatedId: due!.id } })).toBe(1);
  const msg = await db.messageLog.findFirstOrThrow({ where: { relatedId: due!.id } });
  expect(msg.body).toContain(leadFirst);
  expect(msg.status).toBe("Sent (mock)");

  // 6. Payment taken → bill Paid.
  const f = new ReceiptForm(page);
  await f.gotoCustomer(customer.id);
  await page.getByRole("checkbox", { name: new RegExp(policyNo) }).first().check();
  await f.payCash(await f.amountValue());
  await f.save().click();
  if (await page.getByRole("dialog").filter({ hasText: "Check before saving" }).count()) await shell.confirmSave();
  await page.waitForURL(/\/(receipts|payments)\/c/);
  const receipt = await db.receipt.findUniqueOrThrow({ where: { id: page.url().split("/").pop()! } });
  expect((await db.renewalItem.findUniqueOrThrow({ where: { id: due!.id } })).status).toBe("Paid");

  // 7. Dashboard (Super Admin) and the receipts report include it.
  const owner = await newSignedInPage(page.context().browser()!, "superadmin");
  await owner.goto("/dashboard");
  await expect(owner.locator("main")).toContainText("Arun");
  const res = await owner.request.get("/api/export/receipts");
  expect(res.status()).toBe(200);
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.body()) as unknown as ArrayBuffer);
  const text = JSON.stringify(wb.worksheets.map((w) => w.getSheetValues()));
  expect(text).toContain(receipt.receiptNo);
  await owner.context().close();
});

test("[J2][TKT-01][TKT-03][TKT-05] ticket raised → admin updates status and comments → raiser sees it", async ({ page, loginAs, db }) => {
  const title = `QA journey ticket ${tag}`;
  // Admin sets where developer alerts go (the seed leaves them blank).
  const setup = await newSignedInPage(page.context().browser()!, "admin");
  await setup.goto("/tickets");
  await setup.getByLabel("WhatsApp mobile").fill("9876500011");
  await setup.getByLabel("Email").fill("dev.qa@example.com");
  await setup.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await db.tenant.findFirstOrThrow()).ticketAlertMobile).toBe("9876500011");
  await setup.context().close();
  await loginAs("arun");
  await new TicketsPage(page).raise({ title, screen: "Receipts", type: "Problem", priority: /^High/, details: "Receipt PDF does not open" });
  await expect.poll(() => db.ticket.count({ where: { title } })).toBe(1);
  const t = await db.ticket.findFirstOrThrow({ where: { title } });
  expect(t.ticketNo).toMatch(/^TK-\d+/);
  expect(t.status).toBe("Open");
  // High: target 3 days after the raise date (targetDate is a DATE).
  const raised = new Date(`${t.createdAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" })}T00:00:00Z`);
  expect(Math.round((t.targetDate.getTime() - raised.getTime()) / 86_400_000)).toBe(3);
  expect(await db.messageLog.count({ where: { relatedId: t.id, template: "ticketAlert" } })).toBeGreaterThan(0);

  const admin = await newSignedInPage(page.context().browser()!, "admin");
  await admin.goto(`/tickets/${t.id}`);
  await admin.getByLabel("Change status").selectOption({ label: "In progress" });
  await admin.getByLabel("Comment").fill("Looking into it – QA");
  await admin.getByRole("button", { name: "Save" }).click();
  await expect.poll(async () => (await db.ticket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("InProgress");
  await admin.context().close();

  await page.goto(`/tickets/${t.id}`);
  await expect(page.getByText("In progress").first()).toBeVisible();
  await expect(page.getByText("Looking into it – QA")).toBeVisible();
});

test.fixme("[J3][ADV-01] customer → scheme advisor → suggestion saved – no scheme advisor in the app (Q14)", async () => {});

test.describe("Data integrity after the journeys", () => {
  test("[INT-01] no orphan rows", async ({ db }) => {
    const counts = await orphanCounts(db);
    expect(Object.entries(counts).filter(([, n]) => n > 0)).toEqual([]);
  });

  test("[INT-02] core links are foreign keys in the database", async ({ db }) => {
    const fks = await fkColumns(db);
    expect(REQUIRED_FKS.map(([t, c]) => `${t}.${c}`).filter((k) => !fks.has(k))).toEqual([]);
  });

  test("[INT-06] user references (owner / created by / audit user) are foreign keys", async ({ db }) => {
    const fks = await fkColumns(db);
    const missing = USER_REFS.map(([t, c]) => `${t}.${c}`).filter((k) => !fks.has(k));
    expect(missing, `no FK to User on: ${missing.join(", ")}`).toEqual([]);
  });

  test("[INT-03] audit fields are filled on journey rows", async ({ db }) => {
    // Found by prefix: a failed test restarts the worker, which gives this file a new tag.
    const lead = await db.lead.findFirstOrThrow({ where: { firstName: { startsWith: "Journey" } }, orderBy: { createdAt: "desc" } });
    const pol = await db.policy.findFirstOrThrow({ where: { policyNumber: { startsWith: "QA-J1-" } }, orderBy: { createdAt: "desc" } });
    const receipts = await db.receipt.findMany({ where: { policyId: pol.id } });
    expect(receipts.length).toBeGreaterThan(0);
    for (const r of receipts) { expect(r.createdById).toBeTruthy(); expect(r.createdAt).toBeTruthy(); }
    expect(lead.ownerId).toBeTruthy();
    expect(await db.auditLog.count({ where: { userId: "" } })).toBe(0);
    // Change log (Settings → Change log) for each record the journey created.
    const quote = await db.quotation.findFirstOrThrow({ where: { leadId: lead.id } });
    const proposal = await db.proposal.findFirstOrThrow({ where: { quotationId: quote.id } });
    const ids: Record<string, string> = { lead: lead.id, quotation: quote.id, proposal: proposal.id, policy: pol.id, receipt: receipts[0].id };
    const unlogged = [];
    for (const [what, id] of Object.entries(ids)) if (!(await db.auditLog.count({ where: { entityId: id } }))) unlogged.push(what);
    expect(unlogged, `no change-log entry for: ${unlogged.join(", ")}`).toEqual([]);
  });

  test("[INT-04] business numbers are unique", async ({ db }) => {
    const d = await duplicateNumbers(db);
    expect(Object.entries(d).filter(([, n]) => n > 0)).toEqual([]);
  });

  test("[INT-05] every saved receipt has its Day Book line", async ({ db }) => {
    const missing = await db.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int n from "Receipt" r where r.status = 'Saved' and r."ownerPaid" = false
         and not exists (select 1 from "DayBookEntry" d where d."sourceId" = r.id)
         and not exists (select 1 from "DayBookEntry" d where d."sourceId" = r."paymentId")`);
    expect(missing[0].n).toBe(0);
  });
});

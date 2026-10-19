import type { Prisma } from "@prisma/client";
import { PROPOSAL_NEXT, PROPOSAL_STATUS } from "@/app/(app)/proposals/labels";
import { HOLDING_KIND, loadCustomer360 } from "@/lib/customer-360";
import { actionItems, adminDashboard, collectionsByStaff, ownerExtras, ownerPies } from "@/lib/dashboard";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { loadDayBook } from "@/lib/daybook-view";
import { companyStatus, DEPOSIT_WHERE, depositStatusSelect, nameLookup } from "@/lib/deposit-status";
import { esevaiEntries, walletSummary } from "@/lib/esevai-day";
import type { Cell, Sheet } from "@/lib/excel";
import { canApprove, expenseStatusLabel } from "@/lib/expenses";
import { LEAD_SOURCE_LABEL, LEAD_STATUS_LABEL, maskMobile } from "@/lib/lead-labels";
import { ownerScope, userNames } from "@/lib/leads";
import {
  customerFilter, dayBookDate, depositFilter, expenseFilter, EXPENSE_TABS, leadFilter, MESSAGE_TEMPLATE, monthLabel, type Params,
  pnlMonth, PRODUCT_SHORT, RENEWAL_TABS, SLIP_STATUS,
} from "@/lib/lists";
import { fmtINR, sum } from "@/lib/money";
import { seesAll, type Permission } from "@/lib/permissions";
import { monthKey, monthRange, previousMonthKey, profitAndLoss } from "@/lib/pnl";
import { loadRenewals, refreshOverdue, renewalStatus } from "@/lib/renewals";
import type { SessionUser } from "@/lib/session";

// Excel export per list screen: same filters as the screen (lib/lists.ts), every matching row.

type Built = { file: string; title: string; sheets: Sheet[] };
/** `build` returns null when the record asked for is missing or not the user's (404). */
type Report = { permission: Permission; build: (user: SessionUser, sp: Params) => Promise<Built | null> };

const stamp = () => isoDate(istToday());
const label = <K extends string>(list: readonly (readonly [K, string])[], key: K) => list.find(([k]) => k === key)?.[1] ?? key;
const nameIn = (users: { id: string; name: string }[]) => (id: string | null) => users.find((u) => u.id === id)?.name ?? "";

export const REPORTS: Record<string, Report> = {
  // The Admin / Owner dashboard as on screen: cards, action list, renewals and chart data (Owner extras for the Super Admin).
  dashboard: {
    permission: "Report.Export",
    async build(user) {
      const owner = user.role === "SuperAdmin";
      const [d, o, pies, staff] = await Promise.all([
        adminDashboard(user),
        owner ? ownerExtras(user) : null,
        owner ? ownerPies(user) : null,
        collectionsByStaff(user),
      ]);
      const cards: Cell[][] = [
        ["New leads today", d.newLeads, null, d.newLeadsBySource],
        ["Renewals due this week", d.renewals.length, d.renewalsPremium, "premium"],
        ["Unpaid / not renewed", d.overdueCount, null, d.overdueCount ? `Oldest ${d.oldestOverdueDays} days overdue` : "None"],
        ["Today's collections", null, d.collections, `Cash ${fmtINR(d.collectionsCash)} · UPI ${fmtINR(d.collectionsUpi)}`],
        ["Cash in hand", null, d.cashInHand, `Day Book: ${d.cashStatus}`],
        [d.bank.name, null, d.bank.closing, "After ATM, cheques and transfers"],
        ["E-Sevai wallets", null, d.walletTotal, d.wallets.map((w) => `${w.name.replace(" wallet", "")} ${fmtINR(w.closing)}${w.low ? " (low)" : ""}`).join(" · ")],
        ["Waiting for approval", d.waitingCount, d.waitingAdmin.plus(d.waitingSuperAdmin), `${fmtINR(d.waitingAdmin)} Admin · ${fmtINR(d.waitingSuperAdmin)} Super Admin`],
      ];
      if (o) {
        cards.push(
          [o.profit.isNegative() ? "Loss this month" : "Profit this month", null, o.profit, `Income ${fmtINR(o.income)} · expenses ${fmtINR(o.expenses)}`],
          ["Owner money", null, o.ownerOwed, `Customers owe ${fmtINR(o.customerOwes)} · to return ${fmtINR(o.toReturn)}`],
        );
      }
      const slices = (name: string, header: string, xs: { label: string; value: number }[]): Sheet => ({
        name, totals: true, columns: [{ header, width: 28 }, { header: "Amount", type: "money" }], rows: xs.map((s) => [s.label, s.value]),
      });
      const sheets: Sheet[] = [
        { name: "Summary", columns: [{ header: "Card", width: 26 }, { header: "Count" }, { header: "Amount", type: "money" }, { header: "Detail", width: 60 }], rows: cards },
        { name: "Needs your action", columns: [{ header: "Item", width: 28 }, { header: "Detail", width: 60 }, { header: "Who" }], rows: actionItems(d.actions).map((x) => [x.item, x.detail, x.who]) },
        {
          name: "Renewals this week",
          totals: true,
          columns: [{ header: "Customer", width: 24 }, { header: "Product", width: 30 }, { header: "Due", type: "date" }, { header: "Amount", type: "money" }],
          rows: d.renewals.map((r) => [r.policy.customer.name, r.policy.productType === "PoRd" ? `RD ${r.policy.policyNumber}` : `${r.policy.partner} ${r.policy.productName}`, r.dueDate, r.premiumAmount]),
        },
        slices("Collections by staff", `Staff (${staff.month})`, staff.slices),
      ];
      if (pies) sheets.push(slices("Expenses by category", `Category (${pies.month})`, pies.expenses));
      if (o) {
        sheets.push({
          name: "Collections last 7 days",
          totals: true,
          columns: [{ header: "Day" }, { header: "Cash", type: "money" }, { header: "UPI / bank", type: "money" }],
          rows: o.week.map((w) => [w.day, w.cash, w.upi]),
        });
      }
      return { file: `dashboard-${stamp()}.xlsx`, title: `Dashboard – ${fmtDate(istToday())}`, sheets };
    },
  },

  leads: {
    permission: "Lead.View",
    async build(user, sp) {
      const { where, status, source, q } = leadFilter(user, sp);
      const [leads, users] = await Promise.all([
        db.lead.findMany({ where, orderBy: { createdAt: "desc" }, include: { calls: { where: { outcome: null }, orderBy: { dueAt: "asc" }, take: 1 } } }),
        userNames(user.tenantId),
      ]);
      const owner = nameIn(users);
      const filter = [status && LEAD_STATUS_LABEL[status], source && LEAD_SOURCE_LABEL[source], q && `"${q}"`].filter(Boolean).join(", ");
      return {
        file: `leads-${stamp()}.xlsx`,
        title: `Leads${filter ? ` – ${filter}` : ""}`,
        sheets: [{
          name: "Leads",
          columns: [{ header: "No." }, { header: "Name", width: 24 }, { header: "Mobile" }, { header: "WhatsApp" }, { header: "Email", width: 24 },
            { header: "Date of birth", type: "date" }, { header: "Address", width: 30 }, { header: "Source" }, { header: "Status" },
            { header: "Next call", type: "datetime", width: 20 }, { header: "Owner" }, { header: "Created", type: "datetime", width: 20 }],
          rows: leads.map((l) => [l.leadNo, l.name, maskMobile(l.mobile), l.onWhatsApp ? "Yes" : "No", l.email, l.dob, l.address,
            LEAD_SOURCE_LABEL[l.source], LEAD_STATUS_LABEL[l.status], l.calls[0]?.dueAt, owner(l.ownerId), l.createdAt]),
        }],
      };
    },
  },

  quotations: {
    permission: "Quote.View",
    async build(user) {
      const quotations = await db.quotation.findMany({
        where: { tenantId: user.tenantId, ...ownerScope(user) },
        include: { items: true, proposals: { select: { status: true } } },
        orderBy: { createdAt: "desc" },
      });
      return {
        file: `quotations-${stamp()}.xlsx`,
        title: "Quotations",
        sheets: [{
          name: "Quotations",
          totals: true,
          columns: [{ header: "No." }, { header: "Created", type: "datetime", width: 20 }, { header: "Customer", width: 24 }, { header: "Products", width: 30 },
            { header: "Subtotal", type: "money" }, { header: "GST", type: "money" }, { header: "Total", type: "money" }, { header: "Valid till", type: "date" }, { header: "Status" }],
          rows: quotations.map((q) => [q.quoteNo, q.createdAt, q.customerName, q.items.map((i) => i.category).join(", "), q.subtotal, q.gstTotal, q.total, q.validUpto,
            q.proposals.some((p) => p.status === "Issued") ? "Converted" : q.status === "Accepted" ? "Accepted" : "Draft"]),
        }],
      };
    },
  },

  proposals: {
    permission: "Proposal.View",
    async build(user) {
      const proposals = await db.proposal.findMany({
        where: { tenantId: user.tenantId, ...ownerScope(user) },
        include: { consents: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: { createdAt: "desc" },
      });
      return {
        file: `proposals-${stamp()}.xlsx`,
        title: "Proposals",
        sheets: [{
          name: "Proposals",
          totals: true,
          columns: [{ header: "No." }, { header: "Created", type: "datetime", width: 20 }, { header: "Customer", width: 24 }, { header: "Partner", width: 32 },
            { header: "Premium", type: "money" }, { header: "Consent" }, { header: "Status" }, { header: "Policy no." }, { header: "Next", width: 22 }],
          rows: proposals.map((p) => {
            const consent = p.consents[0]?.status;
            return [p.proposalNo, p.createdAt, p.customerName, `${p.insurer} – ${p.productName}`, p.premium, consent,
              PROPOSAL_STATUS[p.status][0], p.policyNumber, p.status === "ConsentGiven" && !p.panMasked ? "Enter PAN" : PROPOSAL_NEXT[p.status]];
          }),
        }],
      };
    },
  },

  customers: {
    permission: "Policy.View",
    async build(user, sp) {
      const { where, q } = customerFilter(user, sp);
      await refreshOverdue(user.tenantId, istToday());
      const customers = await db.customer.findMany({
        where,
        include: {
          policies: {
            select: { productType: true, renewals: { where: { status: { in: ["Due", "Overdue"] } }, orderBy: { dueDate: "asc" }, take: 1, select: { dueDate: true, status: true, premiumAmount: true } } },
          },
        },
        orderBy: { name: "asc" },
      });
      return {
        file: `customers-${stamp()}.xlsx`,
        title: `Partners / Customers${q ? ` – "${q}"` : ""}`,
        sheets: [{
          name: "Customers",
          columns: [{ header: "Customer", width: 24 }, { header: "Mobile" }, { header: "Holdings", width: 24 }, { header: "Next due", type: "date" },
            { header: "Amount", type: "money" }, { header: "Overdue" }],
          rows: customers.map((c) => {
            const counts = Object.entries(c.policies.reduce<Record<string, number>>((m, p) => ({ ...m, [PRODUCT_SHORT[p.productType]]: (m[PRODUCT_SHORT[p.productType]] ?? 0) + 1 }), {}));
            const next = c.policies.flatMap((p) => p.renewals).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
            return [c.name, maskMobile(c.mobile), counts.map(([k, n]) => `${n} ${k}`).join(" · "), next?.dueDate, next?.premiumAmount, next?.status === "Overdue" ? "Overdue" : ""];
          }),
        }],
      };
    },
  },

  // One customer's Customer 360 screen: details, holdings, renewals, receipts and owner-paid slips.
  customer: {
    permission: "Policy.View",
    async build(user, sp) {
      const data = sp.id ? await loadCustomer360(user, sp.id) : null;
      if (!data) return null;
      const { c, owner, renewals, receiptNo, active, yearlyPremium, unpaid, slipFor } = data;
      return {
        file: `customer-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${stamp()}.xlsx`,
        title: `Customer 360 – ${c.name}`,
        sheets: [
          {
            name: "Customer",
            columns: [{ header: "Item", width: 26 }, { header: "Detail", width: 50 }, { header: "Amount", type: "money" }],
            rows: [
              ["Name", c.name, null],
              ["Mobile", maskMobile(c.mobile), null],
              ["Email", c.email, null],
              ["Address", c.address, null],
              ["Owner", owner?.name, null],
              ["PAN", c.panMasked ?? "not collected", null],
              ["Aadhaar", c.aadhaarLast4 ? `XXXX-XXXX-${c.aadhaarLast4}` : "not collected", null],
              ["Active holdings", String(active.length), null],
              ["Insurance premium / year", null, sum(yearlyPremium)],
              ["Due in 30 days", `${unpaid.filter((r) => r.status === "Overdue").length} overdue`, sum(unpaid.map((r) => r.premiumAmount))],
            ],
          },
          {
            name: "Holdings",
            columns: [{ header: "Product" }, { header: "Partner · plan", width: 32 }, { header: "Policy / folio / account", width: 22 }, { header: "Cover", type: "money" },
              { header: "Premium / instalment", type: "money", width: 18 }, { header: "Frequency" }, { header: "Since", type: "date" }, { header: "Status" }],
            rows: c.policies.map((p) => [HOLDING_KIND[p.productType], p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} · ${p.productName}` : p.productName,
              p.policyNumber, p.sumAssured, p.premiumAmount, p.frequency === "OneTime" ? "One-time deposit" : p.frequency, p.startDate, p.status]),
          },
          {
            name: "Renewals and instalments",
            columns: [{ header: "Due", type: "date" }, { header: "Policy / account", width: 22 }, { header: "Amount", type: "money" }, { header: "Status" },
              { header: "Paid on", type: "date" }, { header: "Receipt", width: 24 }],
            rows: renewals.map((r) => [r.dueDate, r.policy.policyNumber, r.premiumAmount, r.status, r.paidOn,
              r.paidReceiptId ? receiptNo.get(r.paidReceiptId) : r.status === "Paid" ? (slipFor.has(r.id) ? `owner paid · ${slipFor.get(r.id)}` : "before this system") : null]),
          },
          {
            name: "Receipts",
            columns: [{ header: "Receipt" }, { header: "Date", type: "date" }, { header: "For", width: 24 }, { header: "Mode" }, { header: "Amount", type: "money" }, { header: "Status" }],
            rows: c.receipts.map((r) => [r.receiptNo, r.receiptDate, (r.policy?.policyNumber ?? r.notes ?? "") + (r.ownerPaid ? " (owner-paid)" : ""), r.mode, r.amount, r.status]),
          },
          {
            name: "Owner-paid slips",
            columns: [{ header: "Slip" }, { header: "RD account" }, { header: "Month" }, { header: "Amount", type: "money" }, { header: "Status", width: 28 }, { header: "Closed by receipt" }],
            rows: c.ownerPaidSlips.map((s) => [s.slipNo, s.policy.policyNumber, monthLabel(s.month), s.amount, SLIP_STATUS[s.status][0], s.closedByReceipt?.receiptNo]),
          },
        ],
      };
    },
  },

  renewals: {
    permission: "Renewal.View",
    async build(user, sp) {
      const today = istToday();
      const { tab, within, paidTo, filterLabel, rows: items } = await loadRenewals(user, sp, today);
      const scope = tab === "due" ? `due in the next ${within} days` : tab === "overdue" ? "overdue" : paidTo === "pending" ? "not yet paid to Post office / insurer" : "paid in the last 30 days";
      const paid = tab === "paid";
      return {
        file: `renewals-${tab}-${stamp()}.xlsx`,
        title: `Renewals – ${label(RENEWAL_TABS, tab)} (${scope}) – ${filterLabel}`,
        sheets: [{
          name: label(RENEWAL_TABS, tab),
          totals: true,
          columns: [{ header: "Customer", width: 24 }, { header: "Product", width: 30 }, { header: "Policy / account" }, { header: "Due", type: "date" },
            { header: "Amount", type: "money" }, { header: "Status", width: 20 },
            ...(paid ? [{ header: "Paid on", type: "date" as const }, { header: "Receipt" }, { header: "Collected by" }, { header: "Paid to Post office / Insurer", width: 48 }] : [{ header: "Last reminder", type: "datetime" as const, width: 20 }])],
          rows: items.map((i) => {
            const p = i.policy;
            const [status] = renewalStatus(i, today);
            // A maturity's amount is the deposit, not money to collect, so it stays out of the totals column.
            const base: Cell[] = [p.customer.name, p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`, p.policyNumber, i.date,
              i.kind === "maturity" ? null : i.amount, i.kind === "maturity" ? `${status} (deposit ${fmtINR(i.amount)})` : status];
            return paid ? [...base, i.paidOn, i.paidReceiptNo ?? "owner paid", i.collectedBy, i.companyStatus?.text ?? ""] : [...base, i.lastReminderAt];
          }),
        }],
      };
    },
  },

  receipts: {
    permission: "Receipt.View",
    // Both tabs in one file: customer receipts (with the screen's deposit filter), then owner-paid RD slips.
    async build(user, sp) {
      const deposit = depositFilter(sp);
      const [receipts, slips, accounts, users] = await Promise.all([
        db.receipt.findMany({
          where: { tenantId: user.tenantId, ...(seesAll(user.role) ? {} : { createdById: user.id }), ...(deposit !== "all" && DEPOSIT_WHERE[deposit]) },
          include: {
            customer: { select: { name: true } },
            policy: { select: { partner: true, productName: true, policyNumber: true } },
            payment: { select: { paymentNo: true } },
            companyPayment: depositStatusSelect.companyPayment,
            poDepositLine: depositStatusSelect.poDepositLine,
          },
          orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
        }),
        db.ownerPaidSlip.findMany({
          where: { tenantId: user.tenantId, policy: ownerScope(user) },
          include: { policy: { select: { policyNumber: true } }, customer: { select: { name: true } }, closedByReceipt: { select: { receiptNo: true } } },
          orderBy: { createdAt: "desc" },
        }),
        db.account.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
        userNames(user.tenantId),
      ]);
      const account = nameIn(accounts);
      const nameOf = nameLookup(users);
      return {
        file: `receipts-${stamp()}.xlsx`,
        title: `Receipts${deposit === "all" ? "" : ` – deposit ${deposit}`}`,
        sheets: [{
          name: "Customer receipts",
          totals: true,
          columns: [{ header: "Receipt no." }, { header: "Payment no." }, { header: "Bill date", type: "date" }, { header: "Transaction date", type: "date" }, { header: "Entered", type: "datetime", width: 20 }, { header: "Customer", width: 24 },
            { header: "For", width: 32 }, { header: "Mode" }, { header: "Reference" }, { header: "Account" }, { header: "Amount", type: "money" },
            { header: "Collected by" }, { header: "Status" }, { header: "RD status" }, { header: "Deposit status", width: 48 }, { header: "Cancel reason", width: 24 }],
          rows: receipts.map((r) => {
            const forText = (r.policy ? (r.policy.partner === "Post Office" ? r.policy.policyNumber : `${r.policy.partner} ${r.policy.productName}`) : r.notes ?? "") + (r.ownerPaid ? " (owner-paid)" : "");
            return [r.receiptNo, r.payment?.paymentNo, r.receiptDate, r.txnDate, r.createdAt, r.customer.name, forText, r.mode, r.reference, account(r.accountId), r.amount,
              nameOf(r.createdById), r.status, r.status !== "Cancelled" ? r.rdStatus : null,
              r.policy && r.status !== "Cancelled" ? companyStatus(r, r.policy.partner, nameOf).text : null, r.cancelReason];
          }),
        }, {
          // Internal: not collections or income.
          name: "Owner-paid RD",
          totals: true,
          columns: [{ header: "Slip" }, { header: "Created", type: "datetime", width: 20 }, { header: "RD account" }, { header: "Customer", width: 24 }, { header: "Month" },
            { header: "Amount", type: "money" }, { header: "PO receipt no." }, { header: "Customer receipt" }, { header: "Status", width: 28 }],
          rows: slips.map((s) => [s.slipNo, s.createdAt, s.policy.policyNumber, s.customer.name, monthLabel(s.month), s.amount, s.poReceiptNo,
            s.closedByReceipt?.receiptNo, SLIP_STATUS[s.status][0]]),
        }],
      };
    },
  },

  esevai: {
    permission: "Service.Record",
    async build(user) {
      const today = istToday();
      const [{ txns, recharges }, wallets, accounts] = await Promise.all([
        esevaiEntries(user, today),
        walletSummary(user.tenantId, today),
        db.account.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
      ]);
      const account = nameIn(accounts);
      return {
        file: `esevai-${isoDate(today)}.xlsx`,
        title: `E-Sevai – ${isoDate(today)}`,
        sheets: [
          {
            name: "Entries",
            totals: true,
            columns: [{ header: "Time", type: "datetime", width: 20 }, { header: "No." }, { header: "Service" }, { header: "Customer", width: 22 }, { header: "Reference" },
              { header: "Bill amount", type: "money" }, { header: "Bill / cost", type: "money" }, { header: "Collected", type: "money" }, { header: "Profit", type: "money" },
              { header: "Mode" }, { header: "Payment ref." }, { header: "Paid from" }],
            rows: txns.map((t) => [t.createdAt, t.txnNo, t.serviceType.name, t.customerName, t.providerRef, t.baseAmount, t.walletCost, t.customerAmount, t.profit,
              t.paymentMode, t.reference, account(t.paidFromAccountId)]),
          },
          {
            name: "Wallet recharges",
            totals: true,
            columns: [{ header: "Time", type: "datetime", width: 20 }, { header: "Wallet" }, { header: "Amount", type: "money" }, { header: "Mode" }],
            rows: recharges.map((r) => [r.createdAt, account(r.accountId), r.amount, r.mode]),
          },
          {
            name: "Wallets",
            columns: [{ header: "Wallet" }, { header: "Opening", type: "money" }, { header: "Recharge", type: "money" }, { header: "Deducted", type: "money" },
              { header: "Closing", type: "money" }, { header: "Low balance" }],
            rows: wallets.map((w) => [w.name, w.opening, w.recharge, w.deducted, w.closing, w.lowThreshold && w.closing.lt(w.lowThreshold) ? "Yes" : ""]),
          },
        ],
      };
    },
  },

  expenses: {
    permission: "Expense.View",
    async build(user, sp) {
      const { tab, where } = expenseFilter(user, sp);
      const [expenses, users] = await Promise.all([
        db.expense.findMany({ where, include: { vendor: true }, orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }] }),
        db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
      ]);
      const rows = tab === "approve" ? expenses.filter((e) => canApprove(user, e)) : expenses;
      const paidIds = new Set(
        (await db.dayBookEntry.findMany({
          where: { sourceType: "Expense", sourceId: { in: rows.map((e) => e.id) }, reversalOfId: null, reversedBy: { is: null } },
          select: { sourceId: true },
        })).map((x) => x.sourceId),
      );
      const person = nameIn(users);
      return {
        file: `expenses-${tab}-${stamp()}.xlsx`,
        title: `Expenses – ${label(EXPENSE_TABS, tab)}`,
        sheets: [{
          name: "Expenses",
          totals: true,
          columns: [{ header: "No." }, { header: "Date", type: "date" }, { header: "Category" }, { header: "Purpose", width: 30 }, { header: "Vendor", width: 22 },
            { header: "Bill no." }, { header: "Paid by", width: 22 }, { header: "Mode" }, { header: "Amount", type: "money" }, { header: "Status", width: 30 },
            { header: "Entered by" }, { header: "Approved / rejected by" }, { header: "Reason", width: 24 }],
          rows: rows.map((e) => [e.expenseNo, e.expenseDate, e.category, e.description, e.vendor.name, e.billNo,
            e.paidBy === "Company" ? "Company" : `${e.paidBy}: ${e.paidByName}`, e.mode, e.amount, expenseStatusLabel(e, paidIds.has(e.id))[0],
            person(e.createdById), e.status !== "Cancelled" ? person(e.approvedById) : "", e.rejectReason ?? e.cancelReason]),
        }],
      };
    },
  },

  daybook: {
    permission: "DayBook.View",
    async build(user, sp) {
      const date = dayBookDate(sp, istToday());
      const d = await loadDayBook(user, date);
      const group = (name: string, header: string, xs: { label: string; amount: Prisma.Decimal }[]): Sheet => ({
        name, totals: true, columns: [{ header, width: 30 }, { header: "Amount", type: "money" }], rows: xs.map((g) => [g.label, g.amount]),
      });
      const tally = d.tally;
      return {
        file: `daybook-${isoDate(date)}.xlsx`,
        title: `Day Book – ${isoDate(date)} – ${d.closed ? "CLOSED" : "OPEN"}`,
        sheets: [
          {
            name: "Transactions",
            totals: true,
            columns: [{ header: "Time", type: "datetime", width: 20 }, { header: "Type", width: 22 }, { header: "Particulars", width: 36 }, { header: "Product" },
              { header: "Account" }, { header: "Mode" }, { header: "In", type: "money" }, { header: "Out", type: "money" }, { header: "Reversal" }, { header: "Notes", width: 24 }],
            rows: d.transactions.map((t) => [t.time, t.type, t.particulars, t.product, t.account, t.mode, t.inAmount, t.outAmount, t.reversal ? "Yes" : "", t.notes]),
          },
          group("By product", "Product", d.byProduct),
          group("By scheme", "Scheme", d.byScheme),
          group("By customer", "Customer", d.byCustomer),
          {
            name: "Owner-paid",
            totals: true,
            columns: [{ header: "Slip" }, { header: "Customer", width: 24 }, { header: "RD account" }, { header: "Amount", type: "money" }, { header: "PO receipt no." }],
            rows: d.ownerPaid.map((o) => [o.slipNo, o.customer, o.account, o.amount, o.poReceiptNo]),
          },
          {
            name: "Accounts",
            columns: [{ header: "Account", width: 22 }, { header: "Opening", type: "money" }, { header: "In", type: "money" }, { header: "Out", type: "money" }, { header: "Closing", type: "money" }],
            rows: d.accounts.map((a) => [a.name, a.opening, a.totalIn, a.totalOut, a.closing]),
          },
          {
            name: "Cash tally",
            columns: [{ header: "Line", width: 30 }, { header: "Amount", type: "money" }],
            rows: [
              ["Opening cash", tally.opening],
              ...tally.lines.map((l): Cell[] => [l.label, l.amount]),
              ["Computed cash", tally.computed],
              ["Counted cash", tally.counted],
              ["Difference", tally.difference],
              [tally.counted === null ? "Not counted yet" : tally.tallied ? "TALLIED" : "NOT TALLIED", null],
            ],
          },
        ],
      };
    },
  },

  pnl: {
    permission: "PnL.View",
    async build(user, sp) {
      const key = pnlMonth(sp, monthKey(istToday()));
      const [pnl, prev] = await Promise.all([
        profitAndLoss(user.tenantId, monthRange(key)),
        profitAndLoss(user.tenantId, monthRange(previousMonthKey(key))),
      ]);
      const prevOf = (lines: { label: string; amount: Prisma.Decimal }[], l: string) => lines.find((x) => x.label === l)?.amount ?? 0;
      const rows: Cell[][] = [
        ["INCOME", null, null],
        ...pnl.serviceLines.map((l): Cell[] => [`Service charges – ${l.label}`, l.amount, prevOf(prev.serviceLines, l.label)]),
        ["Commission – insurers and mutual funds (gross)", pnl.commissionPartner, prev.commissionPartner],
        ["Total income", pnl.income, prev.income],
        ["LESS: EXPENSES BY CATEGORY", null, null],
        ...pnl.expenseLines.map((l): Cell[] => [l.label, l.amount, prevOf(prev.expenseLines, l.label)]),
        ["Total expenses", pnl.expenseTotal, prev.expenseTotal],
        [pnl.profit.isNegative() ? "Loss" : "Profit", pnl.profit, prev.profit],
        ["TDS deducted on commission (tax credit – not an expense)", pnl.tdsCredit, prev.tdsCredit],
      ];
      return {
        file: `pnl-${key}.xlsx`,
        title: `Profit & Loss – ${pnl.range.label}`,
        sheets: [{
          name: "Profit & Loss",
          columns: [{ header: "", width: 50 }, { header: pnl.range.label, type: "money", width: 18 }, { header: prev.range.label, type: "money", width: 18 }],
          rows,
        }],
      };
    },
  },

  messages: {
    permission: "Message.View",
    async build(user) {
      const [messages, users] = await Promise.all([
        db.messageLog.findMany({ where: { tenantId: user.tenantId, ...(seesAll(user.role) ? {} : { createdById: user.id }) }, orderBy: { createdAt: "desc" } }),
        db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
      ]);
      return {
        file: `sent-messages-${stamp()}.xlsx`,
        title: "Sent messages (mocked – nothing was sent)",
        sheets: [{
          name: "Sent messages",
          columns: [{ header: "Time", type: "datetime", width: 20 }, { header: "Channel" }, { header: "To", width: 22 }, { header: "Message", width: 20 },
            { header: "Text", width: 60 }, { header: "By" }, { header: "Status" }],
          rows: messages.map((m) => [m.createdAt, m.channel, m.to, MESSAGE_TEMPLATE[m.template] ?? m.template, m.body,
            users.find((u) => u.id === m.createdById)?.name ?? "System", m.status]),
        }],
      };
    },
  },
};

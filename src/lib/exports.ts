import type { Prisma } from "@prisma/client";
import { holdersLabel, proposalNext, proposalStatusLabel } from "@/app/(app)/proposals/labels";
import { accountLabel } from "@/lib/accounts";
import { HOLDING_KIND, loadCustomer360 } from "@/lib/customer-360";
import { actionItems, adminDashboard, collectionsByStaff, ownerExtras, ownerPies } from "@/lib/dashboard";
import { fmtDate, istDate, istToday } from "@/lib/dates";
import { db, prisma } from "@/lib/db";
import { loadDayBook } from "@/lib/daybook-view";
import { companyStatus, depositStatusSelect, nameLookup } from "@/lib/deposit-status";
import { esevaiEntries, serviceTime, walletSummary } from "@/lib/esevai-day";
import type { Cell, Sheet } from "@/lib/excel";
import { canApprove, expenseStatusLabel } from "@/lib/expenses";
import { FOLLOWUP_TABS, loadFollowUps } from "@/lib/followups";
import { GENDER_LABEL, LEAD_SOURCE_LABEL, LEAD_STAGE_LABEL, LEAD_STATUS_LABEL, maskMobile, OUTCOME_LABEL } from "@/lib/lead-labels";
import { ownerScope, userNames } from "@/lib/leads";
import {
  customerFilter, dayBookDate, rangeLabel, expenseFilter, EXPENSE_TABS, leadFilter, MESSAGE_TEMPLATE, monthLabel, type Params,
  pnlMonth, PRODUCT_SHORT, receiptFilter, RENEWAL_TABS, SLIP_STATUS,
} from "@/lib/lists";
import { fmtINR, sum } from "@/lib/money";
import { modeLabel } from "@/lib/payment-modes";
import { seesAll, type Permission } from "@/lib/permissions";
import { commissionSummary, fyOfMonth, monthName } from "@/lib/commission-received";
import { monthKey, monthRange, ownerStatement, previousMonthKey, profitAndLoss } from "@/lib/pnl";
import { fmtTenure, PAY_MODE_LABEL } from "@/lib/products";
import { quotationStatus } from "@/lib/quotation";
import { loadRenewals, refreshOverdue, renewalStatus } from "@/lib/renewals";
import { overdueText } from "@/lib/overdue";
import type { SessionUser } from "@/lib/session";

// Excel export per list screen: same filters as the screen (lib/lists.ts), every matching row.

type Built = { file: string; title: string; sheets: Sheet[] };
/** `build` returns null when the record asked for is missing or not the user's (404). */
type Report = { permission: Permission; build: (user: SessionUser, sp: Params) => Promise<Built | null> };

/** dd-mm-yyyy for file names (a file name can't hold "/"). */
const fileDate = (d: Date) => fmtDate(d).replaceAll("/", "-");
const stamp = () => fileDate(istToday());
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
        ["Unpaid / not renewed", d.overdueCount, null, d.overdueCount ? `Oldest ${overdueText(d.oldestOverdueDays)} overdue` : "None"],
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
        db.lead.findMany({ where, orderBy: { createdAt: "desc" }, include: { calls: { where: { outcome: null }, orderBy: { dueAt: "asc" }, take: 1 }, mobiles: { orderBy: { sort: "asc" } } } }),
        userNames(user.tenantId),
      ]);
      const owner = nameIn(users);
      const filter = [status && LEAD_STATUS_LABEL[status], source && LEAD_SOURCE_LABEL[source], q && `"${q}"`].filter(Boolean).join(", ");
      return {
        file: `leads-${stamp()}.xlsx`,
        title: `Leads${filter ? ` – ${filter}` : ""}`,
        sheets: [{
          name: "Leads",
          columns: [{ header: "No." }, { header: "Name", width: 24 }, { header: "Mobile", width: 22 }, { header: "WhatsApp", width: 14 }, { header: "Date of birth", type: "dmy" },
            { header: "Gender" }, { header: "Email", width: 24 }, { header: "Address", width: 30 }, { header: "Business type" }, { header: "Referred by", width: 18 },
            { header: "Interested product", width: 24 }, { header: "Status" }, { header: "Stage" }, { header: "Next call", type: "datetime", width: 20 },
            { header: "Owner" }, { header: "Notes", width: 30 }, { header: "Created", type: "datetime", width: 20 }],
          rows: leads.map((l) => {
            const nums = l.mobiles.length ? l.mobiles : [{ number: l.mobile, isWhatsApp: l.onWhatsApp }];
            return [l.leadNo, l.name, nums.map((m) => maskMobile(m.number)).join(", "), nums.filter((m) => m.isWhatsApp).map((m) => maskMobile(m.number)).join(", ") || "No", l.dob,
              l.gender && GENDER_LABEL[l.gender], l.email, l.address, LEAD_SOURCE_LABEL[l.source], l.referrerName, l.interest, LEAD_STATUS_LABEL[l.status],
              LEAD_STAGE_LABEL[l.stage], l.calls[0]?.dueAt, owner(l.ownerId), l.notes, l.createdAt];
          }),
        }],
      };
    },
  },

  followups: {
    permission: "Lead.View",
    async build(user, sp) {
      const f = await loadFollowUps(user, sp);
      const label = FOLLOWUP_TABS.find(([k]) => k === f.tab)![1];
      return {
        file: `followups-${f.tab}-${stamp()}.xlsx`,
        title: `Follow-ups – ${label}`,
        sheets: [{
          name: "Follow-ups",
          columns: [{ header: "Due", type: "datetime", width: 20 }, { header: "Name", width: 22 }, { header: "Mobile" }, { header: "For", width: 24 },
            { header: "Last note", width: 36 }, { header: "Owner" }, { header: "Status", width: 18 }, { header: "Closed", type: "datetime", width: 20 }],
          rows: f.rows.map((r) => [r.dueAt, r.name, maskMobile(r.mobile), r.forLabel, r.outcomeNote ?? r.note, r.ownerName,
            r.outcome ? OUTCOME_LABEL[r.outcome] : r.overdue ? "Open" : "Scheduled", r.completedAt]),
        }],
      };
    },
  },
  quotations: {
    permission: "Quote.View",
    async build(user) {
      const quotations = await db.quotation.findMany({
        where: { tenantId: user.tenantId, ...ownerScope(user), deletedAt: null },
        include: { items: { include: { proposal: { select: { status: true } } } } },
        orderBy: { createdAt: "desc" },
      });
      return {
        file: `quotations-${stamp()}.xlsx`,
        title: "Quotations",
        sheets: [{
          name: "Quotations",
          totals: true,
          columns: [{ header: "No." }, { header: "Created", type: "datetime", width: 20 }, { header: "Customer", width: 24 }, { header: "Products", width: 30 },
            { header: "Premium", type: "money" }, { header: "Valid till", type: "date" }, { header: "Status" }, { header: "Sent on", type: "datetime", width: 20 }],
          rows: quotations.map((q) => [q.quoteNo, q.createdAt, q.customerName, q.items.map((i) => `${i.insurer} ${i.productName}`).join(", "), q.total, q.validUpto,
            quotationStatus(q)[0], q.sentAt]),
        }],
      };
    },
  },

  proposals: {
    permission: "Proposal.View",
    // Like the screen (#23): issued proposals only with ?issued=1.
    async build(user, sp) {
      const proposals = await db.proposal.findMany({
        where: { tenantId: user.tenantId, ...ownerScope(user), ...(sp.issued !== "1" && { status: { not: "Issued" as const } }) },
        include: { secondHolder: { select: { name: true } } },
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
            return [p.proposalNo, p.createdAt, holdersLabel(p), `${p.insurer} – ${p.productName}`, p.premium,
              p.consentAt ? "Taken" : "Not ticked", proposalStatusLabel(p)[0], p.policyNumber, proposalNext(p)];
          }),
        }],
      };
    },
  },

  customers: {
    permission: "Policy.View",
    async build(user, sp) {
      const { where, q, filtered, holdingWhere, filterLabel } = customerFilter(user, sp);
      await refreshOverdue(user.tenantId, istToday());
      const customers = await db.customer.findMany({
        where,
        include: {
          mobiles: { orderBy: { sort: "asc" } },
          policies: {
            select: { productType: true, renewals: { where: { status: { in: ["Due", "Overdue"] } }, orderBy: { dueDate: "asc" }, take: 1, select: { dueDate: true, status: true, premiumAmount: true } } },
          },
        },
        orderBy: { name: "asc" },
      });
      const matching = filtered
        ? await db.policy.findMany({ where: { tenantId: user.tenantId, customerId: { in: customers.map((c) => c.id) }, ...holdingWhere }, select: { customerId: true, policyNumber: true, productType: true, partner: true, productName: true } })
        : [];
      const staff = nameLookup(await userNames(user.tenantId));
      return {
        file: `customers-${stamp()}.xlsx`,
        title: `Partners / Customers${[filterLabel, q && `"${q}"`].filter(Boolean).map((x) => ` – ${x}`).join("")}`,
        sheets: [{
          name: "Customers",
          // Every customer detail entered (owner change list, #34); mobiles, PAN and Aadhaar stay masked like every export.
          columns: [{ header: "Customer", width: 24 }, { header: "Mobile" }, { header: "Other mobiles", width: 22 }, { header: "WhatsApp", width: 18 },
            { header: "Email", width: 24 }, { header: "Address", width: 36 }, { header: "PAN" }, { header: "Aadhaar" }, { header: "Consent taken", type: "datetime" as const, width: 20 },
            { header: "Staff", width: 16 }, { header: "Added on", type: "date" as const }, { header: "Holdings", width: 24 },
            ...(filtered ? [{ header: "Matching holdings", width: 40 }] : []), { header: "Next due", type: "date" as const },
            { header: "Amount", type: "money" as const }, { header: "Overdue" }],
          rows: customers.map((c) => {
            const counts = Object.entries(c.policies.reduce<Record<string, number>>((m, p) => ({ ...m, [PRODUCT_SHORT[p.productType]]: (m[PRODUCT_SHORT[p.productType]] ?? 0) + 1 }), {}));
            const next = c.policies.flatMap((p) => p.renewals).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
            const mine = matching.filter((p) => p.customerId === c.id)
              .map((p) => `${p.policyNumber} · ${p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}`).join(", ");
            const others = c.mobiles.filter((m) => m.number !== c.mobile).map((m) => maskMobile(m.number)).join(", ");
            const whatsApp = c.mobiles.filter((m) => m.isWhatsApp).map((m) => maskMobile(m.number)).join(", ");
            return [c.name, maskMobile(c.mobile), others, whatsApp, c.email, c.address, c.panMasked, c.aadhaarLast4 ? `XXXX-XXXX-${c.aadhaarLast4}` : null, c.consentAt,
              staff(c.ownerId), c.createdAt, counts.map(([k, n]) => `${n} ${k}`).join(" · "), ...(filtered ? [mine] : []), next?.dueDate, next?.premiumAmount, next?.status === "Overdue" ? "Overdue" : ""];
          }),
        }],
      };
    },
  },

  // One customer's Customer 360 screen: details, holdings, renewals and receipts. Owner-paid slips are left out
  // of this download (owner change list, #33) – they stay on screen and in the Receipts export.
  customer: {
    permission: "Policy.View",
    async build(user, sp) {
      const data = sp.id ? await loadCustomer360(user, sp.id) : null;
      if (!data) return null;
      const { c, owner, renewals, receiptNo, unpaid, slipFor, holdings, cards, numbers, oneTimeTotal } = data;
      return {
        file: `customer-${c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${stamp()}.xlsx`,
        title: `Customer 360 – ${c.name}`,
        sheets: [
          {
            name: "Customer",
            columns: [{ header: "Item", width: 26 }, { header: "Detail", width: 50 }, { header: "Amount", type: "money" }],
            rows: [
              ["Name", c.name, null],
              ["Mobile", numbers.map(maskMobile).join(", "), null],
              ["Email", c.email, null],
              ["Address", c.address, null],
              ["Owner", owner?.name, null],
              ["PAN", c.panMasked ?? "not collected", null],
              ["Aadhaar", c.aadhaarLast4 ? `XXXX-XXXX-${c.aadhaarLast4}` : "not collected", null],
              ["Active holdings", `${cards.holdings} · ${cards.sources} source(s)`, null],
              ["Total yearly premium (insurance)", null, cards.yearlyPremium],
              ["Investments (post office + MF)", null, cards.investments],
              ["Invested in one-time schemes", null, oneTimeTotal],
              ["Due in 30 days", `${unpaid.filter((r) => r.status === "Overdue").length} overdue`, sum(unpaid.map((r) => r.premiumAmount))],
            ],
          },
          {
            name: "Holdings",
            columns: [{ header: "Product" }, { header: "Partner · plan / scheme", width: 32 }, { header: "Policy / folio / account", width: 22 }, { header: "Cover", type: "money" },
              { header: "Invested / premium", type: "money", width: 18 }, { header: "Pay mode" }, { header: "Rate %" }, { header: "Commenced", type: "date" }, { header: "Tenure" },
              { header: "Lock-in until", type: "date" }, { header: "Maturity", type: "date" }, { header: "Status" }],
            rows: holdings.map((p) => [HOLDING_KIND[p.productType],
              p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} · ${p.productName}${p.schemeName ? ` · ${p.schemeName}` : ""}` : p.schemeName ?? p.productName,
              p.policyNumber, p.sumAssured, p.premiumAmount, PAY_MODE_LABEL[p.frequency], p.rateAtOpen?.toFixed(2), p.startDate, p.termMonths ? fmtTenure(p.termMonths) : null,
              p.lockIn && p.lockIn > p.startDate ? p.lockIn : null, p.maturity, p.status]),
          },
          {
            name: "Renewals and instalments",
            columns: [{ header: "Due", type: "date" }, { header: "Policy / account", width: 22 }, { header: "Amount", type: "money" }, { header: "Status" },
              { header: "Paid on", type: "date" }, { header: "Receipt", width: 24 }],
            rows: renewals.map((r) => [r.dueDate, r.policy.policyNumber, r.premiumAmount, r.status, r.paidOn,
              r.paidReceiptId ? receiptNo.get(r.paidReceiptId)?.no : r.status === "Paid" && !slipFor.has(r.id) ? "before this system" : null]),
          },
          {
            name: "Receipts",
            columns: [{ header: "Receipt" }, { header: "Date", type: "date" }, { header: "For", width: 24 }, { header: "Mode" }, { header: "Amount", type: "money" }, { header: "Status" }],
            rows: c.receipts.map((r) => [r.receiptNo, r.receiptDate, (r.policy?.policyNumber ?? r.notes ?? "") + (r.ownerPaid ? " (owner-paid)" : ""), modeLabel(r), r.amount, r.status]),
          },
        ],
      };
    },
  },

  renewals: {
    permission: "Renewal.View",
    async build(user, sp) {
      const today = istToday();
      const { tab, paidTo, filterLabel, rows: items, customers } = await loadRenewals(user, sp, today);
      const name = label(RENEWAL_TABS, tab);
      const title = `Renewals – ${name}${paidTo === "pending" ? " (not yet paid to Post office / insurer)" : ""} – ${filterLabel}`;
      if (tab === "customers") {
        return {
          file: `renewals-by-customer-${stamp()}.xlsx`, title,
          sheets: [{
            name, totals: true,
            columns: [{ header: "Customer", width: 24 }, { header: "Policies", width: 40 }, { header: "Due this month", type: "money" }, { header: "Paid this year", type: "money" },
              { header: "Overdue", type: "money" }, { header: "Owner-paid owed", type: "money" }],
            rows: customers.map((c) => [c.customer.name, c.policies.join(", "), c.dueThisMonth, c.paidThisYear, c.overdue, c.ownerPaidOwed]),
          }],
        };
      }
      const paid = tab === "paid";
      return {
        file: `renewals-${tab}-${stamp()}.xlsx`, title,
        sheets: [{
          name,
          totals: true,
          // Columns as in the owner's "Renewal Excel format" sheet (#18): Phone (masked, like every export) after Customer.
          // Dates and amounts as in that sheet, "25 Oct 2026" and ₹11,500 (owner, 13 Nov 2026); Last reminder is the IST date only.
          columns: [{ header: "Customer", width: 24 }, { header: "Phone", width: 14 }, { header: "Product", width: 30 }, { header: "Policy / account" }, { header: "Due", type: "day" },
            { header: "Amount", type: "money", fmt: '"₹"#,##0' }, { header: "Status", width: 22 },
            ...(paid ? [{ header: "Paid on", type: "day" as const }, { header: "Receipt" }, { header: "Collected by" }, { header: "Paid to Post office / Insurer", width: 48 }]
              : [{ header: "Reminders sent" }, { header: "Last reminder", type: "day" as const }])],
          rows: items.map((i) => {
            const p = i.policy;
            const [status] = renewalStatus(i, today);
            // A maturity's amount is the deposit / instalment, not money to collect, so it stays out of the totals column.
            const base: Cell[] = [p.customer.name, p.customer.mobile ? maskMobile(p.customer.mobile) : null, p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`, p.policyNumber, i.date,
              i.kind === "maturity" ? null : i.amount, i.kind === "maturity" ? `${status} (${fmtINR(i.amount)})` : status];
            return paid ? [...base, i.paidOn, i.paidReceiptNo ?? "owner paid", i.collectedBy, i.companyStatus?.text ?? ""]
              : [...base, i.reminderCount || null, i.lastReminderAt ? istDate(i.lastReminderAt) : null];
          }),
        }],
      };
    },
  },

  // The monthly renewal Excel: last month renewed or not, and this month's dues (the 1st-of-month email sends the same file).
  // No longer offered on the Renewals screen (owner change list, #17: one Excel that follows the view and dates).
  "renewal-month": {
    permission: "Renewal.View",
    async build(user) {
      const today = istToday();
      const lastMonth = await loadRenewals(user, { tab: "due", range: "lastmonth" }, today);
      const [last, now] = await Promise.all([
        prisma.renewalItem.findMany({
          where: { tenantId: user.tenantId, policy: ownerScope(user), dueDate: { gte: lastMonth.range!.from, lte: lastMonth.range!.to }, status: { in: ["Due", "Overdue", "Paid", "Lapsed"] } },
          include: { policy: { include: { customer: { select: { name: true } } } }, paidReceipt: { select: { receiptNo: true, payment: { select: { paymentNo: true } } } } }, orderBy: { dueDate: "asc" },
        }),
        loadRenewals(user, { tab: "due", range: "month" }, today).then(async (r) => {
          const overdue = await loadRenewals(user, { tab: "overdue", range: "month" }, today);
          return [...overdue.rows, ...r.rows].filter((x) => x.kind === "instalment");
        }),
      ]);
      const product = (p: { productType: string; partner: string; productName: string }) => (p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`);
      return {
        file: `renewals-month-${fileDate(today).slice(3)}.xlsx`,
        title: `Renewals – ${rangeLabel(lastMonth.range)} renewed or not; due this month`,
        sheets: [
          {
            name: "Last month",
            columns: [{ header: "Customer", width: 24 }, { header: "Product", width: 30 }, { header: "Policy / account" }, { header: "Due", type: "date" },
              { header: "Amount", type: "money" }, { header: "Renewed?", width: 14 }, { header: "Paid on", type: "date" }, { header: "Receipt" }],
            rows: last.map((i) => [i.policy.customer.name, product(i.policy), i.policy.policyNumber, i.dueDate, i.premiumAmount,
              i.status === "Paid" ? "Renewed" : i.status === "Lapsed" ? "Not renewed (lapsed)" : "Not renewed", i.paidOn, i.paidReceipt?.payment?.paymentNo ?? i.paidReceipt?.receiptNo ?? (i.status === "Paid" ? "owner paid" : null)]),
          },
          {
            name: "This month due",
            totals: true,
            columns: [{ header: "Customer", width: 24 }, { header: "Product", width: 30 }, { header: "Policy / account" }, { header: "Due", type: "date" },
              { header: "Amount", type: "money" }, { header: "Status", width: 18 }, { header: "Reminders sent" }],
            rows: now.map((i) => [i.policy.customer.name, product(i.policy), i.policy.policyNumber, i.date, i.amount, renewalStatus(i, today)[0], i.reminderCount || null]),
          },
        ],
      };
    },
  },

  receipts: {
    permission: "Receipt.View",
    // Every tab in one file, with the screen's filters: customer receipts, owner-paid slips, combined and bill-group receipts.
    async build(user, sp) {
      const f = receiptFilter(user, sp);
      const deposit = f.deposit;
      const grouped = (kind: "Combined" | "BillGroup") => db.payment.findMany({
        where: f.paymentWhere(kind),
        include: { billGroup: { select: { name: true } }, receipts: { select: { accountId: true, customer: { select: { name: true } } } } },
        orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
      });
      const [receipts, slips, accounts, users, combined, family] = await Promise.all([
        db.receipt.findMany({
          where: f.receiptWhere,
          include: {
            customer: { select: { name: true } },
            policy: { select: { partner: true, productName: true, policyNumber: true } },
            payment: { select: { id: true, paymentNo: true } },
            companyPayment: depositStatusSelect.companyPayment,
            poDepositLine: depositStatusSelect.poDepositLine,
          },
          orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }],
        }),
        db.ownerPaidSlip.findMany({
          where: f.slipWhere,
          include: { policy: { select: { policyNumber: true } }, customer: { select: { name: true } }, closedByReceipt: { select: { receiptNo: true } } },
          orderBy: { createdAt: "desc" },
        }),
        db.account.findMany({ where: { tenantId: user.tenantId } }).then((rows) => rows.map((a) => ({ id: a.id, name: accountLabel(a) }))),
        userNames(user.tenantId),
        grouped("Combined"),
        grouped("BillGroup"),
      ]);
      const groupedSheet = (name: string, rows: typeof combined, family: boolean): Sheet => ({
        name,
        totals: true,
        columns: [{ header: "Receipt no." }, { header: "Bill date", type: "date" }, ...(family ? [{ header: "Bill group", width: 24 }] : []), { header: "Paid by", width: 24 }, { header: "Payer mobile" },
          { header: "Customers", width: 40 }, { header: "Bills" }, { header: "Mode" }, { header: "Reference" }, { header: "Account" }, { header: "Amount", type: "money" },
          { header: "PO receipt no." }, { header: "Collected by" }, { header: "Status" }, { header: "Cancel reason", width: 24 }],
        rows: rows.map((p) => [p.paymentNo, p.receiptDate, ...(family ? [p.billGroup?.name ?? null] : []), p.payerName, p.payerMobile,
          [...new Set(p.receipts.map((r) => r.customer.name))].join(", "), p.receipts.length, modeLabel(p), [p.bankName, p.reference].filter(Boolean).join(" · "),
          account(p.receipts[0]?.accountId ?? null), p.amount, p.poReceiptNo, nameOf(p.createdById), p.status, p.cancelReason]),
      });
      const account = nameIn(accounts);
      const nameOf = nameLookup(users);
      return {
        file: `receipts-${stamp()}.xlsx`,
        title: `Receipts${deposit === "all" ? "" : ` – deposit ${deposit}`}${f.active ? " (filtered)" : ""}`,
        sheets: [{
          name: "Customer receipts",
          totals: true,
          columns: [{ header: "Receipt no." }, { header: "Payment no." }, { header: "Bill date", type: "date" }, { header: "Transaction date", type: "date" }, { header: "Entered", type: "datetime", width: 20 }, { header: "Customer", width: 24 },
            { header: "For", width: 32 }, { header: "Mode" }, { header: "Reference" }, { header: "Account" }, { header: "Amount", type: "money" },
            { header: "Collected by" }, { header: "Status" }, { header: "RD status" }, { header: "Deposit status", width: 48 }, { header: "Cancel reason", width: 24 }],
          rows: receipts.map((r) => {
            const forText = (r.policy ? (r.policy.partner === "Post Office" ? r.policy.policyNumber : `${r.policy.partner} ${r.policy.productName}`) : r.notes ?? "") + (r.ownerPaid ? " (owner-paid)" : "");
            return [r.receiptNo, r.payment?.paymentNo, r.receiptDate, r.txnDate, r.createdAt, r.customer.name, forText, modeLabel(r), [r.bankName, r.reference].filter(Boolean).join(" · "), account(r.accountId), r.amount,
              nameOf(r.createdById), r.status, r.status !== "Cancelled" ? r.rdStatus : null,
              r.policy && r.status !== "Cancelled" ? companyStatus(r, r.policy.partner, nameOf).text : null, r.cancelReason];
          }),
        }, {
          // Internal: not collections or income.
          name: "Owner-paid receipts",
          totals: true,
          columns: [{ header: "Slip" }, { header: "Created", type: "datetime", width: 20 }, { header: "RD account" }, { header: "Customer", width: 24 }, { header: "Month" },
            { header: "Amount", type: "money" }, { header: "PO receipt no." }, { header: "Customer receipt" }, { header: "Status", width: 28 }],
          rows: slips.map((s) => [s.slipNo, s.createdAt, s.policy.policyNumber, s.customer.name, monthLabel(s.month), s.amount, s.poReceiptNo,
            s.closedByReceipt?.receiptNo, SLIP_STATUS[s.status][0]]),
        }, groupedSheet("Combined receipts", combined, false), groupedSheet("Family grouped receipts", family, true)],
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
        db.account.findMany({ where: { tenantId: user.tenantId } }).then((rows) => rows.map((a) => ({ id: a.id, name: accountLabel(a) }))),
      ]);
      const account = nameIn(accounts);
      return {
        file: `esevai-${fileDate(today)}.xlsx`,
        title: `ESEVAI & CSC – ${fmtDate(today)}`,
        sheets: [
          {
            name: "Entries",
            totals: true,
            columns: [{ header: "Date", type: "date" }, { header: "Time" }, { header: "No." }, { header: "Service" }, { header: "Customer", width: 22 }, { header: "Mobile" },
              { header: "Service no." }, { header: "Transaction no." }, { header: "Paid / deducted", type: "money" }, { header: "Collected", type: "money" }, { header: "Service charge", type: "money" },
              { header: "Mode" }, { header: "Payment ref." }, { header: "Paid from" }, { header: "Notes", width: 24 }],
            rows: txns.map((t) => [t.txnDate, serviceTime(t), t.txnNo, t.serviceName ?? t.serviceType.name, t.customer?.name ?? t.customerName, t.customerMobile,
              t.providerRef, t.providerTxnNo, t.walletCost, t.customerAmount, t.profit,
              t.paymentMode, t.reference, `${t.paidVia === "Wallet" ? "" : t.paidVia === "GPay" ? "GPay direct · " : "Net banking direct · "}${account(t.paidFromAccountId)}`, t.notes]),
          },
          {
            name: "Wallet recharges",
            totals: true,
            columns: [{ header: "Date", type: "date" }, { header: "Time", type: "datetime", width: 20 }, { header: "Wallet" }, { header: "Amount", type: "money" }, { header: "Mode" }],
            rows: recharges.map((r) => [r.entryDate, r.createdAt, account(r.accountId), r.amount, r.mode]),
          },
          {
            name: "Wallets",
            columns: [{ header: "Date", type: "date" }, { header: "Wallet" }, { header: "Opening", type: "money" }, { header: "Recharge", type: "money" }, { header: "Deducted", type: "money" },
              { header: "Closing", type: "money" }, { header: "Low balance" }],
            rows: wallets.map((w) => [today, w.name, w.opening, w.recharge, w.deducted, w.closing, w.lowThreshold && w.closing.lt(w.lowThreshold) ? "Yes" : ""]),
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
          columns: [{ header: "No." }, { header: "Date", type: "date" }, { header: "Category" }, { header: "Purpose", width: 30 }, { header: "Notes", width: 30 }, { header: "Vendor", width: 22 },
            { header: "Bill no." }, { header: "Paid by", width: 22 }, { header: "Mode" }, { header: "Transaction ID / cheque no.", width: 22 }, { header: "Amount", type: "money" }, { header: "Status", width: 30 },
            { header: "Entered by" }, { header: "Approved / rejected by" }, { header: "Reason", width: 24 }],
          rows: rows.map((e) => [e.expenseNo, e.expenseDate, e.category, e.description, e.notes ?? "", e.vendor.name, e.billNo,
            e.paidBy === "Company" ? "Company" : `${e.paidBy}: ${e.paidByName}`, e.mode === "Bank" ? "Net banking" : e.mode, e.reference, e.amount, expenseStatusLabel(e, paidIds.has(e.id))[0],
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
        file: `daybook-${fileDate(date)}.xlsx`,
        title: `Day Book – ${fmtDate(date)} – ${d.closed ? "CLOSED" : "OPEN"}`,
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
      const [pnl, prev, owner] = await Promise.all([
        profitAndLoss(user.tenantId, monthRange(key)),
        profitAndLoss(user.tenantId, monthRange(previousMonthKey(key))),
        ownerStatement(user.tenantId, monthRange(key)),
      ]);
      const prevOf = (lines: { label: string; amount: Prisma.Decimal }[], l: string) => lines.find((x) => x.label === l)?.amount ?? 0;
      const rows: Cell[][] = [
        ["INCOME", null, null],
        ...pnl.serviceLines.map((l): Cell[] => [`Service charges – ${l.label}`, l.amount, prevOf(prev.serviceLines, l.label)]),
        ["Other income (entered in Day Book)", pnl.otherIncome, prev.otherIncome],
        ["Total income", pnl.income, prev.income],
        ["LESS: EXPENSES BY CATEGORY", null, null],
        ...pnl.expenseLines.map((l): Cell[] => [l.label, l.amount, prevOf(prev.expenseLines, l.label)]),
        ["Total expenses", pnl.expenseTotal, prev.expenseTotal],
        [pnl.profit.isNegative() ? "Loss" : "Profit", pnl.profit, prev.profit],
      ];
      return {
        file: `pnl-${key.slice(5)}-${key.slice(0, 4)}.xlsx`,
        title: `Profit & Loss – ${pnl.range.label}`,
        sheets: [{
          name: "Profit & Loss",
          columns: [{ header: "", width: 50 }, { header: pnl.range.label, type: "money", width: 18 }, { header: prev.range.label, type: "money", width: 18 }],
          rows,
        }, {
          // Not part of profit.
          name: "Owner statement",
          columns: [{ header: "Date", type: "date" }, { header: "Entry", width: 20 }, { header: "From / into", width: 22 }, { header: "Txn no." }, { header: "Reason", width: 36 },
            { header: "Status" }, { header: "Out", type: "money" }, { header: "In", type: "money" }],
          rows: [
            ...owner.entries.map((e): Cell[] => [e.entryDate, e.kind === "Withdrawal" ? "Owner withdrawal" : "Owner contribution", accountLabel(e.account), e.reference, e.reason, e.status,
              e.kind === "Withdrawal" ? e.amount : null, e.kind === "Contribution" ? e.amount : null]),
            ["Total (rejected left out)", null, null, null, null, null, owner.withdrawn, owner.contributed],
          ],
        }],
      };
    },
  },

  commission: {
    permission: "Commission.View", // Super Admin only
    async build(user, sp) {
      const month = monthKey(istToday());
      const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : fyOfMonth(month);
      const s = await commissionSummary(user.tenantId, month, fy);
      return {
        file: `commission-${fy}.xlsx`,
        title: `Commission received – FY ${fy}`,
        sheets: [
          {
            name: "Entries",
            totals: true,
            columns: [{ header: "For month" }, { header: "Source", width: 22 }, { header: "Amount", type: "money" }, { header: "Received into", width: 22 }, { header: "UTR / txn no.", width: 20 },
              { header: "Date received", type: "date" }, { header: "Note", width: 28 }, { header: "Status" }, { header: "Cancel reason", width: 24 }],
            // Cancelled entries are listed without an amount so the total matches the screen.
            rows: s.entries.map((e) => [monthName(e.forMonth), e.source, e.status === "Saved" ? e.amount : null, accountLabel(e.account), e.reference, e.receivedOn, e.note, e.status, e.cancelReason]),
          },
          {
            name: "By month",
            totals: true,
            columns: [{ header: "Month" }, { header: "Entries" }, { header: "Commission", type: "money" }],
            rows: s.byMonth.map((m) => [monthName(m.month), m.entries, m.amount]),
          },
          {
            name: "By financial year",
            columns: [{ header: "FY (Apr–Mar)" }, { header: "Entries" }, { header: "Commission", type: "money" }],
            rows: s.byFy.map((y) => [y.fy, y.entries, y.amount]),
          },
        ],
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

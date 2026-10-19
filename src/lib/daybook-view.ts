import type { DayBookEntry, EntryType, Prisma } from "@prisma/client";
import { accountDay, earliestOpenDayBefore } from "@/lib/daybook";
import type { CashSource } from "@/lib/daybook-labels";
import { db, type Tx } from "@/lib/db";
import { sum, ZERO } from "@/lib/money";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

// Everything the Day Book screen shows for one date, computed from the entries so that
// cards, tabs and the tally always agree with each other.


export const ENTRY_LABEL: Record<EntryType, string> = {
  Collection: "Collection",
  ServiceCollection: "E-Sevai collection",
  ServiceCost: "E-Sevai provider cost",
  WalletRecharge: "Wallet recharge",
  Expense: "Expense",
  ExpenseRepayment: "Expense repayment",
  Withdrawal: "ATM withdrawal",
  DepositToBank: "Deposit to bank",
  DepositToPo: "Deposit to post office",
  PaidToCompany: "Paid to company",
  OwnerReturn: "Return to owner",
  Adjustment: "Adjustment",
  OtherIncome: "Other income",
};

const COLLECTION: EntryType[] = ["Collection", "ServiceCollection"];
const EXPENSE: EntryType[] = ["Expense", "ExpenseRepayment"];
const signed = (e: Pick<DayBookEntry, "direction" | "amount">) => (e.direction === "In" ? e.amount : e.amount.negated());
const net = (xs: Pick<DayBookEntry, "direction" | "amount">[]) => (xs.length ? sum(xs.map(signed)) : ZERO);

function groupNet<T extends Pick<DayBookEntry, "direction" | "amount">>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, Prisma.Decimal>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? ZERO).plus(signed(x)));
  return [...m.entries()].map(([label, amount]) => ({ label, amount })).filter((g) => !g.amount.isZero());
}

export async function loadDayBook(user: SessionUser, date: Date) {
  const tenantId = user.tenantId;
  const [accounts, entries, closes, receipts, slips, collected, admins] = await Promise.all([
    db.account.findMany({ where: { tenantId } }),
    db.dayBookEntry.findMany({ where: { tenantId, entryDate: date }, orderBy: { createdAt: "asc" } }),
    db.dayClose.findMany({ where: { tenantId, date } }),
    db.receipt.findMany({ where: { tenantId, receiptDate: date, status: "Saved" }, include: { customer: { select: { name: true } } } }),
    db.ownerPaidSlip.findMany({ where: { tenantId, createdAt: { gte: date, lt: new Date(date.getTime() + 86_400_000) } }, include: { customer: { select: { name: true } }, policy: { select: { policyNumber: true } } } }),
    // RD money collected but not yet at the post office (cancelled and owner-paid receipts never qualify).
    db.receipt.findMany({
      where: { tenantId, status: "Saved", rdStatus: "Collected", ownerPaid: false, receiptDate: { lte: date } },
      include: { customer: { select: { name: true } }, policy: { select: { policyNumber: true } } },
      orderBy: { receiptDate: "asc" },
    }),
    db.user.findMany({ where: { tenantId, role: { in: ["Admin", "SuperAdmin"] }, active: true }, select: { id: true, name: true } }),
  ]);
  const days = await accountDay(db as unknown as Tx, tenantId, date);
  const accountOf = (id: string) => accounts.find((a) => a.id === id)!;
  const cash = accounts.find((a) => a.type === "Cash")!;
  const bank = accounts.find((a) => a.type === "Bank")!;
  const cashDay = days.find((d) => d.accountId === cash.id)!;
  const bankDay = days.find((d) => d.accountId === bank.id)!;
  const cashEntries = entries.filter((e) => e.accountId === cash.id);
  const bankEntries = entries.filter((e) => e.accountId === bank.id);

  // Cash tally: opening + each kind of cash movement = computed; compare with the count.
  const cashClose = closes.find((c) => c.accountId === cash.id) ?? null;
  const counted = cashClose?.physical ?? null;
  const tallyLines = groupNet(cashEntries, (e) => `${e.direction === "In" ? "+" : "−"} ${ENTRY_LABEL[e.entryType]}`)
    .map((g) => ({ label: g.label.replace(/^[+−] /, ""), amount: g.amount }));
  const difference = counted ? counted.minus(cashDay.closing) : null;

  const collections = entries.filter((e) => COLLECTION.includes(e.entryType));
  const expenses = entries.filter((e) => EXPENSE.includes(e.entryType));
  const atm = entries.filter((e) => e.entryType === "Withdrawal" && e.accountId === cash.id);
  const toPo = entries.filter((e) => e.entryType === "DepositToPo");
  const isCash = (e: DayBookEntry) => e.accountId === cash.id;

  const closed = closes.some((c) => c.status === "Closed");
  const earlierOpen = await earliestOpenDayBefore(db as unknown as Tx, tenantId, date);
  const showBalances = seesAll(user.role); // bank and wallet balances are hidden from staff

  return {
    date,
    closed,
    closedAt: closes.find((c) => c.status === "Closed")?.closedAt ?? null,
    closedById: closes.find((c) => c.status === "Closed")?.closedById ?? null,
    earlierOpen,
    verifiedById: cashClose?.verifiedById ?? null,
    verifiedAt: cashClose?.verifiedAt ?? null,
    cashBySource: (cashClose?.cashBySource ?? null) as Partial<Record<CashSource, string>> | null,
    admins,
    cards: {
      collections: net(collections),
      collectionsCash: net(collections.filter(isCash)),
      collectionsBank: net(collections.filter((e) => !isCash(e))),
      depositToPo: net(toPo).negated(),
      atm: net(atm),
      expenses: net(expenses).negated(),
      expensesCash: net(expenses.filter(isCash)).negated(),
      expensesBank: net(expenses.filter((e) => !isCash(e))).negated(),
    },
    tally: {
      opening: cashDay.opening,
      lines: tallyLines,
      computed: cashDay.closing,
      counted,
      difference,
      tallied: difference !== null && difference.isZero(),
    },
    bankLine: showBalances
      ? { name: bank.name, opening: bankDay.opening, lines: groupNet(bankEntries, (e) => `${e.direction === "In" ? "+" : "−"} ${ENTRY_LABEL[e.entryType]}`), closing: bankDay.closing }
      : null,
    accounts: showBalances ? days : days.filter((d) => d.type === "Cash"),
    transactions: entries.map((e) => ({
      id: e.id,
      time: e.createdAt,
      type: ENTRY_LABEL[e.entryType],
      entryType: e.entryType,
      reversal: e.reversalOfId !== null,
      particulars: e.particulars,
      product: [e.productCategory, e.scheme].filter(Boolean).join(" · "),
      account: accountOf(e.accountId).name,
      mode: e.mode,
      inAmount: e.direction === "In" ? e.amount : null,
      outAmount: e.direction === "Out" ? e.amount : null,
      notes: e.notes,
    })),
    byProduct: groupNet(collections, (e) => e.productCategory ?? "Other"),
    byScheme: groupNet(collections, (e) => e.scheme ?? "Other"),
    byCustomer: (() => {
      const m = new Map<string, Prisma.Decimal>();
      for (const r of receipts) m.set(r.customer.name, (m.get(r.customer.name) ?? ZERO).plus(r.amount));
      return [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount.comparedTo(a.amount));
    })(),
    ownerPaid: slips.map((s) => ({ slipNo: s.slipNo, customer: s.customer.name, account: s.policy.policyNumber, amount: s.amount, poReceiptNo: s.poReceiptNo })),
    collectedRd: collected.map((r) => ({
      id: r.id,
      receiptNo: r.receiptNo,
      customer: r.customer.name,
      account: r.policy?.policyNumber ?? "—",
      amount: r.amount.toFixed(2),
      mode: r.mode,
      ageDays: Math.round((date.getTime() - r.receiptDate.getTime()) / 86_400_000),
    })),
    atmToday: net(atm).toFixed(2),
  };
}

export type DayBookData = Awaited<ReturnType<typeof loadDayBook>>;

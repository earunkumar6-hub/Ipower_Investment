import { accountDay } from "@/lib/daybook";
import { fmtHHMM, fmtTime } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { ZERO } from "@/lib/money";
import { seesAll } from "@/lib/permissions";
import type { SessionUser } from "@/lib/session";

// What the E-Sevai screen lists for one day; shared with its Excel export.

/** An entry's time: as entered on the form, else when it was saved (older entries). */
export const serviceTime = (t: { txnTime: string | null; createdAt: Date }) => (t.txnTime ? fmtHHMM(t.txnTime) : fmtTime(t.createdAt));

/** Saved service entries (staff see their own) and wallet recharges for `date`. */
export async function esevaiEntries(user: SessionUser, date: Date) {
  const mine = seesAll(user.role) ? {} : { createdById: user.id };
  const [txns, recharges] = await Promise.all([
    db.serviceTransaction.findMany({
      where: { tenantId: user.tenantId, status: "Saved", ...mine, OR: [{ txnDate: date }, { createdAt: { gte: date, lt: new Date(date.getTime() + 86_400_000) } }] },
      include: { serviceType: true, customer: { select: { id: true, name: true, cifNo: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.dayBookEntry.findMany({ where: { tenantId: user.tenantId, entryDate: date, sourceType: "WalletRecharge", direction: "In" }, orderBy: { createdAt: "asc" } }),
  ]);
  return { txns, recharges };
}

/** Per wallet: opening, recharged, deducted for services, closing, and the low-balance threshold. */
export async function walletSummary(tenantId: string, date: Date) {
  const [days, wallets, sums] = await Promise.all([
    accountDay(db as unknown as Tx, tenantId, date),
    db.account.findMany({ where: { tenantId, type: "Wallet" } }),
    db.dayBookEntry.groupBy({
      by: ["accountId", "entryType"],
      where: { tenantId, entryDate: date, account: { type: "Wallet" } },
      _sum: { amount: true },
    }),
  ]);
  const total = (accountId: string, type: string) => sums.find((w) => w.accountId === accountId && w.entryType === type)?._sum.amount ?? ZERO;
  return days.filter((d) => d.type === "Wallet").map((d) => ({
    accountId: d.accountId,
    name: d.name,
    opening: d.opening,
    recharge: total(d.accountId, "WalletRecharge"),
    deducted: total(d.accountId, "ServiceCost"),
    closing: d.closing,
    lowThreshold: wallets.find((a) => a.id === d.accountId)?.lowBalanceThreshold ?? null,
  }));
}

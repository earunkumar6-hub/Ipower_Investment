import { receiptRef } from "@/lib/payment-lines";
import type { Frequency, Prisma } from "@prisma/client";
import { decryptJson, maskAccount } from "@/lib/crypto";
import { addDays, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { OUTCOME_LABEL } from "@/lib/lead-labels";
import { callInclude, callParty, canActOn, userNames, type CallKind } from "@/lib/leads";
import { sum, ZERO } from "@/lib/money";
import { maturityOf } from "@/lib/policies";
import { isPostal, lockInUntil, sipDateLabel } from "@/lib/products";
import { refreshOverdue } from "@/lib/renewals";
import type { SessionUser } from "@/lib/session";

/** Payments a year for each pay mode (one-time deposits pay once). */
export const PER_YEAR: Record<Frequency, number> = { Monthly: 12, Quarterly: 4, HalfYearly: 2, Yearly: 1, OneTime: 0 };
/** "₹1,000 / month", "₹1,00,000 once". */
export const PER_LABEL: Record<Frequency, string> = { Monthly: "/ month", Quarterly: "/ quarter", HalfYearly: "/ half-year", Yearly: "/ year", OneTime: "once" };
/** Products where money builds up as investments (instalments paid count); the rest is insurance premium. */
const INVESTMENT_TYPES = ["MutualFund", "PoRd", "PoTd", "PoKvp", "PoNsc", "PoMis", "PoScss", "PoSsa", "PoPpf"];

/** "SBI · Mylapore · SBIN0001234 · A/c XXXX9012" – bank details are shown masked only. */
function bankLine(enc: string | null) {
  if (!enc) return null;
  try {
    const b = decryptJson<Record<string, string>>(enc);
    return [b.holder, b.bank, b.branch, b.ifsc, b.micr && `MICR ${b.micr}`, b.accountType, b.accountNo && `A/c ${maskAccount(b.accountNo)}`].filter(Boolean).join(" · ");
  } catch {
    return "Saved (encrypted – key not available)";
  }
}

export const HOLDING_KIND = { Insurance: "Insurance", MutualFund: "Mutual fund", PoRd: "Post office RD", PoTd: "Post office TD", PoKvp: "KVP", PoNsc: "NSC", PoMis: "Post office MIS", PoScss: "SCSS", PoSsa: "SSA", PoPpf: "PPF" } as const;

const FOLLOWUP_TYPE: Record<CallKind, string> = { lead: "Lead", renewal: "Renewal", proposal: "Proposal", customer: "Customer" };

/** Customer 360 data for the screen and its exports; null when missing or not this user's customer. */
export async function loadCustomer360(user: SessionUser, id: string) {
  const today = istToday();
  await refreshOverdue(user.tenantId, today);
  const c = await db.customer.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      policies: {
        orderBy: [{ productType: "asc" }, { startDate: "asc" }],
        include: {
          renewals: { orderBy: { dueDate: "asc" } }, product: { select: { lockInMonths: true, prematureClosure: true, closeDuringLockIn: true, invoiceRule: true } }, scheme: { select: { name: true } },
          secondHolder: { select: { id: true, name: true, cifNo: true } },
        },
      },
      // Joint accounts where this customer is the second holder (bills and receipts stay with the first holder).
      jointPolicies: { orderBy: { startDate: "asc" }, include: { customer: { select: { id: true, name: true, cifNo: true } } } },
      mobiles: { orderBy: { sort: "asc" } },
      receipts: { orderBy: [{ receiptDate: "desc" }, { createdAt: "desc" }], include: { policy: { select: { policyNumber: true } }, payment: { select: { id: true, paymentNo: true } } } },
      ownerPaidSlips: { orderBy: { createdAt: "desc" }, include: { policy: { select: { policyNumber: true } }, closedByReceipt: { select: { receiptNo: true } } } },
    },
  });
  if (!c || !canActOn(user, c.ownerId)) return null;

  const owner = await db.user.findUnique({ where: { id: c.ownerId }, select: { name: true } });
  // Renewals: everything unpaid, plus what was paid in the last 12 months.
  const renewals = c.policies
    .flatMap((p) => p.renewals.map((r) => ({ ...r, policy: p })))
    .filter((r) => r.status !== "Paid" || (r.paidOn && r.paidOn >= addDays(today, -90)))
    .filter((r) => r.status !== "Due" || r.dueDate < addDays(today, 90))
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  const active = c.policies.filter((p) => p.status === "Active");
  const numbers = c.mobiles.length ? c.mobiles.map((m) => m.number) : [c.mobile];

  // Holdings: what was invested, at what rate, until when.
  const holdings = c.policies.map((p) => ({
    ...p,
    schemeName: p.scheme?.name ?? null,
    lockIn: lockInUntil(p.startDate, p.product?.lockInMonths),
    maturity: maturityOf(p, p.product?.invoiceRule),
    amountLabel: PER_LABEL[p.frequency],
    details: [
      p.secondHolder && ["Joint account", `second holder ${p.secondHolder.name} (${p.secondHolder.cifNo})`],
      isPostal(p) && (p.secondHolder
        ? (p.firstHolderCif || p.secondHolderCif) && ["Holder CIF (post office)", `first ${p.firstHolderCif ?? "—"} · second ${p.secondHolderCif ?? "—"}`]
        : p.firstHolderCif && ["Holder CIF (post office)", p.firstHolderCif]),
      p.folioNo && ["Folio number", p.folioNo],
      p.sipDay && ["SIP date", sipDateLabel(p.sipDay)],
      p.nominee && ["Nominee", p.nominee],
      ...Object.entries((p.customValues ?? {}) as Record<string, string | number>).map(([k, v]) => [k, String(v)]),
      p.premiumPayingTermMonths && ["Premium paying term", `${p.premiumPayingTermMonths / 12} years`],
      p.bankDetailsEnc && ["Bank", bankLine(p.bankDetailsEnc)],
      p.closeReason && ["Closure reason", p.closeReason],
    ].filter(Boolean) as [string, string][],
  }));

  // Cards: insurance premium a year; investments = one-time deposits + instalments paid on RD, SSA, PPF and SIPs.
  const insurance = active.filter((p) => p.productType === "Insurance");
  const oneTime = active.filter((p) => p.frequency === "OneTime");
  const paidInstalments = c.receipts.filter((r) => r.status === "Saved" && r.policyId && active.some((p) => p.id === r.policyId && p.frequency !== "OneTime" && INVESTMENT_TYPES.includes(p.productType)));
  const nextDue = renewals.filter((r) => r.status === "Due" || r.status === "Overdue")[0] ?? null;
  const [services, directBills, messages, changes, calls, users] = await Promise.all([
    // E-Sevai entries linked by any of the customer's mobile numbers
    db.serviceTransaction.findMany({ where: { tenantId: user.tenantId, OR: [{ customerMobile: { in: numbers } }, { customerId: c.id }] }, include: { serviceType: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20 }),
    // Direct bills linked to the customer, or paid from one of their numbers (walk-in before they became a customer)
    db.directBill.findMany({ where: { tenantId: user.tenantId, OR: [{ customerId: c.id }, { payerMobile: { in: numbers } }] }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.messageLog.findMany({ where: { tenantId: user.tenantId, to: { in: numbers } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.auditLog.findMany({
      where: { tenantId: user.tenantId, OR: [{ entity: "Customer", entityId: c.id }, { entity: "Policy", entityId: { in: c.policies.map((p) => p.id) } }] } satisfies Prisma.AuditLogWhereInput,
      orderBy: { createdAt: "desc" }, take: 10,
    }),
    // Follow-ups on the customer, their renewals and their proposals (open ones also count in "calls open").
    db.call.findMany({
      where: { tenantId: user.tenantId, OR: [{ customerId: c.id }, { policy: { customerId: c.id } }, { proposal: { customerId: c.id } }] },
      include: callInclude, orderBy: { dueAt: "desc" }, take: 30,
    }),
    userNames(user.tenantId),
  ]);
  const now = new Date();
  const followUps = calls.map((call) => ({
    id: call.id, dueAt: call.dueAt, type: FOLLOWUP_TYPE[callParty(call).kind], forLabel: callParty(call).forLabel,
    owner: users.find((u) => u.id === call.ownerId)?.name ?? "—", note: call.note, outcomeNote: call.outcomeNote,
    status: call.outcome ? (call.outcome === "NoAnswer" ? "No answer – rescheduled" : OUTCOME_LABEL[call.outcome]) : call.dueAt <= now ? "Overdue" : "Open",
    open: !call.outcome,
  }));
  const nextFollowUp = followUps.filter((f) => f.open).sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())[0] ?? null;
  const activity = [
    ...messages.map((m) => ({ at: m.createdAt, text: `${m.channel} sent – ${m.template.replaceAll("_", " ")}` })),
    ...changes.map((a) => ({ at: a.createdAt, text: a.summary })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 12);

  return {
    c,
    owner,
    renewals,
    active,
    numbers,
    holdings,
    services,
    directBills,
    followUps,
    nextFollowUp,
    activity,
    cards: {
      holdings: active.length,
      sources: new Set(active.map((p) => p.partner)).size,
      yearlyPremium: insurance.length ? sum(insurance.map((p) => p.premiumAmount.times(PER_YEAR[p.frequency] || 1))) : ZERO,
      investments: sum([...oneTime.filter((p) => INVESTMENT_TYPES.includes(p.productType)).map((p) => p.premiumAmount), ...paidInstalments.map((r) => r.amount), ZERO]),
      nextDue,
    },
    oneTimeTotal: sum([...oneTime.map((p) => p.premiumAmount), ZERO]),
    regular: active.filter((p) => p.frequency !== "OneTime").map((p) => ({ amount: p.premiumAmount, frequency: p.frequency })),
    receiptNo: new Map(c.receipts.map((r) => [r.id, receiptRef(r)])), // paid bill → the customer's receipt (PAY- when paid with other dues)
    yearlyPremium: active.filter((p) => p.productType === "Insurance").map((p) => p.premiumAmount),
    unpaid: renewals.filter((r) => r.status === "Overdue" || (r.status === "Due" && r.dueDate <= addDays(today, 30))),
    slipFor: new Map(c.ownerPaidSlips.filter((s) => s.renewalItemId).map((s) => [s.renewalItemId!, s.slipNo])),
  };
}

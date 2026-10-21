import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { fmtDate, fmtDateTime, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { companyStatus, nameLookup, rdDepositable } from "@/lib/deposit-status";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { denominationText, modeText } from "@/lib/payment-options";
import { hasPermission, seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CancelReceiptForm } from "./cancel-form";
import { DepositStatusForm } from "./deposit-form";
import { ShareButton } from "../share-button";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Receipt.View");
  const { id } = await params;
  const r = await db.receipt.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { customer: true, policy: true, closedSlips: true, poDepositLine: { include: { poDeposit: true } }, payment: { select: { id: true, paymentNo: true } }, companyPayment: true, renewalItems: { select: { billNo: true, dueDate: true } } },
  });
  if (!r || !(seesAll(user.role) || r.createdById === user.id || canActOn(user, r.customer.ownerId))) notFound();
  const [account, users] = await Promise.all([
    db.account.findUnique({ where: { id: r.accountId }, select: { name: true } }),
    userNames(user.tenantId),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const cancelled = r.status === "Cancelled";
  const deposit = r.policy && !cancelled ? companyStatus(r, r.policy.partner, nameLookup(users)) : null;
  const isRd = rdDepositable(r);
  const canDeposit = !!deposit && (deposit.payable || isRd) && hasPermission(user.role, "DayBook.Create");
  const accounts = canDeposit ? await db.account.findMany({ where: { tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true }, select: { id: true, name: true }, orderBy: [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }] }) : [];

  const rows: [string, React.ReactNode][] = [
    ["Customer", `${r.customer.name} · ${r.customer.mobile}`],
    ["For", r.policy ? `${r.policy.partner} ${r.policy.productName} · ${r.policy.policyNumber}` : r.notes ?? "—"],
    ["Amount", fmtINR(r.amount)],
    ["Received by", nameOf(r.createdById)],
    ["Mode", `${modeText(r)} · into ${account?.name}`],
    ["Bill date", `${fmtDate(r.receiptDate)} · entered by ${nameOf(r.createdById)} at ${fmtDateTime(r.createdAt)}`],
    ["Transaction date", fmtDate(r.txnDate)],
  ];
  if (r.denominations) rows.push(["Cash denomination", denominationText(r.denominations)]);
  if (r.renewalItems[0]) rows.push(["Bill", `${r.renewalItems[0].billNo} · due ${fmtDate(r.renewalItems[0].dueDate)}`]);
  if (r.payment) rows.push(["Part of payment", <Link key="pay" href={`/payments/${r.payment.id}`} className="text-brand-700 hover:underline">{r.payment.paymentNo}</Link>]);
  if (r.rdStatus && r.status !== "Cancelled") rows.push(["RD status", r.poDepositLine ? `${r.rdStatus} · PO receipt ${r.poDepositLine.poDeposit.poReceiptNo}` : r.rdStatus]);
  if (deposit) rows.push(["Deposit status", <StatusBadge key="dep" tone={deposit.state === "paid" ? "green" : "orange"}>{deposit.text}</StatusBadge>]);
  if (r.closedSlips.length) rows.push(["Owner-paid slips closed", r.closedSlips.map((s) => s.slipNo).join(", ")]);
  if (r.notes && r.policy) rows.push(["Notes", r.notes]);
  if (cancelled) rows.push(["Cancelled", `${r.cancelReason} · by ${nameOf(r.cancelledById)}${r.cancelledAt ? ` at ${fmtDateTime(r.cancelledAt)}` : ""}`]);

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New receipt</Link>
      } />
      <div className="flex items-start gap-4">
        <div className="max-w-2xl flex-1 rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{r.receiptNo}</h2>
            {cancelled ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}
          </div>
          <dl className="divide-y text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-3 gap-2 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex gap-2">
            <a href={`/api/receipts/${r.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Download PDF</a>
            {!cancelled && <ShareButton kind="Receipt" id={r.id} />}
            <Link href="/receipts" className={buttonVariants({ variant: "ghost" })}>Back to receipts</Link>
          </div>
        </div>
        <div className="space-y-4">
          {canDeposit && <DepositStatusForm receiptId={r.id} company={r.policy!.partner} isRd={isRd} accounts={accounts} today={isoDate(istToday())} />}
          {hasPermission(user.role, "Receipt.Cancel") && !cancelled && !r.payment && !r.companyPaymentId && !r.poDepositLine && (
            <CancelReceiptForm receiptId={r.id} receiptNo={r.receiptNo} />
          )}
        </div>
      </div>
    </>
  );
}

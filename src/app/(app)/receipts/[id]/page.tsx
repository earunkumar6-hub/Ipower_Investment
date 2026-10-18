import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR, sum } from "@/lib/money";
import { hasPermission, seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { CancelReceiptForm } from "./cancel-form";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Receipt.View");
  const { id } = await params;
  const r = await db.receipt.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { customer: true, policy: true, closedSlips: true, poDepositLine: { include: { poDeposit: true } } },
  });
  if (!r || !(seesAll(user.role) || r.createdById === user.id || canActOn(user, r.customer.ownerId))) notFound();
  const showCommission = hasPermission(user.role, "Commission.View");
  const [account, users, commissions] = await Promise.all([
    db.account.findUnique({ where: { id: r.accountId }, select: { name: true } }),
    userNames(user.tenantId),
    showCommission ? db.commission.findMany({ where: { receiptId: r.id, status: { not: "Cancelled" } } }) : Promise.resolve([]),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const cancelled = r.status === "Cancelled";

  const rows: [string, React.ReactNode][] = [
    ["Customer", `${r.customer.name} · ${r.customer.mobile}`],
    ["For", r.policy ? `${r.policy.partner} ${r.policy.productName} · ${r.policy.policyNumber}` : r.notes ?? "—"],
    ["Amount", fmtINR(r.amount)],
    ["Mode", `${r.mode}${r.reference ? ` · ${r.reference}` : ""} · into ${account?.name}`],
    ["Date", `${fmtDate(r.receiptDate)} · entered by ${nameOf(r.createdById)} at ${fmtDateTime(r.createdAt)}`],
  ];
  if (r.rdStatus && r.status !== "Cancelled") rows.push(["RD status", r.poDepositLine ? `${r.rdStatus} · PO receipt ${r.poDepositLine.poDeposit.poReceiptNo}` : r.rdStatus]);
  if (r.closedSlips.length) rows.push(["Owner-paid slips closed", r.closedSlips.map((s) => s.slipNo).join(", ")]);
  if (showCommission && commissions.length) {
    rows.push(["Commission (expected)", `${fmtINR(sum(commissions.map((c) => c.gross)))} gross · TDS ${fmtINR(sum(commissions.map((c) => c.tds)))}`]);
  }
  if (r.notes && r.policy) rows.push(["Notes", r.notes]);
  if (cancelled) rows.push(["Cancelled", `${r.cancelReason} · by ${nameOf(r.cancelledById)}${r.cancelledAt ? ` at ${fmtDateTime(r.cancelledAt)}` : ""}`]);

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-blue-600 hover:bg-blue-700")}>New receipt</Link>
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
            <Link href="/receipts" className={buttonVariants({ variant: "ghost" })}>Back to receipts</Link>
          </div>
        </div>
        {hasPermission(user.role, "Receipt.Cancel") && !cancelled && (
          <CancelReceiptForm receiptId={r.id} receiptNo={r.receiptNo} />
        )}
      </div>
    </>
  );
}

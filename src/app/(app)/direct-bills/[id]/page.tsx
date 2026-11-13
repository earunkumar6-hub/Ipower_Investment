import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { accountLabel } from "@/lib/accounts";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { denominationText, modeText } from "@/lib/payment-options";
import { hasPermission, seesAllRecords } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { ShareButton } from "../../receipts/share-button";
import { CancelDirectBillForm } from "./cancel-form";

export default async function DirectBillPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Receipt.View");
  const { id } = await params;
  const b = await db.directBill.findFirst({ where: { id, tenantId: user.tenantId }, include: { customer: { select: { id: true, name: true } } } });
  if (!b || !(seesAllRecords(user.role) || b.createdById === user.id)) notFound();
  const [account, users] = await Promise.all([
    db.account.findUnique({ where: { id: b.accountId }, select: { type: true, name: true, bankName: true, last4: true } }),
    userNames(user.tenantId),
  ]);
  const nameOf = nameLookup(users);
  const cancelled = b.status === "Cancelled";

  const rows: [string, React.ReactNode][] = [
    ["Paid by", `${b.payerName} · ${b.payerMobile}`],
    ["Customer", b.customer ? <Link key="c" href={`/customers/${b.customer.id}`} className="text-brand-700 hover:underline">{b.customer.name}</Link> : "Not a customer (no customer has this mobile)"],
    ["Purpose", b.purpose],
    ["Amount", fmtINR(b.amount)],
    ["Mode", `${modeText(b)} · into ${account ? accountLabel(account) : "—"}`],
    ["Bill date", `${fmtDate(b.billDate)} · entered at ${fmtDateTime(b.createdAt)}`],
    ["Received by", nameOf(b.createdById)],
  ];
  if (b.denominations) rows.push(["Cash denomination", denominationText(b.denominations)]);
  if (cancelled) rows.push(["Cancelled", `${b.cancelReason} · by ${nameOf(b.cancelledById)}${b.cancelledAt ? `, ${fmtDateTime(b.cancelledAt)}` : ""}`]);

  return (
    <>
      <PageHeader title={`Direct bill ${b.billNo}`} user={user} />
      <div className="flex items-start gap-4">
        <div className="max-w-2xl flex-1 rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{b.billNo}</h2>
            {cancelled ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}
          </div>
          <dl className="divide-y text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-3 gap-2 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2">{v}</dd></div>
            ))}
          </dl>
          <div className="mt-4 flex gap-2">
            <a href={`/api/direct-bills/${b.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Download PDF</a>
            {!cancelled && <ShareButton kind="DirectBill" id={b.id} />}
            <Link href="/direct-bills" className={buttonVariants({ variant: "ghost" })}>Back to direct bills</Link>
          </div>
        </div>
        {hasPermission(user.role, "Receipt.Cancel") && !cancelled && <CancelDirectBillForm billId={b.id} billNo={b.billNo} />}
      </div>
    </>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { denominationText, modeText } from "@/lib/payment-options";
import { hasPermission, seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { dueLabel } from "@/lib/payment-lines";
import { CancelPaymentForm } from "./cancel-form";
import { ShareButton } from "../../receipts/share-button";

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Receipt.View");
  const { id } = await params;
  const p = await db.payment.findFirst({
    where: { id, tenantId: user.tenantId },
    include: {
      customer: true,
      receipts: { orderBy: { receiptNo: "asc" }, include: { policy: true } },
    },
  });
  if (!p || !(seesAll(user.role) || p.createdById === user.id || canActOn(user, p.customer.ownerId))) notFound();
  const [account, users, items] = await Promise.all([
    db.account.findUnique({ where: { id: p.receipts[0]?.accountId ?? "" }, select: { name: true } }),
    userNames(user.tenantId),
    db.renewalItem.findMany({ where: { id: { in: p.receipts.map((r) => r.renewalItemId).filter((x): x is string => !!x) } } }),
  ]);
  const nameOf = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "—";
  const cancelled = p.status === "Cancelled";

  const rows: [string, React.ReactNode][] = [
    ["Customer", `${p.customer.name} · ${p.customer.mobile}`],
    ["Amount", fmtINR(p.amount)],
    ["Mode", `${modeText(p)} · into ${account?.name ?? "—"}`],
    ["Received by", nameOf(p.createdById)],
    ["Bill date", `${fmtDate(p.receiptDate)} · entered by ${nameOf(p.createdById)} at ${fmtDateTime(p.createdAt)}`],
    ["Transaction date", fmtDate(p.txnDate)],
  ];
  if (p.denominations) rows.push(["Cash denomination", denominationText(p.denominations)]);
  if (p.notes) rows.push(["Notes", p.notes]);
  if (cancelled) rows.push(["Cancelled", `${p.cancelReason} · by ${nameOf(p.cancelledById)}${p.cancelledAt ? ` at ${fmtDateTime(p.cancelledAt)}` : ""}`]);

  return (
    <>
      <PageHeader title="Receipts" user={user} actions={
        <Link href="/receipts/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New receipt</Link>
      } />
      <div className="flex items-start gap-4">
        <div className="max-w-3xl flex-1 rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Payment {p.paymentNo}</h2>
            {cancelled ? <StatusBadge tone="slate">Cancelled</StatusBadge> : <StatusBadge tone="green">Saved</StatusBadge>}
          </div>
          <dl className="divide-y text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-3 gap-2 py-2"><dt className="text-muted-foreground">{k}</dt><dd className="col-span-2">{v}</dd></div>
            ))}
          </dl>
          <h3 className="mt-4 mb-1 text-sm font-medium">Dues paid ({p.receipts.length})</h3>
          <Table>
            <TableHeader>
              <TableRow><TableHead>Receipt no.</TableHead><TableHead>Bill</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>RD status</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {p.receipts.map((r) => (
                <TableRow key={r.id} className={cn(r.status === "Cancelled" && "text-muted-foreground")}>
                  <TableCell><Link href={`/receipts/${r.id}`} className="text-brand-700 hover:underline">{r.receiptNo}</Link></TableCell>
                  <TableCell className="text-muted-foreground">{items.find((i) => i.id === r.renewalItemId)?.billNo ?? "—"}</TableCell>
                  <TableCell>{r.policy ? `${r.policy.partner} ${r.policy.productName} · ${r.policy.policyNumber}` : "—"}</TableCell>
                  <TableCell>{dueLabel(r, items)}</TableCell>
                  <TableCell className="text-right">{fmtINR(r.amount)}</TableCell>
                  <TableCell>{r.status === "Cancelled" ? "Cancelled" : r.rdStatus ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex gap-2">
            <a href={`/api/payments/${p.id}/pdf`} className={buttonVariants({ variant: "outline" })}>Download PDF</a>
            {!cancelled && <ShareButton kind="Payment" id={p.id} />}
            <Link href="/receipts" className={buttonVariants({ variant: "ghost" })}>Back to receipts</Link>
          </div>
        </div>
        {hasPermission(user.role, "Receipt.Cancel") && !cancelled && <CancelPaymentForm paymentId={p.id} paymentNo={p.paymentNo} lines={p.receipts.length} />}
      </div>
    </>
  );
}

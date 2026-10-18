import Link from "next/link";
import { notFound } from "next/navigation";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { HOLDING_KIND as KIND, loadCustomer360 } from "@/lib/customer-360";
import { fmtDate } from "@/lib/dates";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

const RENEWAL_TONE: Record<string, Tone> = { Due: "orange", Overdue: "red", Paid: "green", Lapsed: "slate" };
const SLIP: Record<string, [string, Tone]> = {
  CustomerOwes: ["Owner paid – customer owes", "indigo"], CollectedReturnToOwner: ["Collected – return to owner", "orange"], Settled: ["Settled", "green"], Cancelled: ["Cancelled", "slate"],
};
const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/** Customer 360: every holding, renewal, receipt and owner-paid slip for one person. */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Policy.View");
  const data = await loadCustomer360(user, (await params).id);
  if (!data) notFound();
  const { c, owner, renewals, receiptNo, active, yearlyPremium, unpaid, slipFor } = data;

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} actions={
        <>
          <ExportButton report="customer" user={user} params={{ id: c.id }} />
          <Link href={`/quotations/new?customerId=${c.id}`} className={buttonVariants({ variant: "outline" })}>New quotation</Link>
          <Link href={`/receipts/new?customerId=${c.id}`} className={cn(buttonVariants(), "bg-blue-600 hover:bg-blue-700")}>Generate receipt</Link>
        </>
      } />
      <div className="mb-4 flex items-start justify-between rounded-xl border bg-white p-4">
        <div>
          <h2 className="text-xl font-semibold">{c.name}</h2>
          <p className="text-sm text-muted-foreground">
            {c.mobile}{c.email && ` · ${c.email}`}{c.address && ` · ${c.address}`} · Owner: {owner?.name}
          </p>
          <p className="mt-1 text-sm">
            PAN {c.panMasked ?? <span className="text-muted-foreground">not collected</span>} · Aadhaar {c.aadhaarLast4 ? `XXXX-XXXX-${c.aadhaarLast4}` : <span className="text-muted-foreground">not collected</span>}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatCard title="Active holdings" value={String(active.length)} />
          <StatCard title="Insurance premium / year" value={fmtINR(yearlyPremium.length ? sum(yearlyPremium) : ZERO)} />
          <StatCard title="Due in 30 days" value={fmtINR(unpaid.length ? sum(unpaid.map((r) => r.premiumAmount)) : ZERO)} sub={`${unpaid.filter((r) => r.status === "Overdue").length} overdue`} />
        </div>
      </div>

      <Section title="Holdings">
        <Table>
          <TableHeader><TableRow><TableHead>Product</TableHead><TableHead>Partner · plan</TableHead><TableHead>Policy / folio / account</TableHead><TableHead className="text-right">Premium / instalment</TableHead><TableHead>Frequency</TableHead><TableHead>Since</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {c.policies.map((p) => (
              <TableRow key={p.id}>
                <TableCell>{KIND[p.productType]}</TableCell>
                <TableCell>{p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} · ${p.productName}` : p.productName}{p.sumAssured && <span className="text-muted-foreground"> · cover {fmtINR(p.sumAssured)}</span>}</TableCell>
                <TableCell>{p.policyNumber}</TableCell>
                <TableCell className="text-right">{fmtINR(p.premiumAmount)}</TableCell>
                <TableCell>{p.frequency === "OneTime" ? "One-time deposit" : p.frequency}</TableCell>
                <TableCell>{fmtDate(p.startDate)}</TableCell>
                <TableCell><StatusBadge tone={p.status === "Active" ? "green" : "slate"}>{p.status}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Renewals and instalments">
          <Table>
            <TableHeader><TableRow><TableHead>Due</TableHead><TableHead>Policy / account</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Paid · receipt</TableHead></TableRow></TableHeader>
            <TableBody>
              {renewals.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.policy.productType === "PoRd" ? monthLabel(r.dueDate) : fmtDate(r.dueDate)}</TableCell>
                  <TableCell>{r.policy.policyNumber}</TableCell>
                  <TableCell className="text-right">{fmtINR(r.premiumAmount)}</TableCell>
                  <TableCell><StatusBadge tone={RENEWAL_TONE[r.status]}>{r.status}</StatusBadge></TableCell>
                  <TableCell className="text-sm">
                    {r.paidOn ? fmtDate(r.paidOn) : "—"}
                    {r.paidReceiptId && <> · <Link href={`/receipts/${r.paidReceiptId}`} className="text-blue-700 hover:underline">{receiptNo.get(r.paidReceiptId)}</Link></>}
                    {r.status === "Paid" && !r.paidReceiptId && <span className="text-muted-foreground"> · {slipFor.has(r.id) ? `owner paid · ${slipFor.get(r.id)}` : "before this system"}</span>}
                  </TableCell>
                </TableRow>
              ))}
              {renewals.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No renewals.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </Section>
        <div className="space-y-4">
          <Section title="Receipts">
            <Table>
              <TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Date</TableHead><TableHead>For</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.receipts.map((r) => (
                  <TableRow key={r.id} className={cn(r.status === "Cancelled" && "text-muted-foreground")}>
                    <TableCell><Link href={`/receipts/${r.id}`} className="text-blue-700 hover:underline">{r.receiptNo}</Link></TableCell>
                    <TableCell>{fmtDate(r.receiptDate)}</TableCell>
                    <TableCell>{r.policy?.policyNumber ?? r.notes}{r.ownerPaid && " (owner-paid)"}</TableCell>
                    <TableCell className="text-right">{fmtINR(r.amount)} · {r.mode}</TableCell>
                    <TableCell><StatusBadge tone={r.status === "Cancelled" ? "slate" : "green"}>{r.status}</StatusBadge></TableCell>
                  </TableRow>
                ))}
                {c.receipts.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No receipts yet.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Section>
          <Section title="Owner-paid slips">
            <Table>
              <TableHeader><TableRow><TableHead>Slip</TableHead><TableHead>RD account</TableHead><TableHead>Month</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {c.ownerPaidSlips.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{s.slipNo}</TableCell><TableCell>{s.policy.policyNumber}</TableCell><TableCell>{monthLabel(s.month)}</TableCell>
                    <TableCell className="text-right">{fmtINR(s.amount)}</TableCell>
                    <TableCell><StatusBadge tone={SLIP[s.status][1]}>{SLIP[s.status][0]}</StatusBadge>{s.closedByReceipt && <span className="ml-1 text-xs text-muted-foreground">{s.closedByReceipt.receiptNo}</span>}</TableCell>
                  </TableRow>
                ))}
                {c.ownerPaidSlips.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">None.</TableCell></TableRow>}
              </TableBody>
            </Table>
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-xl border bg-white p-4">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </div>
  );
}

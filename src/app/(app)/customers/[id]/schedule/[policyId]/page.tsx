import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canWorkOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { billEnd, fullSchedule, maturityOf } from "@/lib/policies";
import { fmtTenure, INVOICE_RULE_LABEL, payModeLabel, sipDateLabel } from "@/lib/products";
import { refreshOverdue } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";

const TONE: Record<string, Tone> = { Paid: "green", "Paid at start": "green", "Not recorded": "slate", Due: "orange", Overdue: "red", Upcoming: "slate", Stopped: "slate", Lapsed: "slate", "—": "slate" };

/** A policy's renewal schedule: first payment, every renewal (paid / due / upcoming) and the maturity. */
export default async function SchedulePage({ params }: { params: Promise<{ id: string; policyId: string }> }) {
  const user = await requirePermission("Policy.View");
  const { id, policyId } = await params;
  const today = istToday();
  await refreshOverdue(user.tenantId, today);
  const p = await db.policy.findFirst({
    where: { id: policyId, customerId: id, tenantId: user.tenantId },
    include: { customer: { select: { id: true, name: true } }, product: { select: { invoiceRule: true } }, scheme: { select: { name: true } }, renewals: true },
  });
  if (!p || !canWorkOn(user, p.ownerId)) notFound();
  const rule = p.product?.invoiceRule;
  const rows = fullSchedule(p, rule, p.renewals, today);
  const end = billEnd(p, rule);
  const maturity = maturityOf(p, rule);
  const renewals = rows.filter((r) => r.type === "Renewal").length;

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} />
      <div className="mb-2 text-sm"><Link href={`/customers/${p.customer.id}`} className="text-brand-700 hover:underline">← {p.customer.name}</Link></div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Renewal schedule · {p.partner} {p.productName}{p.scheme && ` · ${p.scheme.name}`} · {p.policyNumber}</h2>
        <dl className="mt-2 mb-4 grid grid-cols-5 gap-3 text-sm">
          <div><dt className="text-xs text-muted-foreground">Pay mode</dt><dd>{payModeLabel(p.frequency, p.productType === "MutualFund")}{p.sipDay && ` · SIP date ${sipDateLabel(p.sipDay)}`}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Term</dt><dd>{p.termMonths ? fmtTenure(p.termMonths) : "Open-ended"}{rule === "UntilClosed" && " (renewable)"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Start date</dt><dd>{fmtDate(p.startDate)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Amount</dt><dd>{fmtINR(p.premiumAmount)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Bills</dt><dd>{rule ? INVOICE_RULE_LABEL[rule] : p.frequency === "OneTime" ? "None – one-time" : "Per pay mode until the term ends"}</dd></div>
        </dl>
        <Table>
          <TableHeader><TableRow><TableHead className="w-12">#</TableHead><TableHead>Due date</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i} className={r.status === "Not recorded" ? "text-muted-foreground" : undefined}>
                <TableCell>{r.n ?? "—"}</TableCell>
                <TableCell>{fmtDate(r.date)}</TableCell>
                <TableCell>{r.type}</TableCell>
                <TableCell className="text-right">{r.amount ? fmtINR(r.amount) : "—"}</TableCell>
                <TableCell><StatusBadge tone={TONE[r.status] ?? "slate"}>{r.status === "—" ? (r.date <= today ? "Reached" : "Upcoming") : r.status}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          &quot;Not recorded&quot; = paid before this system was used. The first payment is taken when the policy starts; renewals are the payments after it ({renewals} {end ? "in total" : "in the next 12 months – renews until closed"}).
          {end && ` Bills stop before ${fmtDate(end)}.`}{maturity && ` ${p.frequency === "OneTime" ? "Matures" : "Expires / matures"} on ${fmtDate(maturity)}; a reminder shows on Renewals a month before.`}
        </p>
      </div>
    </>
  );
}

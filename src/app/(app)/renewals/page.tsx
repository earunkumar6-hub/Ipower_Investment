import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { RENEWAL_PRODUCTS, RENEWAL_TABS as TABS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { loadRenewals, renewalFilterOptions, renewalStatus } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { RenewalFilters } from "./renewal-filters";
import { MaturityRowActions, RenewalRowActions } from "./row-actions";

type Search = { tab?: string; product?: string; company?: string; scheme?: string; within?: string };

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Renewal.View");
  const sp = await searchParams;
  const today = istToday();
  const { tab, product, company, scheme, within, rows, total } = await loadRenewals(user, sp, today, 200);
  const options = await renewalFilterOptions(user, product, company);
  const receiptNos = new Map(
    (await db.receipt.findMany({ where: { id: { in: rows.map((i) => i.paidReceiptId).filter((x): x is string => !!x) } }, select: { id: true, receiptNo: true } }))
      .map((r) => [r.id, r.receiptNo]),
  );
  // Tabs keep the filter.
  const filter = { ...(product !== "all" && { product }), ...(company && { company }), ...(scheme && { scheme }), ...(sp.within && { within: sp.within }) };
  const link = (t: string) => `/renewals?${new URLSearchParams({ tab: t, ...filter })}`;
  const maturities = rows.filter((r) => r.kind === "maturity").length;

  return (
    <>
      <PageHeader title="Renewals" user={user} actions={<ExportButton report="renewals" user={user} params={{ tab, ...filter }} />} />
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b">
          <div className="flex gap-1">
            {TABS.map(([k, label]) => (
              <Link key={k} href={link(k)}
                className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === k ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {label}
              </Link>
            ))}
          </div>
          <RenewalFilters tab={tab} within={sp.within} product={product} company={company} scheme={scheme}
            products={RENEWAL_PRODUCTS} companies={options.companies} schemes={options.schemes} />
        </div>
        <p className="mb-2 text-sm text-muted-foreground">
          {rows.length - maturities} {tab === "due" ? `due in the next ${within} days` : tab === "overdue" ? "overdue" : "paid in the last 30 days"} · {fmtINR(total)}
          {maturities > 0 && ` · ${maturities} post office ${maturities === 1 ? "deposit" : "deposits"} ${tab === "due" ? "maturing" : "matured, not yet closed"}`}
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
              <TableHead>{tab === "paid" ? "Paid · receipt" : "Last reminder"}</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => {
              const p = i.policy;
              const [status, tone] = renewalStatus(i, today);
              const maturity = i.kind === "maturity";
              return (
                <TableRow key={i.id}>
                  <TableCell><Link href={`/customers/${p.customer.id}`} className="text-blue-700 hover:underline">{p.customer.name}</Link></TableCell>
                  <TableCell>{p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`}</TableCell>
                  <TableCell>{p.policyNumber}</TableCell>
                  <TableCell>{fmtDate(i.date)}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.amount)}{maturity && <div className="text-xs text-muted-foreground">deposited</div>}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{status}</StatusBadge></TableCell>
                  <TableCell className="text-sm">
                    {tab === "paid"
                      ? <>{i.paidOn && fmtDate(i.paidOn)} · {i.paidReceiptId ? <Link href={`/receipts/${i.paidReceiptId}`} className="text-blue-700 hover:underline">{receiptNos.get(i.paidReceiptId)}</Link> : "owner paid"}</>
                      : i.lastReminderAt ? fmtDateTime(i.lastReminderAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {maturity ? tab === "overdue" && <MaturityRowActions policyId={p.id} />
                      : tab !== "paid" && <RenewalRowActions renewalItemId={i.id} customerId={p.customer.id} />}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Reminders are mocked: &quot;Send reminder&quot; writes the WhatsApp message to Sent messages instead of sending it.
          One-time post office deposits (TD, MIS, SCSS, NSC, KVP) show here from their maturity date window; the amount is what was deposited and is not in the total.
        </p>
      </div>
    </>
  );
}

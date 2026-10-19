import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtDateTime, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { PAID_TO, RENEWAL_PRODUCTS, RENEWAL_TABS as TABS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { loadRenewals, renewalFilterOptions, renewalStatus } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PaidTable, type PaidRow } from "./paid-table";
import { RenewalFilters } from "./renewal-filters";
import { MaturityRowActions, RenewalRowActions } from "./row-actions";

type Search = { tab?: string; product?: string; company?: string; scheme?: string; paidto?: string; within?: string };

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Renewal.View");
  const sp = await searchParams;
  const today = istToday();
  const { tab, product, company, scheme, paidTo, within, rows, total } = await loadRenewals(user, sp, today, 200);
  const options = await renewalFilterOptions(user, product, company);
  const canPay = tab === "paid" && hasPermission(user.role, "DayBook.Create");
  const accounts = canPay ? await db.account.findMany({ where: { tenantId: user.tenantId, type: { in: ["Cash", "Bank"] } }, select: { id: true, name: true }, orderBy: { type: "asc" } }) : [];
  // Tabs keep the filter.
  const filter = { ...(product !== "all" && { product }), ...(company && { company }), ...(scheme && { scheme }), ...(paidTo !== "all" && { paidto: paidTo }), ...(sp.within && { within: sp.within }) };
  const paidRows: PaidRow[] = tab === "paid" ? rows.map((i) => ({
    id: i.id, customerId: i.policy.customer.id, customer: i.policy.customer.name,
    product: i.policy.productType === "PoRd" ? "Post office RD" : `${i.policy.partner} ${i.policy.productName}`,
    policyNumber: i.policy.policyNumber, due: fmtDate(i.date), amount: fmtINR(i.amount), paise: Math.round(Number(i.amount) * 100),
    paidOn: i.paidOn ? fmtDate(i.paidOn) : "", receiptId: i.paidReceiptId, receiptNo: i.paidReceiptNo, collectedBy: i.collectedBy, company: i.policy.partner,
    status: i.companyStatus!,
  })) : [];
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
                className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {label}
              </Link>
            ))}
          </div>
          <RenewalFilters tab={tab} within={sp.within} product={product} company={company} scheme={scheme} paidTo={paidTo}
            products={RENEWAL_PRODUCTS} paidToOptions={PAID_TO} companies={options.companies} schemes={options.schemes} />
        </div>
        <p className="mb-2 text-sm text-muted-foreground">
          {rows.length - maturities} {tab === "due" ? `due in the next ${within} days` : tab === "overdue" ? "overdue"
            : paidTo === "pending" ? "collected, not yet paid to Post office / insurer" : "paid in the last 30 days"} · {fmtINR(total)}
          {maturities > 0 && ` · ${maturities} post office ${maturities === 1 ? "deposit" : "deposits"} ${tab === "due" ? "maturing" : "matured, not yet closed"}`}
        </p>
        {tab === "paid" ? <PaidTable rows={paidRows} accounts={accounts} today={isoDate(today)} canPay={canPay} /> : <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead>
              <TableHead>Last reminder</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((i) => {
              const p = i.policy;
              const [status, tone] = renewalStatus(i, today);
              const maturity = i.kind === "maturity";
              return (
                <TableRow key={i.id}>
                  <TableCell><Link href={`/customers/${p.customer.id}`} className="text-brand-700 hover:underline">{p.customer.name}</Link></TableCell>
                  <TableCell>{p.productType === "PoRd" ? "Post office RD" : `${p.partner} ${p.productName}`}</TableCell>
                  <TableCell>{p.policyNumber}</TableCell>
                  <TableCell>{fmtDate(i.date)}</TableCell>
                  <TableCell className="text-right">{fmtINR(i.amount)}{maturity && <div className="text-xs text-muted-foreground">deposited</div>}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{status}</StatusBadge></TableCell>
                  <TableCell className="text-sm">{i.lastReminderAt ? fmtDateTime(i.lastReminderAt) : "—"}</TableCell>
                  <TableCell className="text-right">
                    {maturity ? tab === "overdue" && <MaturityRowActions policyId={p.id} />
                      : <RenewalRowActions renewalItemId={i.id} customerId={p.customer.id} />}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
          </TableBody>
        </Table>}
        <p className="mt-3 text-xs text-muted-foreground">
          Reminders are mocked: &quot;Send reminder&quot; writes the WhatsApp message to Sent messages instead of sending it.
          One-time post office deposits (TD, MIS, SCSS, NSC, KVP) show here from their maturity date window; the amount is what was deposited and is not in the total.
        </p>
      </div>
    </>
  );
}

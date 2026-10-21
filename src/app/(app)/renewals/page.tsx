import { FileSpreadsheet } from "lucide-react";
import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { PAID_TO, RANGE_PICKS, rangeLabel, RENEWAL_PRODUCTS, RENEWAL_TABS as TABS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { loadRenewals, renewalCards, renewalFilterOptions, renewalStatus } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PaidTable, type PaidRow } from "./paid-table";
import { RenewalFilters } from "./renewal-filters";
import { MaturityRowActions, RenewalRowActions } from "./row-actions";

type Search = { tab?: string; product?: string; company?: string; scheme?: string; paidto?: string; within?: string; range?: string; from?: string; to?: string };

const dayShort = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Renewal.View");
  const sp = await searchParams;
  const today = istToday();
  const r = await loadRenewals(user, sp, today, 200);
  const { tab, product, company, scheme, paidTo, range, rows, customers, total } = r;
  const [options, cards] = await Promise.all([renewalFilterOptions(user, product, company), renewalCards(user.tenantId, r.policyWhere, today)]);
  const canPay = tab === "paid" && hasPermission(user.role, "DayBook.Create");
  const accounts = canPay ? await db.account.findMany({ where: { tenantId: user.tenantId, type: { in: ["Cash", "Bank"] }, active: true }, select: { id: true, name: true, type: true }, orderBy: [{ type: "asc" }, { isDefault: "desc" }, { name: "asc" }] }) : [];
  // Tabs keep the product filter; each tab has its own default date range.
  const filter = { ...(product !== "all" && { product }), ...(company && { company }), ...(scheme && { scheme }) };
  const rangeParams = range?.pick === "custom" ? { from: isoDate(range.from), to: isoDate(range.to) } : range && range.pick !== "within" && sp.range ? { range: range.pick } : sp.within ? { within: sp.within } : {};
  const paidRows: PaidRow[] = tab === "paid" ? rows.map((i) => ({
    id: i.id, customerId: i.policy.customer.id, customer: i.policy.customer.name,
    product: i.policy.productType === "PoRd" ? "Post office RD" : `${i.policy.partner} ${i.policy.productName}`,
    policyNumber: i.policy.policyNumber, due: fmtDate(i.date), amount: fmtINR(i.amount), paise: Math.round(Number(i.amount) * 100),
    paidOn: i.paidOn ? fmtDate(i.paidOn) : "", receiptId: i.paidReceiptId, receiptNo: i.paidReceiptNo, collectedBy: i.collectedBy, company: i.policy.partner,
    status: i.companyStatus!,
  })) : [];
  const link = (t: string) => `/renewals?${new URLSearchParams({ tab: t, ...filter })}`;
  const maturities = rows.filter((x) => x.kind === "maturity").length;
  const instalments = rows.length - maturities;
  const summary = tab === "customers" ? `${customers.length} customers · ${fmtINR(total)} overdue`
    : tab === "notrenewed" ? `${rows.length} not renewed · ${rangeLabel(range)}`
    : `${instalments} ${tab === "due" ? "due" : tab === "overdue" ? "overdue" : paidTo === "pending" ? "collected, not yet paid to Post office / insurer" : "paid"} · ${tab === "paid" && paidTo === "pending" ? "" : `${rangeLabel(range)} · `}${fmtINR(total)}`
      + (maturities ? ` · ${maturities} maturit${maturities === 1 ? "y" : "ies"} ${tab === "due" ? "coming up" : "not yet closed"}` : "");

  return (
    <>
      <PageHeader title="Renewals" user={user} actions={<>
        {hasPermission(user.role, "Report.Export") && (
          <a href="/api/export/renewal-month" download className={buttonVariants({ variant: "outline" })}><FileSpreadsheet className="text-green-700" />Download renewal Excel</a>
        )}
        <ExportButton report="renewals" user={user} params={{ tab, ...filter, ...rangeParams, ...(paidTo !== "all" && { paidto: paidTo }) }} />
      </>} />
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard title="Due this month" value={String(cards.due.count)} sub={fmtINR(cards.due.amount)} href={`/renewals?tab=due&range=month`} />
        <StatCard title="Paid" value={String(cards.paid.count)} sub={fmtINR(cards.paid.amount)} href={`/renewals?tab=paid&range=month`} />
        <StatCard title="Not paid" value={String(cards.notPaid.count)} sub={fmtINR(cards.notPaid.amount)} alert={cards.notPaid.count > 0} />
        <StatCard title="Not renewed (lapsed / matured)" value={String(cards.notRenewed)} sub="Follow up or close" href="/renewals?tab=notrenewed" />
      </div>
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 space-y-2 border-b">
          <div className="flex gap-1">
            {TABS.map(([k, label]) => (
              <Link key={k} href={link(k)}
                className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
                {label}
              </Link>
            ))}
          </div>
          <RenewalFilters tab={tab} product={product} company={company} scheme={scheme} paidTo={paidTo}
            range={range && { pick: range.pick, from: isoDate(range.from), to: isoDate(range.to) }} showRange={tab !== "customers" && !(tab === "paid" && paidTo === "pending")}
            products={RENEWAL_PRODUCTS} paidToOptions={PAID_TO} rangePicks={RANGE_PICKS} companies={options.companies} schemes={options.schemes} />
        </div>
        <p className="mb-2 text-sm text-muted-foreground">{summary}</p>

        {tab === "paid" && <PaidTable rows={paidRows} accounts={accounts} today={isoDate(today)} canPay={canPay} />}

        {(tab === "due" || tab === "overdue") && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due date</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead>{tab === "overdue" ? "Overdue" : "Status"}</TableHead>
                <TableHead>Reminders sent</TableHead><TableHead />
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
                    <TableCell className="max-w-48 whitespace-normal">{p.productType === "PoRd" ? "Post office RD" : p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}</TableCell>
                    <TableCell><Link href={`/customers/${p.customer.id}/schedule/${p.id}`} className="hover:underline" title="View schedule">{p.policyNumber}</Link></TableCell>
                    <TableCell>{fmtDate(i.date)}{maturity && <div className="text-xs text-muted-foreground">maturity</div>}</TableCell>
                    <TableCell className="text-right">{fmtINR(i.amount)}{maturity && <div className="text-xs text-muted-foreground">{p.frequency === "OneTime" ? "deposited" : "instalment"}</div>}</TableCell>
                    <TableCell><StatusBadge tone={tone}>{status}</StatusBadge></TableCell>
                    <TableCell className="text-sm">{i.reminderCount ? `${i.reminderCount}${i.lastReminderAt ? ` (last ${dayShort(i.lastReminderAt)})` : ""}` : "—"}</TableCell>
                    <TableCell className="w-0 text-right">
                      {maturity ? <MaturityRowActions policyId={p.id} matured={tab === "overdue"} />
                        : <RenewalRowActions renewalItemId={i.id} customerId={p.customer.id} overdue={tab === "overdue"} />}
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}

        {tab === "notrenewed" && (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Date</TableHead><TableHead className="text-right">Premium</TableHead><TableHead>Status</TableHead><TableHead>Reason</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((i) => {
                const p = i.policy;
                const [status, tone] = renewalStatus(i, today);
                return (
                  <TableRow key={i.id}>
                    <TableCell>{p.customer.name}</TableCell>
                    <TableCell>{p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}</TableCell>
                    <TableCell>{p.policyNumber}</TableCell>
                    <TableCell>{fmtDate(i.date)}</TableCell>
                    <TableCell className="text-right">{fmtINR(i.amount)}</TableCell>
                    <TableCell><StatusBadge tone={tone}>{status}</StatusBadge></TableCell>
                    <TableCell className="max-w-56 truncate" title={p.closeReason ?? undefined}>{p.closeReason ?? "—"}</TableCell>
                    <TableCell className="text-right"><Link href={`/customers/${p.customer.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Open customer</Link></TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing lapsed or matured in this period.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}

        {tab === "customers" && (
          <Table>
            <TableHeader>
              <TableRow><TableHead>Customer</TableHead><TableHead>Policies</TableHead><TableHead className="text-right">Due this month</TableHead><TableHead className="text-right">Paid this year</TableHead><TableHead className="text-right">Overdue</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {customers.map((c) => (
                <TableRow key={c.customer.id}>
                  <TableCell>{c.customer.name}</TableCell>
                  <TableCell className="max-w-80 whitespace-normal text-xs">{c.policies.join(", ")}</TableCell>
                  <TableCell className="text-right">{fmtINR(c.dueThisMonth)}</TableCell>
                  <TableCell className="text-right">{fmtINR(c.paidThisYear)}</TableCell>
                  <TableCell className={cn("text-right", (c.overdue.gt(0) || c.ownerPaidOwed.gt(0)) && "font-medium text-destructive")}>
                    {fmtINR(c.overdue)}{c.ownerPaidOwed.gt(0) && <div className="text-xs">+ {fmtINR(c.ownerPaidOwed)} owner-paid</div>}
                  </TableCell>
                  <TableCell className="text-right"><Link href={`/customers/${c.customer.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>Open customer</Link></TableCell>
                </TableRow>
              ))}
              {customers.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No customers with active policies for this filter.</TableCell></TableRow>}
            </TableBody>
          </Table>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Reminders are mocked: &quot;Send reminder&quot; writes the WhatsApp message to Sent messages instead of sending it. Maturities show from a month before for every scheme with a maturity date (health renews until closed); their amount is not in the total.
          Click a policy number to see its full schedule.
        </p>
      </div>
    </>
  );
}

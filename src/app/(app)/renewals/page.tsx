import Link from "next/link";
import { DownloadMenu } from "@/components/download-menu";
import { Pager } from "@/components/pager";
import { exportLinks } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, isoDate, istDate, istToday } from "@/lib/dates";
import { PAID_TO, RANGE_PICKS, rangeLabel, RENEWAL_PRODUCTS, RENEWAL_TABS as TABS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { loadRenewals, renewalCards, renewalFilterOptions, renewalStatus } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { PaidTable, type PaidRow } from "./paid-table";
import { RenewalFilters } from "./renewal-filters";
import { PoCheck, PoCheckAll, PoSelection, type TickItem } from "./po-select";
import { MaturityRowActions, RenewalRowActions } from "./row-actions";
import { ReminderHistory } from "./reminder-history";
import { PolicyManageButton } from "../customers/[id]/policy-manage";

type Search = { tab?: string; product?: string; company?: string; scheme?: string; paidto?: string; within?: string; range?: string; from?: string; to?: string; page?: string };

const PAGE_SIZE = 50;

const dayShort = (d: Date) => fmtDate(istDate(d));

export default async function RenewalsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Renewal.View");
  const sp = await searchParams;
  const today = istToday();
  // 50 per page (D-04): the count and total in the summary cover every matching bill.
  const pageNo = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);
  const r = await loadRenewals(user, sp, today, PAGE_SIZE, (pageNo - 1) * PAGE_SIZE);
  const { tab, product, company, scheme, paidTo, range, rows, customers, total, count } = r;
  const [options, cards] = await Promise.all([renewalFilterOptions(user, product, company), renewalCards(user.tenantId, r.policyWhere, today)]);
  // Tabs keep the product filter; each tab has its own default date range.
  const filter = { ...(product !== "all" && { product }), ...(company && { company }), ...(scheme && { scheme }) };
  const rangeParams = range?.pick === "custom" ? { from: isoDate(range.from), to: isoDate(range.to) } : range && range.pick !== "within" && sp.range ? { range: range.pick } : sp.within ? { within: sp.within } : {};
  const paidRows: PaidRow[] = tab === "paid" ? rows.map((i) => ({
    id: i.id, customerId: i.policy.customer.id, customer: i.policy.customer.name,
    product: i.policy.productType === "PoRd" ? "Post office RD" : `${i.policy.partner} ${i.policy.productName}`,
    policyNumber: i.policy.policyNumber, due: fmtDate(i.date), amount: fmtINR(i.amount), paise: Math.round(Number(i.amount) * 100),
    paidOn: i.paidOn ? fmtDate(i.paidOn) : "", receiptId: i.paidReceiptId, receiptNo: i.paidReceiptNo, receiptHref: i.paidReceiptHref, collectedBy: i.collectedBy, company: i.policy.partner,
    status: i.companyStatus!,
  })) : [];
  const link = (t: string) => `/renewals?${new URLSearchParams({ tab: t, ...filter })}`;
  const canDeactivate = hasPermission(user.role, "Policy.Deactivate");
  const canDeletePolicy = hasPermission(user.role, "Policy.Delete");
  const pastMaturities = rows.filter((x) => x.kind === "maturity" && x.date < today).length;
  const summary = tab === "customers" ? `${customers.length} customers · ${fmtINR(total)} overdue`
    : tab === "maturity" ? `${count} maturit${count === 1 ? "y" : "ies"} · ${range ? rangeLabel(range) : "next 30 days"}${pastMaturities ? ` · ${pastMaturities} matured, not yet marked` : ""}`
    : `${count} ${tab === "due" ? "due" : tab === "overdue" ? "overdue" : paidTo === "pending" ? "collected, not yet paid to Post office / insurer" : "paid"} · ${tab === "paid" && paidTo === "pending" ? "" : `${rangeLabel(range)} · `}${fmtINR(total)}`;

  return (
    <>
      <PageHeader title="Renewals" user={user} actions={hasPermission(user.role, "Report.Export") && (() => {
        const thisTab = exportLinks("renewals", { tab, ...filter, ...rangeParams, ...(paidTo !== "all" && { paidto: paidTo }) });
        return (
          <DownloadMenu groups={[
            { title: `This tab – ${TABS.find(([k]) => k === tab)?.[1]} (current filters)`, items: [{ label: "Excel", href: thisTab.excel, kind: "excel" }, { label: "PDF", href: thisTab.pdf, kind: "pdf" }] },
          ]} />
        );
      })()} />
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard title="Due this month" value={String(cards.due.count)} sub={fmtINR(cards.due.amount)} href={`/renewals?tab=due&range=month`} />
        <StatCard title="Paid" value={String(cards.paid.count)} sub={fmtINR(cards.paid.amount)} href={`/renewals?tab=paid&range=month`} />
        <StatCard title="Not paid" value={String(cards.notPaid.count)} sub={fmtINR(cards.notPaid.amount)} alert={cards.notPaid.count > 0} />      </div>
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
          <RenewalFilters key={tab} tab={tab} product={product} company={company} scheme={scheme} paidTo={paidTo}
            range={range && { pick: range.pick, from: isoDate(range.from), to: isoDate(range.to) }} showRange={tab !== "customers" && !(tab === "paid" && paidTo === "pending")}
            products={RENEWAL_PRODUCTS} paidToOptions={PAID_TO} rangePicks={RANGE_PICKS} companies={options.companies} schemes={options.schemes} />
        </div>
        <p className="mb-2 text-sm text-muted-foreground">{summary}</p>

        {tab === "paid" && <PaidTable rows={paidRows} />}

        {(tab === "due" || tab === "overdue" || tab === "maturity") && (() => {
          // Post office schemes: tick rows (or all) to send reminders or take one combined receipt.
          const ticks = product === "po";
          const table = (
          <Table>
            <TableHeader>
              <TableRow>
                {ticks && <TableHead className="w-8"><PoCheckAll /></TableHead>}
                <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>{tab === "maturity" ? "Maturity date" : "Due date"}</TableHead>
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
                    {ticks && <TableCell><PoCheck k={i.id} label={`${p.customer.name} ${p.policyNumber}`} /></TableCell>}
                    <TableCell><Link href={`/customers/${p.customer.id}`} className="text-brand-700 hover:underline">{p.customer.name}</Link></TableCell>
                    <TableCell className="max-w-48 whitespace-normal">{p.productType === "PoRd" ? "Post office RD" : p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}</TableCell>
                    <TableCell><Link href={`/customers/${p.customer.id}/schedule/${p.id}`} className="hover:underline" title="View schedule">{p.policyNumber}</Link></TableCell>
                    <TableCell>{fmtDate(i.date)}</TableCell>
                    <TableCell className="text-right">{fmtINR(i.amount)}{maturity && <div className="text-xs text-muted-foreground">{p.frequency === "OneTime" ? "deposited" : "instalment"}</div>}</TableCell>
                    <TableCell><StatusBadge tone={tone}>{status}</StatusBadge></TableCell>
                    <TableCell className="text-sm">
                      <ReminderHistory kind={maturity ? "maturity" : "bill"} id={maturity ? p.id : i.id} count={i.reminderCount}
                        last={i.lastReminderAt ? dayShort(i.lastReminderAt) : null} channel={i.lastReminderChannel} title={`${p.customer.name} · ${p.policyNumber}`} />
                    </TableCell>
                    <TableCell className="w-0 text-right">
                      <div className="flex justify-end gap-1">
                        {maturity ? <MaturityRowActions policyId={p.id} matured={i.date < today} />
                          : <RenewalRowActions renewalItemId={i.id} customerId={p.customer.id} overdue={tab === "overdue"} />}
                        <PolicyManageButton policyId={p.id} label={`${p.customer.name} · ${p.partner} ${p.productName} · ${p.policyNumber}`} deactivated={false}
                          canDeactivate={canDeactivate} canDelete={canDeletePolicy} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {rows.length === 0 && <TableRow><TableCell colSpan={ticks ? 9 : 8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
            </TableBody>
          </Table>
          );
          if (!ticks) return table;
          const items: TickItem[] = rows.map((i) => (i.kind === "maturity" ? { key: i.id, kind: "maturity", id: i.policy.id } : { key: i.id, kind: "bill", id: i.id }));
          return <PoSelection items={items} canReceipt={hasPermission(user.role, "Receipt.Create")}>{table}</PoSelection>;
        })()}
        {tab !== "customers" && (
          <Pager page={pageNo} pageSize={PAGE_SIZE} total={count} path="/renewals"
            params={{ tab, ...filter, ...rangeParams, ...(paidTo !== "all" && { paidto: paidTo }) } as Record<string, string | undefined>} />
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
          Reminders are mocked: &quot;Send reminder&quot; writes the WhatsApp message to Sent messages instead of sending it; click a reminder count to see each one.
          The Maturity tab lists every scheme with a maturity date from a month before (health renews until closed); one-time deposits stay there after maturity until &quot;Mark matured&quot;.
          Deactivating a product stops its bills and reminders; switch it back on from the customer&apos;s page. Click a policy number to see its full schedule.
        </p>
      </div>
    </>
  );
}

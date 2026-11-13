import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { Pager } from "@/components/pager";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CUSTOMER_IN_USE, inUseReason } from "@/lib/customer-delete";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";
import { customerFilter, HOLDING_STATUS, PRODUCT_SHORT, RENEWAL_PRODUCTS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { refreshOverdue, renewalFilterOptions } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { hasPermission } from "@/lib/permissions";
import { CustomerActions } from "./customer-actions";
import { CustomerFilters } from "./customer-filters";

type Search = { q?: string; product?: string; company?: string; scheme?: string; status?: string; page?: string };

/** Customers per page (owner, 13 Nov 2026 – D-03: 2,000 customers on one page took ~18 s). */
const PAGE_SIZE = 50;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Policy.View");
  const sp = await searchParams;
  const f = customerFilter(user, sp);
  await refreshOverdue(user.tenantId, istToday());
  const total = await db.customer.count({ where: f.where });
  const page = Math.min(Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1), Math.max(1, Math.ceil(total / PAGE_SIZE)));
  const [customers, options] = await Promise.all([
    db.customer.findMany({
      where: f.where,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        _count: { select: { mobiles: true, ...CUSTOMER_IN_USE } },
        policies: {
          select: { productType: true, renewals: { where: { status: { in: ["Due", "Overdue"] } }, orderBy: { dueDate: "asc" }, take: 1, select: { dueDate: true, status: true, premiumAmount: true } } },
        },
      },
      orderBy: { name: "asc" },
    }),
    renewalFilterOptions(user, f.product, f.company),
  ]);
  // With a holdings filter on, show which of each customer's holdings matched.
  const matching = f.filtered
    ? await db.policy.findMany({
        where: { tenantId: user.tenantId, customerId: { in: customers.map((c) => c.id) }, ...f.holdingWhere },
        select: { customerId: true, policyNumber: true, productType: true, partner: true, productName: true },
        orderBy: { policyNumber: "asc" },
      })
    : [];

  // Action menu (owner, 4 Nov 2026): items follow the user's permissions.
  const can = {
    edit: hasPermission(user.role, "Policy.Create"), receipt: hasPermission(user.role, "Receipt.Create"),
    quote: hasPermission(user.role, "Quote.Create"), delete: hasPermission(user.role, "Customer.Delete"),
  };
  const today = isoDate(istToday());

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} actions={
        <ExportButton report="customers" user={user} params={{ q: f.q, product: f.product === "all" ? undefined : f.product, company: f.company, scheme: f.scheme, status: f.status === "all" ? undefined : f.status }} />
      } />
      <div className="rounded-xl border bg-white p-4">
        <CustomerFilters q={f.q ?? ""} product={f.product} company={f.company} scheme={f.scheme} status={f.status}
          products={RENEWAL_PRODUCTS} statuses={HOLDING_STATUS} companies={options.companies} schemes={options.schemes} />
        {f.filtered && <p className="mb-2 text-sm text-muted-foreground">{total} customer{total === 1 ? "" : "s"} holding {f.filterLabel}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead><TableHead>Mobile</TableHead><TableHead>Holdings</TableHead>
              {f.filtered && <TableHead>Matching holdings</TableHead>}
              <TableHead>Next due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const counts = Object.entries(c.policies.reduce<Record<string, number>>((m, p) => ({ ...m, [PRODUCT_SHORT[p.productType]]: (m[PRODUCT_SHORT[p.productType]] ?? 0) + 1 }), {}));
              const next = c.policies.flatMap((p) => p.renewals).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
              const mine = matching.filter((p) => p.customerId === c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/customers/${c.id}`} className="text-brand-700 hover:underline">{c.name}</Link></TableCell>
                  <TableCell>{maskMobile(c.mobile)}{c._count.mobiles > 1 && <span className="text-xs text-muted-foreground"> +{c._count.mobiles - 1}</span>}</TableCell>
                  <TableCell>{counts.map(([k, n]) => `${n} ${k}`).join(" · ") || "—"}</TableCell>
                  {f.filtered && (
                    <TableCell className="whitespace-normal text-xs">
                      {mine.map((p) => <div key={p.policyNumber}>{p.policyNumber} · {p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}</div>)}
                    </TableCell>
                  )}
                  <TableCell>{next ? fmtDate(next.dueDate) : "—"}{next?.status === "Overdue" && <> <StatusBadge tone="red">Overdue</StatusBadge></>}</TableCell>
                  <TableCell className="text-right">{next ? fmtINR(next.premiumAmount) : ""}</TableCell>
                  <TableCell><CustomerActions customer={{ id: c.id, name: c.name, cifNo: c.cifNo }} can={can} inUse={inUseReason(c._count)} today={today} /></TableCell>
                </TableRow>
              );
            })}
            {customers.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No customers found.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <Pager page={page} pageSize={PAGE_SIZE} total={total} path="/customers"
          params={{ q: f.q, product: f.product === "all" ? undefined : f.product, company: f.company, scheme: f.scheme, status: f.status === "all" ? undefined : f.status }} />
      </div>
    </>
  );
}

import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";
import { customerFilter, HOLDING_STATUS, PRODUCT_SHORT, RENEWAL_PRODUCTS } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { refreshOverdue, renewalFilterOptions } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";
import { CustomerFilters } from "./customer-filters";

type Search = { q?: string; product?: string; company?: string; scheme?: string; status?: string };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Policy.View");
  const f = customerFilter(user, await searchParams);
  await refreshOverdue(user.tenantId, istToday());
  const [customers, options] = await Promise.all([
    db.customer.findMany({
      where: f.where,
      include: {
        _count: { select: { mobiles: true } },
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

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} actions={
        <ExportButton report="customers" user={user} params={{ q: f.q, product: f.product === "all" ? undefined : f.product, company: f.company, scheme: f.scheme, status: f.status === "all" ? undefined : f.status }} />
      } />
      <div className="rounded-xl border bg-white p-4">
        <CustomerFilters q={f.q ?? ""} product={f.product} company={f.company} scheme={f.scheme} status={f.status}
          products={RENEWAL_PRODUCTS} statuses={HOLDING_STATUS} companies={options.companies} schemes={options.schemes} />
        {f.filtered && <p className="mb-2 text-sm text-muted-foreground">{customers.length} customer{customers.length === 1 ? "" : "s"} holding {f.filterLabel}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Customer</TableHead><TableHead>CIF</TableHead><TableHead>Mobile</TableHead><TableHead>Holdings</TableHead>
              {f.filtered && <TableHead>Matching holdings</TableHead>}
              <TableHead>Next due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead />
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
                  <TableCell className="font-mono text-xs">{c.cifNo}</TableCell>
                  <TableCell>{maskMobile(c.mobile)}{c._count.mobiles > 1 && <span className="text-xs text-muted-foreground"> +{c._count.mobiles - 1}</span>}</TableCell>
                  <TableCell>{counts.map(([k, n]) => `${n} ${k}`).join(" · ") || "—"}</TableCell>
                  {f.filtered && (
                    <TableCell className="whitespace-normal text-xs">
                      {mine.map((p) => <div key={p.policyNumber}>{p.policyNumber} · {p.productType === "Insurance" || p.productType === "MutualFund" ? `${p.partner} ${p.productName}` : p.productName}</div>)}
                    </TableCell>
                  )}
                  <TableCell>{next ? fmtDate(next.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right">{next ? fmtINR(next.premiumAmount) : ""}</TableCell>
                  <TableCell>{next?.status === "Overdue" && <StatusBadge tone="red">Overdue</StatusBadge>}</TableCell>
                </TableRow>
              );
            })}
            {customers.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">No customers found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

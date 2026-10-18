import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";
import { customerFilter, PRODUCT_SHORT } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { refreshOverdue } from "@/lib/renewals";
import { requirePermission } from "@/lib/session";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePermission("Policy.View");
  const { q, where } = customerFilter(user, await searchParams);
  await refreshOverdue(user.tenantId, istToday());
  const customers = await db.customer.findMany({
    where,
    include: {
      policies: {
        select: { productType: true, renewals: { where: { status: { in: ["Due", "Overdue"] } }, orderBy: { dueDate: "asc" }, take: 1, select: { dueDate: true, status: true, premiumAmount: true } } },
      },
    },
    orderBy: { name: "asc" },
  });

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} actions={<ExportButton report="customers" user={user} params={{ q }} />} />
      <div className="rounded-xl border bg-white p-4">
        <form className="mb-4 flex max-w-md gap-2">
          <Input name="q" defaultValue={q} placeholder="Name, mobile or policy / account no." />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Customer</TableHead><TableHead>Mobile</TableHead><TableHead>Holdings</TableHead><TableHead>Next due</TableHead><TableHead className="text-right">Amount</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {customers.map((c) => {
              const counts = Object.entries(c.policies.reduce<Record<string, number>>((m, p) => ({ ...m, [PRODUCT_SHORT[p.productType]]: (m[PRODUCT_SHORT[p.productType]] ?? 0) + 1 }), {}));
              const next = c.policies.flatMap((p) => p.renewals).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
              return (
                <TableRow key={c.id}>
                  <TableCell><Link href={`/customers/${c.id}`} className="text-blue-700 hover:underline">{c.name}</Link></TableCell>
                  <TableCell>{maskMobile(c.mobile)}</TableCell>
                  <TableCell>{counts.map(([k, n]) => `${n} ${k}`).join(" · ") || "—"}</TableCell>
                  <TableCell>{next ? fmtDate(next.dueDate) : "—"}</TableCell>
                  <TableCell className="text-right">{next ? fmtINR(next.premiumAmount) : ""}</TableCell>
                  <TableCell>{next?.status === "Overdue" && <StatusBadge tone="red">Overdue</StatusBadge>}</TableCell>
                </TableRow>
              );
            })}
            {customers.length === 0 && <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">No customers found.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { BANK_FIELDS, fmtLockIn, fmtTenure, INVOICE_RULE_SHORT, PAY_MODE_LABEL, PRODUCT_TYPE_LABEL, rateOn } from "@/lib/products";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { SettingsTabs } from "./settings-tabs";

/** Settings → Products and schemes: one row per scheme, as on the owner's screen. */
export default async function SettingsPage() {
  const user = await requirePermission("Settings.Edit");
  const today = istToday();
  const products = await db.product.findMany({
    where: { tenantId: user.tenantId },
    include: { schemes: { include: { rates: true }, orderBy: [{ tenureMonths: "asc" }, { name: "asc" }] }, _count: { select: { policies: true } } },
    orderBy: [{ active: "desc" }, { productType: "asc" }, { partner: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader title="Settings" user={user} actions={
        <Link href="/settings/products/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>Add product</Link>
      } />
      <SettingsTabs active="products" />
      <div className="rounded-xl border bg-white p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead><TableHead>Scheme / plan</TableHead><TableHead>Partner</TableHead><TableHead>Tenure</TableHead>
              <TableHead>Lock-in</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Rate from</TableHead><TableHead>Bills</TableHead><TableHead>Bank details</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((p) => {
              const rows = p.schemes.length ? p.schemes : [null];
              return rows.map((s, i) => {
                const rate = s ? rateOn(s.rates, today) : null;
                return (
                  <TableRow key={`${p.id}-${s?.id ?? "none"}`} className={cn(!p.active && "text-muted-foreground", i > 0 && "border-t-0")}>
                    <TableCell className="align-top">
                      {i === 0 && <>
                        <div className="font-medium">{p.name}</div>
                        <div className="text-xs text-muted-foreground">{PRODUCT_TYPE_LABEL[p.productType]} · {p.payModes.map((m) => PAY_MODE_LABEL[m]).join(", ")}{!p.active && " · inactive"}</div>
                      </>}
                    </TableCell>
                    <TableCell>{s ? <>{s.name}{!s.active && <StatusBadge tone="slate">inactive</StatusBadge>}</> : <span className="text-muted-foreground">No schemes yet</span>}</TableCell>
                    <TableCell>{i === 0 && p.partner}</TableCell>
                    <TableCell>{s && fmtTenure(s.tenureMonths)}</TableCell>
                    <TableCell>{i === 0 && fmtLockIn(p.lockInMonths)}</TableCell>
                    <TableCell className="text-right">{rate ? `${rate.rate.toFixed(2)}%` : "—"}</TableCell>
                    <TableCell>{rate ? fmtDate(rate.effectiveFrom) : "—"}</TableCell>
                    <TableCell>{i === 0 && INVOICE_RULE_SHORT[p.invoiceRule]}</TableCell>
                    <TableCell title={p.bankDetailsRequired ? p.bankFields.map((f) => BANK_FIELDS[f as keyof typeof BANK_FIELDS]).join(", ") : undefined}>{i === 0 && (p.bankDetailsRequired ? "Yes" : "No")}</TableCell>
                    <TableCell className="text-right">{i === 0 && <Link href={`/settings/products/${p.id}`} className="text-brand-700 hover:underline">Edit</Link>}</TableCell>
                  </TableRow>
                );
              });
            })}
            {products.length === 0 && <TableRow><TableCell colSpan={10} className="py-6 text-center text-muted-foreground">No products yet. Add the first one.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          Rates shown are the ones in force today. Accounts already opened keep the rate they were opened at. Check sample rates against the latest official rules before going live.
        </p>
      </div>
    </>
  );
}

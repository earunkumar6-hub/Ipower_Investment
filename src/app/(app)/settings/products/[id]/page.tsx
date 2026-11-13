import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { CUSTOM_FIELD_TYPE_LABEL, fmtTenure, quoteGroup, rateHistory, rateOn } from "@/lib/products";
import { productCategories } from "@/lib/products-db";
import { requirePermission } from "@/lib/session";
import { AddCustomFieldForm, AddSchemeForm, DeleteProductButton, DeleteSchemeButton, ProductForm, RateForm, RemoveFieldButton, SchemeEditToggle } from "../../product-forms";
import { SettingsTabs } from "../../settings-tabs";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Settings.Edit");
  const product = await db.product.findFirst({
    where: { id: (await params).id, tenantId: user.tenantId },
    include: {
      schemes: { include: { rates: true }, orderBy: [{ tenureMonths: "asc" }, { name: "asc" }] },
      customFields: { orderBy: { sort: "asc" } },
      _count: { select: { policies: true } },
    },
  });
  if (!product) notFound();
  const today = istToday();
  const nameOf = nameLookup(await db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }));

  return (
    <>
      <PageHeader title="Settings" user={user} />
      <SettingsTabs active="products" />
      <div className="mb-2 text-sm"><Link href="/settings" className="text-brand-700 hover:underline">← All products</Link></div>

      <div className="mb-4 rounded-xl border bg-white p-4">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h2 className="font-semibold">{product.partner} · {product.name}</h2>
          <DeleteProductButton productId={product.id} name={product.name} />
        </div>
        <p className="mb-3 text-xs text-muted-foreground">{product._count.policies} account(s) linked. Changes apply from now on; every change is in the change log.</p>
        <ProductForm categories={await productCategories(user.tenantId)} product={{
          id: product.id, name: product.name, productType: product.productType, partner: product.partner, category: quoteGroup(product), invoiceRule: product.invoiceRule,
          payModes: product.payModes, lockInMonths: product.lockInMonths, bankDetailsRequired: product.bankDetailsRequired, bankFields: product.bankFields,
          prematureClosure: product.prematureClosure, closeDuringLockIn: product.closeDuringLockIn, fields: product.fields, requiredFields: product.requiredFields, active: product.active,
        }} />
      </div>

      <div className="mb-4 rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Schemes, tenure and interest rate</h2>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Scheme</TableHead><TableHead>Tenure</TableHead><TableHead className="text-right">Rate today</TableHead><TableHead>Rate history</TableHead><TableHead>Change rate</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {product.schemes.map((s) => {
              const now = rateOn(s.rates, today);
              return (
                <TableRow key={s.id} className="align-top">
                  <TableCell className="font-medium">{s.name}{!s.active && <> <StatusBadge tone="slate">inactive</StatusBadge></>}</TableCell>
                  <TableCell>{fmtTenure(s.tenureMonths)}</TableCell>
                  <TableCell className="text-right">{now ? `${now.rate.toFixed(2)}%` : "—"}</TableCell>
                  <TableCell className="text-xs whitespace-normal">
                    {s.rates.length === 0 && <span className="text-muted-foreground">No rate (e.g. bonus-based)</span>}
                    {rateHistory(s.rates).map((r) => (
                      <div key={r.id} className={r.effectiveFrom > today ? "text-saffron-800" : undefined}>
                        {r.rate.toFixed(2)}% · {fmtDate(r.effectiveFrom)} – {r.to ? fmtDate(r.to) : "now"} · {nameOf(r.changedById)}{r.effectiveFrom > today && " (upcoming)"}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell><RateForm schemeId={s.id} today={isoDate(today)} /></TableCell>
                  <TableCell className="text-right"><div className="flex flex-wrap items-start justify-end gap-1"><SchemeEditToggle productId={product.id} scheme={{ id: s.id, name: s.name, tenureMonths: s.tenureMonths, active: s.active }} /><DeleteSchemeButton schemeId={s.id} name={s.name} /></div></TableCell>
                </TableRow>
              );
            })}
            {product.schemes.length === 0 && <TableRow><TableCell colSpan={6} className="py-4 text-center text-muted-foreground">No schemes yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="mt-3"><AddSchemeForm productId={product.id} today={isoDate(today)} /></div>
        <p className="mt-2 text-xs text-muted-foreground">Existing accounts keep the rate they were opened at. A rate with a future date starts on that date.</p>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Custom fields</h2>
        <Table>
          <TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Type</TableHead><TableHead>Values</TableHead><TableHead>Required</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {product.customFields.map((f) => (
              <TableRow key={f.id}>
                <TableCell>{f.label}</TableCell>
                <TableCell>{CUSTOM_FIELD_TYPE_LABEL[f.type]}</TableCell>
                <TableCell className="whitespace-normal">{f.options.join(", ") || "—"}</TableCell>
                <TableCell>{f.required ? "Yes" : "No"}</TableCell>
                <TableCell className="text-right"><RemoveFieldButton fieldId={f.id} label={f.label} /></TableCell>
              </TableRow>
            ))}
            {product.customFields.length === 0 && <TableRow><TableCell colSpan={5} className="py-4 text-center text-muted-foreground">No custom fields.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <div className="mt-3"><AddCustomFieldForm productId={product.id} /></div>
      </div>
    </>
  );
}

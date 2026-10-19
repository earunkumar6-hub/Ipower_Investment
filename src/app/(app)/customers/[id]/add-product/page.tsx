import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { requirePermission } from "@/lib/session";
import { AddProductForm } from "./add-product-form";

/** Add a product to a customer without a quotation; fields and rules come from Settings → Products and schemes. */
export default async function AddProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("Policy.Create");
  const customer = await db.customer.findFirst({ where: { id: (await params).id, tenantId: user.tenantId } });
  if (!customer || !canActOn(user, customer.ownerId)) notFound();
  const products = await db.product.findMany({
    where: { tenantId: user.tenantId, active: true },
    include: { schemes: { where: { active: true }, include: { rates: true }, orderBy: [{ tenureMonths: "asc" }, { name: "asc" }] }, customFields: { orderBy: { sort: "asc" } } },
    orderBy: [{ productType: "asc" }, { partner: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <PageHeader title="Partners / Customers" user={user} />
      <div className="mb-2 text-sm"><Link href={`/customers/${customer.id}`} className="text-brand-700 hover:underline">← {customer.name}</Link></div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">Add product directly · {customer.name}</h2>
        <AddProductForm
          customerId={customer.id}
          customerName={customer.name}
          today={isoDate(istToday())}
          products={products.map((p) => ({
            id: p.id, name: p.name, partner: p.partner, productType: p.productType, payModes: p.payModes, lockInMonths: p.lockInMonths,
            fields: p.fields, requiredFields: p.requiredFields, bankDetailsRequired: p.bankDetailsRequired, bankFields: p.bankFields,
            schemes: p.schemes.map((s) => ({ id: s.id, name: s.name, tenureMonths: s.tenureMonths, rates: s.rates.map((r) => ({ rate: r.rate.toFixed(2), from: isoDate(r.effectiveFrom) })) })),
            customFields: p.customFields.map((f) => ({ id: f.id, label: f.label, type: f.type, options: f.options, required: f.required })),
          }))}
        />
        <p className="mt-3 text-xs text-muted-foreground">Schemes, tenures, lock-in periods and rates come from Settings → Products and schemes. One-time products such as TD get no bills and mature on start date + term.</p>
      </div>
    </>
  );
}

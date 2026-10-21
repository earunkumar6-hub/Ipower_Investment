import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { payableDues } from "@/lib/dues";
import { billEnd } from "@/lib/policies";
import { maskMobile } from "@/lib/lead-labels";
import { canActOn, ownerScope } from "@/lib/leads";
import { payOptions } from "@/lib/payment-options";
import { requirePermission } from "@/lib/session";
import { ReceiptForm, type PolicyOption } from "./receipt-form";

const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ customerId?: string; q?: string }> }) {
  const user = await requirePermission("Receipt.Create");
  const sp = await searchParams;

  const customer = sp.customerId
    ? await db.customer.findFirst({
        where: { id: sp.customerId, tenantId: user.tenantId },
        include: {
          policies: {
            where: { status: "Active" },
            include: { renewals: true, product: { select: { invoiceRule: true } } },
            orderBy: { productType: "asc" },
          },
          ownerPaidSlips: { where: { status: "CustomerOwes" }, include: { policy: { select: { policyNumber: true } }, renewalItem: { select: { billNo: true } } }, orderBy: { month: "asc" } },
        },
      })
    : null;

  if (customer && canActOn(user, customer.ownerId)) {
    const today = istToday();
    const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const withDues = customer.policies.map((p) => ({ p, dues: payableDues({ ...p, billUntil: billEnd(p, p.product?.invoiceRule) }, p.renewals, today) }));
    const firstDue = (x: (typeof withDues)[number]) => x.dues[0]?.dueDate.getTime() ?? Infinity;
    const policies: PolicyOption[] = withDues.sort((a, b) => firstDue(a) - firstDue(b)).map(({ p, dues }) => ({
      id: p.id,
      label: p.productType === "PoRd" ? `${p.policyNumber} · Post office RD` : `${p.partner} ${p.productName} · ${p.policyNumber}`,
      dues: dues.map((d) => ({
        billNo: p.renewals.find((r) => r.id === d.itemId)?.billNo ?? null,
        amount: d.amount.toFixed(2),
        label: p.frequency === "Monthly" ? monthLabel(d.dueDate) : fmtDate(d.dueDate),
        tag: d.dueDate < today ? "Overdue" : d.dueDate > monthEnd ? "Advance" : "Due",
      })),
    }));
    const opts = await payOptions(db, user.tenantId);
    return (
      <>
        <PageHeader title="New receipt" user={user} />
        <ReceiptForm
          modes={opts.modes} banks={opts.banks} receivedBy={user.name}
          customer={{ id: customer.id, name: customer.name, mobile: customer.mobile }}
          policies={policies}
          openSlips={customer.ownerPaidSlips.map((s) => ({
            id: s.id, slipNo: s.slipNo, account: s.policy.policyNumber, month: s.renewalItem ? `${s.renewalItem.billNo} · ${monthLabel(s.month)}` : monthLabel(s.month), amount: s.amount.toFixed(2), poReceiptNo: s.poReceiptNo,
          }))}
        />
      </>
    );
  }

  const q = sp.q?.trim();
  const customers = await db.customer.findMany({
    where: {
      tenantId: user.tenantId,
      ...ownerScope(user),
      ...(q && { OR: [{ name: { contains: q, mode: "insensitive" } }, { mobile: { contains: q } }] }),
    },
    orderBy: { name: "asc" },
    take: 30,
  });

  return (
    <>
      <PageHeader title="New receipt" user={user} />
      <div className="max-w-xl rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">Who is paying?</h2>
        <form className="mb-4 flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search customer by name or mobile" autoFocus />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <ul className="space-y-1 text-sm">
          {customers.map((c) => (
            <li key={c.id}>
              <Link href={`?customerId=${c.id}`} className="flex justify-between rounded-md px-2 py-1.5 hover:bg-slate-100">
                <span>{c.name}</span><span className="text-muted-foreground">{maskMobile(c.mobile)}</span>
              </Link>
            </li>
          ))}
          {customers.length === 0 && <li className="px-2 text-muted-foreground">No customers found</li>}
        </ul>
      </div>
    </>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { notFound } from "next/navigation";
import { istToday } from "@/lib/dates";
import { bankAccountOptions } from "@/lib/accounts";
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";
import { canActOn, ownerScope } from "@/lib/leads";
import { payOptions } from "@/lib/payment-options";
import { requirePermission } from "@/lib/session";
import { POLICY_BILLS_INCLUDE, policyOptions } from "@/lib/receipt-options";
import { GroupReceiptForm } from "../group-receipt-form";
import { ReceiptForm } from "./receipt-form";

const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export default async function NewReceiptPage({ searchParams }: { searchParams: Promise<{ customerId?: string; groupId?: string; q?: string }> }) {
  const user = await requirePermission("Receipt.Create");
  const sp = await searchParams;

  // A bill group's receipt: every member's bills, paid in one receipt.
  if (sp.groupId) {
    const group = await db.billGroup.findFirst({
      where: { id: sp.groupId, tenantId: user.tenantId },
      include: { members: { include: { policy: { include: POLICY_BILLS_INCLUDE } } } },
    });
    if (!group) notFound();
    const active = group.members.map((m) => m.policy).filter((p) => p.status === "Active");
    const mine = active.filter((p) => canActOn(user, p.customer.ownerId));
    const [opts, accounts] = await Promise.all([payOptions(db, user.tenantId), bankAccountOptions(db, user.tenantId)]);
    return (
      <>
        <PageHeader title={`Bill group receipt · ${group.name}`} user={user} />
        {mine.length < active.length && (
          <p className="mb-3 max-w-5xl rounded-lg bg-saffron-50 p-3 text-sm text-saffron-900">
            {active.length - mine.length} account(s) in this group belong to other users&apos; customers and are left out; an Admin can take the full group&apos;s payment.
          </p>
        )}
        <GroupReceiptForm kind="BillGroup" billGroupId={group.id} policies={policyOptions(mine, istToday())}
          payer={{ name: group.contactName ?? "", mobile: group.contactMobile ?? "" }}
          modes={opts.modes} accounts={accounts} receivedBy={user.name} />
      </>
    );
  }

  const customer = sp.customerId
    ? await db.customer.findFirst({
        where: { id: sp.customerId, tenantId: user.tenantId },
        include: {
          policies: { where: { status: "Active" }, include: POLICY_BILLS_INCLUDE, orderBy: { productType: "asc" } },
          ownerPaidSlips: { where: { status: "CustomerOwes" }, include: { policy: { select: { policyNumber: true } }, renewalItem: { select: { billNo: true } } }, orderBy: { month: "asc" } },
        },
      })
    : null;

  if (customer && canActOn(user, customer.ownerId)) {
    const policies = policyOptions(customer.policies, istToday());
    const [opts, accounts] = await Promise.all([payOptions(db, user.tenantId), bankAccountOptions(db, user.tenantId)]);
    return (
      <>
        <PageHeader title="New receipt" user={user} />
        <ReceiptForm
          modes={opts.modes} accounts={accounts} receivedBy={user.name}
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
          <Input name="q" defaultValue={q} autoFocus />
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

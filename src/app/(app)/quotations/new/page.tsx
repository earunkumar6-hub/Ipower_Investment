import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { addDays, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { maskMobile } from "@/lib/lead-labels";
import { canActOn, ownerScope } from "@/lib/leads";
import { requirePermission } from "@/lib/session";
import { QuotationForm } from "./quotation-form";

type Search = { customerId?: string; leadId?: string; q?: string };

export default async function NewQuotationPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requirePermission("Quote.Create");
  const sp = await searchParams;

  const party = sp.customerId
    ? await db.customer.findFirst({ where: { id: sp.customerId, tenantId: user.tenantId } })
    : sp.leadId
      ? await db.lead.findFirst({ where: { id: sp.leadId, tenantId: user.tenantId } })
      : null;

  if (party && canActOn(user, party.ownerId)) {
    return (
      <>
        <PageHeader title="New quotation" user={user} />
        <QuotationForm
          customerId={sp.customerId ?? ""}
          leadId={sp.leadId ?? ""}
          customerName={party.name}
          mobile={party.mobile}
          defaultValidUpto={isoDate(addDays(istToday(), 15))}
        />
      </>
    );
  }

  // Step 1: pick who the quotation is for.
  const q = sp.q?.trim();
  const match = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { mobile: { contains: q } }] }
    : {};
  const [customers, leads] = await Promise.all([
    db.customer.findMany({ where: { tenantId: user.tenantId, ...ownerScope(user), ...match }, orderBy: { name: "asc" }, take: 20 }),
    db.lead.findMany({
      where: { tenantId: user.tenantId, ...ownerScope(user), ...match, status: { not: "NotInterested" }, stage: { not: "Customer" } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <>
      <PageHeader title="New quotation" user={user} />
      <div className="max-w-2xl rounded-xl border bg-white p-4">
        <h2 className="mb-3 font-semibold">Who is this quotation for?</h2>
        <form className="mb-4 flex gap-2">
          <Input name="q" defaultValue={q} placeholder="Search customer or lead by name or mobile" autoFocus />
          <Button type="submit" variant="outline">Search</Button>
        </form>
        <div className="grid grid-cols-2 gap-6 text-sm">
          <PartyList title="Customers" items={customers.map((c) => ({ id: c.id, name: c.name, mobile: c.mobile, href: `?customerId=${c.id}` }))} />
          <PartyList title="Leads" items={leads.map((l) => ({ id: l.id, name: `${l.name} · ${l.leadNo}`, mobile: l.mobile, href: `?leadId=${l.id}` }))} />
        </div>
      </div>
    </>
  );
}

function PartyList({ title, items }: { title: string; items: { id: string; name: string; mobile: string; href: string }[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={i.href} className="flex justify-between rounded-md px-2 py-1.5 hover:bg-slate-100">
              <span>{i.name}</span>
              <span className="text-muted-foreground">{maskMobile(i.mobile)}</span>
            </Link>
          </li>
        ))}
        {items.length === 0 && <li className="px-2 text-muted-foreground">None found</li>}
      </ul>
    </div>
  );
}

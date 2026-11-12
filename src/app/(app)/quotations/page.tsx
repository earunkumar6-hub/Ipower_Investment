import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { ListSearch } from "@/components/list-search";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { ownerScope } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { QUOTE_TAB_WHERE, QUOTE_TABS, quotationStatus, quoteTab } from "@/lib/quotation";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";

export default async function QuotationsPage({ searchParams }: { searchParams: Promise<{ q?: string; tab?: string }> }) {
  const user = await requirePermission("Quote.View");
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const tab = quoteTab(sp.tab);
  // The search applies to every tab; each tab shows its count for it (#35).
  const base = {
    tenantId: user.tenantId,
    ...ownerScope(user),
    deletedAt: null,
    ...(q && {
      AND: [{
        OR: [
          { mobile: { contains: q } },
          { customerName: { contains: q, mode: "insensitive" as const } },
          { quoteNo: { contains: q, mode: "insensitive" as const } },
        ],
      }],
    }),
  };
  const [quotations, counts] = await Promise.all([
    db.quotation.findMany({
      where: { ...base, ...QUOTE_TAB_WHERE[tab] },
      include: { items: { include: { proposal: { select: { status: true } } } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    Promise.all(QUOTE_TABS.map(([k]) => db.quotation.count({ where: { ...base, ...QUOTE_TAB_WHERE[k] } }))),
  ]);
  const link = (t: string) => `/quotations?${new URLSearchParams({ tab: t, ...(q && { q }) })}`;

  return (
    <>
      <PageHeader title="Quotations" user={user} actions={<>
        <ExportButton report="quotations" user={user} />
        <Link href="/quotations/new" className={cn(buttonVariants(), "bg-brand-600 hover:bg-brand-700")}>New quotation</Link>
      </>} />
      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex gap-1 border-b">
          {QUOTE_TABS.map(([k, label], i) => (
            <Link key={k} href={link(k)}
              className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === k ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label} <span className="text-xs text-muted-foreground">({counts[i]})</span>
            </Link>
          ))}
        </div>
        <ListSearch q={q} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Customer</TableHead><TableHead>Products</TableHead>
              <TableHead className="text-right">Total</TableHead><TableHead>Valid till</TableHead><TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {quotations.map((q) => {
              const [label, tone] = quotationStatus(q);
              return (
                <TableRow key={q.id}>
                  <TableCell><Link href={`/quotations/${q.id}`} className="text-brand-700 hover:underline">{q.quoteNo}</Link></TableCell>
                  <TableCell>{q.customerName}</TableCell>
                  <TableCell className="whitespace-normal">{q.items.map((i) => `${i.insurer} ${i.productName}`).join(", ")}</TableCell>
                  <TableCell className="text-right">{q.total.gt(0) ? fmtINR(q.total) : "—"}</TableCell>
                  <TableCell>{fmtDate(q.validUpto)}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{label}</StatusBadge></TableCell>
                </TableRow>
              );
            })}
            {quotations.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">{q ? `No quotations here match "${q}".` : tab === "drafts" ? "No drafts. Use \"Mark as sent\" on a quotation once it has gone to the customer." : "Nothing here."}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

import type { VerifyStatus } from "@prisma/client";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { nameLookup } from "@/lib/deposit-status";
import { userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { schemeOf } from "@/lib/posting";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { VerifyForm } from "./verify-form";

const TONE: Record<VerifyStatus, Tone> = { Pending: "orange", Verified: "green", Mismatch: "red" };
const FILTERS = [["pending", "To check"], ["all", "All"]] as const;

/** Agent-portal check: RD deposits by PO receipt number, other post office payments (SSA, PPF…) by policy number. */
export default async function VerificationPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requirePermission("Receipt.View");
  const show = (await searchParams).show === "all" ? "all" : "pending";
  const where = { tenantId: user.tenantId, ...(show === "pending" && { verifyStatus: { not: "Verified" as const } }) };
  const [deposits, payments, users] = await Promise.all([
    db.poDeposit.findMany({
      where,
      include: { lines: { include: { receipt: { select: { receiptNo: true, policy: { select: { policyNumber: true, productType: true, partner: true, productName: true } } } } } } },
      orderBy: { depositDate: "desc" }, take: 100,
    }),
    db.companyPayment.findMany({
      where: { ...where, company: "Post Office" },
      include: { receipts: { select: { receiptNo: true, policy: { select: { policyNumber: true, productType: true, partner: true, productName: true } } } } },
      orderBy: { paidOn: "desc" }, take: 100,
    }),
    userNames(user.tenantId),
  ]);
  const nameOf = nameLookup(users);
  const canVerify = hasPermission(user.role, "DayBook.Create");

  const rows = [
    ...deposits.map((d) => ({
      kind: "PoDeposit" as const, id: d.id, date: d.depositDate, checkBy: `PO receipt ${d.poReceiptNo}`,
      receipts: d.lines.map((l) => l.receipt), amount: d.amount, status: d.verifyStatus, note: d.verifyNote, by: d.verifiedById, at: d.verifiedAt,
    })),
    ...payments.map((p) => ({
      kind: "CompanyPayment" as const, id: p.id, date: p.paidOn, checkBy: `Policy no. ${[...new Set(p.receipts.map((r) => r.policy?.policyNumber))].join(", ")}`,
      receipts: p.receipts, amount: p.amount, status: p.verifyStatus, note: p.verifyNote, by: p.verifiedById, at: p.verifiedAt,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <>
      <PageHeader title="Post office verification" user={user} actions={<Link href="/receipts" className={buttonVariants({ variant: "outline" })}>Receipts</Link>} />
      <div className="mb-4 flex gap-1 border-b">
        {FILTERS.map(([key, label]) => (
          <Link key={key} href={`?show=${key}`}
            className={cn("-mb-px border-b-2 px-3 py-2 text-sm", show === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {label}
          </Link>
        ))}
      </div>
      <div className="rounded-xl border bg-white p-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Check by</TableHead><TableHead>Scheme</TableHead><TableHead>Receipts</TableHead>
              <TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead>Checked by</TableHead>{canVerify && <TableHead>Check</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{fmtDate(r.date)}</TableCell>
                <TableCell>{r.checkBy}</TableCell>
                <TableCell>{[...new Set(r.receipts.map((x) => (x.policy ? schemeOf(x.policy) : "—")))].join(", ")}</TableCell>
                <TableCell className="text-sm">{r.receipts.map((x) => x.receiptNo).join(", ")}</TableCell>
                <TableCell className="text-right">{fmtINR(r.amount)}</TableCell>
                <TableCell>
                  <StatusBadge tone={TONE[r.status]}>{r.status}</StatusBadge>
                  {r.note && <span className="block text-xs text-muted-foreground">{r.note}</span>}
                </TableCell>
                <TableCell className="text-sm">{r.by ? <>{nameOf(r.by)}{r.at && <span className="block text-xs text-muted-foreground">{fmtDate(r.at)}</span>}</> : "—"}</TableCell>
                {canVerify && <TableCell>{r.status !== "Verified" && <VerifyForm kind={r.kind} id={r.id} />}</TableCell>}
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-4 text-center text-muted-foreground">Nothing to check.</TableCell></TableRow>}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          RD deposits are checked on the agent portal by the PO receipt number; other post office payments by policy number. Verified completes RD Collected → Deposited → Verified.
        </p>
      </div>
    </>
  );
}

import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { accountLabel, moneyAccounts } from "@/lib/accounts";
import { dropdownValues } from "@/lib/dropdowns";
import { canApprove, canCancel, expenseStatusLabel } from "@/lib/expenses";
import { fmtINR } from "@/lib/money";
import { EXPENSE_TABS as TABS, expenseFilter } from "@/lib/lists";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { ExpenseForm } from "./expense-form";
import { ExpenseRowActions } from "./row-actions";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requirePermission("Expense.View");
  const { tab, where } = expenseFilter(user, await searchParams);
  const [expenses, users, purposes, accounts] = await Promise.all([
    db.expense.findMany({
      where,
      include: { vendor: true },
      orderBy: [{ expenseDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    db.user.findMany({ where: { tenantId: user.tenantId }, select: { id: true, name: true } }),
    dropdownValues(db, user.tenantId, "expensePurpose"),
    moneyAccounts(db, user.tenantId),
  ]);
  const rows = tab === "approve" ? expenses.filter((e) => canApprove(user, e)) : expenses;
  // Paid = a live (not reversed) Day Book entry exists for the expense.
  const paidIds = new Set(
    (await db.dayBookEntry.findMany({
      where: { sourceType: "Expense", sourceId: { in: rows.map((e) => e.id) }, reversalOfId: null, reversedBy: { is: null } },
      select: { sourceId: true },
    })).map((x) => x.sourceId),
  );
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? "—";
  const canRepay = hasPermission(user.role, "Expense.Approve");

  return (
    <>
      <PageHeader title="Expenses" user={user} actions={<ExportButton report="expenses" user={user} params={{ tab }} />} />
      <div className="mb-4 flex items-start gap-4">
        <ExpenseForm categories={purposes} accounts={accounts.map((a) => ({ id: a.id, label: a.type === "Cash" ? "Office cash" : accountLabel(a), cash: a.type === "Cash" }))} today={isoDate(istToday())} userName={user.name} />
        <div className="w-96 shrink-0 rounded-xl border bg-white p-4 text-sm">
          <h2 className="mb-2 font-semibold">Approval rules</h2>
          <Table>
            <TableHeader><TableRow><TableHead>Amount</TableHead><TableHead>Who approves</TableHead></TableRow></TableHeader>
            <TableBody>
              <TableRow><TableCell>Up to ₹2,000</TableCell><TableCell className="whitespace-normal">No approval – saved; Admin and Super Admin can view</TableCell></TableRow>
              <TableRow><TableCell>₹2,001 – ₹5,000</TableCell><TableCell className="whitespace-normal">Admin (an Admin&apos;s own expense goes to Super Admin)</TableCell></TableRow>
              <TableRow><TableCell>Above ₹5,000</TableCell><TableCell>Super Admin</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            Bill number is required and unique per vendor. Expenses paid by an employee or the owner stay &quot;to be repaid&quot;; the repayment is what moves company money in the Day Book.
          </p>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-3 flex items-center gap-1 border-b">
          <h2 className="mr-4 pb-2 font-semibold">Expenses</h2>
          {TABS.filter(([k]) => k !== "approve" || hasPermission(user.role, "Expense.Approve")).map(([key, label]) => (
            <Link key={key} href={`/expenses?tab=${key}`}
              className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === key ? "border-brand-600 font-medium text-brand-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {label}
            </Link>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>No.</TableHead><TableHead>Date</TableHead><TableHead>Purpose</TableHead><TableHead>Vendor · bill no.</TableHead>
              <TableHead>Paid by</TableHead><TableHead>Mode</TableHead><TableHead className="text-right">Amount</TableHead><TableHead>Status</TableHead><TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => {
              const [label, tone] = expenseStatusLabel(e, paidIds.has(e.id));
              const note = e.rejectReason ?? e.cancelReason;
              return (
                <TableRow key={e.id}>
                  <TableCell>{e.expenseNo}</TableCell>
                  <TableCell>{fmtDate(e.expenseDate)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="text-muted-foreground">{e.category} · </span>{e.description}
                    {e.notes && <div className="text-xs">Notes: {e.notes}</div>}
                    <div className="text-xs text-muted-foreground">by {nameOf(e.createdById)}{e.approvedById && e.status !== "Cancelled" && ` · ${e.status === "Rejected" ? "rejected" : "approved"} by ${nameOf(e.approvedById)}`}{note && ` · ${note}`}</div>
                  </TableCell>
                  <TableCell>
                    {e.vendor.name} · {e.billNo}
                    {e.billPhotoPath && <a href={`/api/expenses/${e.id}/bill`} target="_blank" className="ml-1 text-xs text-brand-700 hover:underline">bill</a>}
                  </TableCell>
                  <TableCell>{e.paidBy === "Company" ? "Company" : `${e.paidBy}: ${e.paidByName}`}</TableCell>
                  <TableCell>{e.mode}</TableCell>
                  <TableCell className="text-right">{fmtINR(e.amount)}</TableCell>
                  <TableCell><StatusBadge tone={tone}>{label}</StatusBadge></TableCell>
                  <TableCell className="text-right">
                    <ExpenseRowActions
                      expenseId={e.id}
                      expenseNo={e.expenseNo}
                      amount={e.amount.toFixed(2)}
                      canApprove={canApprove(user, e)}
                      canCancel={canCancel(user, e)}
                      canRepay={canRepay && e.paidBy !== "Company" && e.repaymentStatus === "ToBeRepaid" && (e.status === "Saved" || e.status === "Approved")}
                      canPay={canRepay && e.paidBy === "Company" && e.status === "Approved" && !paidIds.has(e.id)}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 && <TableRow><TableCell colSpan={9} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

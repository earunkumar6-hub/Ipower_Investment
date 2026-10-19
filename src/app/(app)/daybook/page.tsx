import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { addDays, fmtDate, fmtDateTime, isoDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { CASH_SOURCES } from "@/lib/daybook-labels";
import { loadDayBook } from "@/lib/daybook-view";
import { dayBookDate } from "@/lib/lists";
import { fmtINR } from "@/lib/money";
import { hasPermission } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { AtmForm, CashCountForm, OtherIncomeForm, PoDepositForm, VerifyCloseForm } from "./daybook-forms";
import { DayBookTabs } from "./daybook-tabs";

export default async function DayBookPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await requirePermission("DayBook.View");
  const today = istToday();
  const date = dayBookDate(await searchParams, today);
  const d = await loadDayBook(user, date);
  const iso = isoDate(date);
  const s = (v: { toFixed(n: number): string }) => v.toFixed(2);
  const nameOf = (id: string | null) => d.admins.find((a) => a.id === id)?.name ?? "—";
  const canAddIncome = hasPermission(user.role, "DayBook.Close");
  const incomeAccounts = canAddIncome
    ? await db.account.findMany({ where: { tenantId: user.tenantId, type: { in: ["Cash", "Bank"] } }, select: { id: true, name: true }, orderBy: { type: "asc" } })
    : [];

  return (
    <>
      <PageHeader title="Day Book" user={user} actions={
        <div className="flex items-center gap-1">
          <Link href={`/daybook?date=${isoDate(addDays(date, -1))}`} className={buttonVariants({ variant: "outline", size: "sm" })}>←</Link>
          <span className="px-2 text-sm font-medium">{fmtDate(date)}</span>
          {date < today && <Link href={`/daybook?date=${isoDate(addDays(date, 1))}`} className={buttonVariants({ variant: "outline", size: "sm" })}>→</Link>}
          <StatusBadge tone={d.closed ? "slate" : "orange"}>{d.closed ? "CLOSED" : "OPEN"}</StatusBadge>
          <ExportButton report="daybook" user={user} params={{ date: iso }} />
        </div>
      } />

      {d.earlierOpen && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900">
          <span>The Day Book for {fmtDate(d.earlierOpen)} is still open. This day can&apos;t be closed until earlier days are closed.</span>
          <Link href={`/daybook?date=${isoDate(d.earlierOpen)}`} className="font-medium underline">Go to previous Day Book</Link>
        </div>
      )}
      {d.closed && (
        <div className="mb-4 rounded-xl border bg-slate-100 p-3 text-sm text-slate-700">
          Closed{d.closedAt && ` at ${fmtDateTime(d.closedAt)}`} by {nameOf(d.closedById)} · verified by {nameOf(d.verifiedById)}. Closed days are read-only; corrections are posted as reversals on an open day.
        </div>
      )}

      <div className="mb-4 grid grid-cols-5 gap-3">
        <StatCard title="Collections (inflow)" value={fmtINR(d.cards.collections)} sub={`Cash ${fmtINR(d.cards.collectionsCash)} · UPI/bank ${fmtINR(d.cards.collectionsBank)}`} />
        <StatCard title="Deposit to post office" value={fmtINR(d.cards.depositToPo)} sub="Cash out" />
        <StatCard title="ATM withdrawal" value={fmtINR(d.cards.atm)} sub="Bank → cash (transfer)" />
        <StatCard title="Expenses" value={fmtINR(d.cards.expenses)} sub={`Cash ${fmtINR(d.cards.expensesCash)} · bank ${fmtINR(d.cards.expensesBank)}`} />
        <StatCard title="Cash in hand" value={fmtINR(d.tally.counted ?? d.tally.computed)} sub={d.tally.counted ? "Counted" : "Computed – not counted yet"} highlight />
      </div>

      <div className="mb-4 flex items-start gap-4">
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Day Book transactions</h2>
          <DayBookTabs
            transactions={d.transactions.map((t) => ({ ...t, time: t.time.toISOString(), inAmount: t.inAmount && s(t.inAmount), outAmount: t.outAmount && s(t.outAmount) }))}
            byProduct={d.byProduct.map((g) => ({ label: g.label, amount: s(g.amount) }))}
            byScheme={d.byScheme.map((g) => ({ label: g.label, amount: s(g.amount) }))}
            byCustomer={d.byCustomer.map((g) => ({ label: g.label, amount: s(g.amount) }))}
            ownerPaid={d.ownerPaid.map((o) => ({ ...o, amount: s(o.amount) }))}
            accounts={d.accounts.map((a) => ({ name: a.name, opening: s(a.opening), totalIn: s(a.totalIn), totalOut: s(a.totalOut), closing: s(a.closing) }))}
            collectionsTotal={s(d.cards.collections)}
          />
        </div>
        <div className="w-80 shrink-0 rounded-xl border bg-white p-4 text-sm">
          <h2 className="mb-3 font-semibold">Cash tally</h2>
          <dl className="space-y-1.5">
            <Row label="Opening cash" value={fmtINR(d.tally.opening)} />
            {d.tally.lines.map((l) => (
              <Row key={l.label} label={`${l.amount.isNegative() ? "−" : "+"} ${l.label}`} value={fmtINR(l.amount.abs())} />
            ))}
            <Row label="Computed cash" value={fmtINR(d.tally.computed)} strong />
            <Row label="Counted cash" value={d.tally.counted ? fmtINR(d.tally.counted) : "—"} />
            <Row label="Difference" value={d.tally.difference ? fmtINR(d.tally.difference) : "—"} />
          </dl>
          <div className={cn("mt-3 rounded-lg p-2 text-xs font-medium",
            d.tally.counted === null ? "bg-slate-100 text-slate-700" : d.tally.tallied ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900")}>
            {d.tally.counted === null ? "Count the cash by source to tally." : d.tally.tallied ? "TALLIED – counted cash matches the Day Book." : `NOT TALLIED – difference ${fmtINR(d.tally.difference!)}.`}
          </div>
          {d.bankLine && (
            <p className="mt-3 text-xs text-muted-foreground">
              {d.bankLine.name}: {fmtINR(d.bankLine.opening)}
              {d.bankLine.lines.map((l) => ` ${l.amount.isNegative() ? "−" : "+"} ${fmtINR(l.amount.abs())} ${l.label.slice(2)}`).join("")} = <b>{fmtINR(d.bankLine.closing)}</b>
            </p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">Only cash movements count here. UPI, bank and cheque change the bank balance; an ATM withdrawal moves bank → cash and is never an expense.</p>
        </div>
      </div>

      <div className="grid grid-cols-[1fr_2fr] gap-4">
        <div className="space-y-4">
          <AtmForm date={iso} closed={d.closed} />
          <CashCountForm date={iso} closed={d.closed} initial={Object.fromEntries(CASH_SOURCES.map((k) => [k, d.cashBySource?.[k] ?? ""]))} />
          {canAddIncome && <OtherIncomeForm date={iso} closed={d.closed} accounts={incomeAccounts} />}
        </div>
        <div className="space-y-4">
          <PoDepositForm date={iso} closed={d.closed} receipts={d.collectedRd} atmToday={d.atmToday} isAdmin={hasPermission(user.role, "DayBook.Close")} />
          <VerifyCloseForm
            date={iso}
            closed={d.closed}
            admins={d.admins}
            verifiedById={d.verifiedById}
            canVerify={hasPermission(user.role, "DayBook.Verify")}
            canClose={hasPermission(user.role, "DayBook.Close")}
            ready={d.tally.tallied && !!d.verifiedById && !d.earlierOpen}
          />
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "border-t pt-1.5 font-semibold")}>
      <dt>{label}</dt><dd>{value}</dd>
    </div>
  );
}

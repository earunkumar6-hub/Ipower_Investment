import Link from "next/link";
import { AddLeadDialog } from "@/app/(app)/leads/add-lead-dialog";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { actionItems, adminDashboard, collectionsByStaff, ownerExtras, ownerPies, userDashboard } from "@/lib/dashboard";
import { fmtDate, fmtTime } from "@/lib/dates";
import { interestOptions, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { seesAll } from "@/lib/permissions";
import { requireUser, type SessionUser } from "@/lib/session";
import { CollectionsChart } from "./collections-chart";
import { DonutChart } from "./donut-chart";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requireUser();
  const { denied } = await searchParams;
  const owners = seesAll(user.role) ? (await userNames(user.tenantId)).filter((u) => u.role === "User") : [];
  const products = await interestOptions(user.tenantId);
  return (
    <>
      <PageHeader title="Dashboard" user={user} actions={<>
        <ExportButton report="dashboard" user={user} />
        <AddLeadDialog owners={owners} products={products} />
      </>} />
      {denied && <p className="mb-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800">You don&apos;t have access to that page.</p>}
      {user.role === "User" ? <UserView user={user} /> : <AdminView user={user} />}
    </>
  );
}

async function UserView({ user }: { user: SessionUser }) {
  const d = await userDashboard(user);
  const now = new Date();
  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard title="My leads" value={String(d.leads)} sub={`${d.newToday} new today`} href="/leads" />
        <StatCard title="My follow-ups today" value={String(d.callsToday)} sub={`${d.callsOverdue} overdue`} href="/leads" alert={d.callsOverdue > 0} />
        <StatCard title="My renewals due (7 days)" value={String(d.renewals.length)} sub={`${fmtINR(d.renewalsPremium)} premium`} href="/renewals?tab=due&within=7" />
        <StatCard title="My collections today" value={fmtINR(d.collections)} sub={`Cash ${fmtINR(d.collectionsCash)} · UPI ${fmtINR(d.collectionsOther)}`} href="/receipts" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Panel title="My calls today" more={{ href: "/followups", label: "All follow-ups" }}>
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Name</TableHead><TableHead>For</TableHead><TableHead>Last note</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.calls.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.dueAt < new Date(now.getTime() - 86_400_000) ? fmtDate(c.dueAt) : fmtTime(c.dueAt)}</TableCell>
                  <TableCell><Link href={c.party.href} className="text-brand-700 hover:underline">{c.party.name}</Link></TableCell>
                  <TableCell>{c.party.forLabel}</TableCell>
                  <TableCell className="max-w-48 truncate">{c.note ?? "—"}</TableCell>
                  <TableCell>{c.dueAt <= now ? <StatusBadge tone="red">Overdue</StatusBadge> : <StatusBadge tone="slate">Scheduled</StatusBadge>}</TableCell>
                </TableRow>
              ))}
              {d.calls.length === 0 && <Empty cols={5} text="No calls today." />}
            </TableBody>
          </Table>
        </Panel>
        <RenewalsPanel title="My renewals due this week" renewals={d.renewals} />
      </div>
      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-muted-foreground">
        Profit and Loss, bank balances and approvals are not shown to staff.
      </p>
    </>
  );
}

async function AdminView({ user }: { user: SessionUser }) {
  const owner = user.role === "SuperAdmin";
  const [d, o, pies, staff] = await Promise.all([
    adminDashboard(user),
    owner ? ownerExtras(user) : null,
    owner ? ownerPies(user) : null, // expense breakdown is a P&L figure: Owner only
    collectionsByStaff(user),
  ]);
  const actions = actionItems(d.actions);

  return (
    <>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <StatCard title="New leads today" value={String(d.newLeads)} sub={d.newLeadsBySource} href="/leads" />
        <StatCard title="Renewals due this week" value={String(d.renewals.length)} sub={`${fmtINR(d.renewalsPremium)} premium`} href="/renewals?tab=due&within=7" />
        <StatCard title="Unpaid / not renewed" value={String(d.overdueCount)} sub={d.overdueCount ? `Oldest ${d.oldestOverdueDays} days overdue` : "None"} href="/renewals?tab=overdue" alert={d.overdueCount > 0} />
        <StatCard title="Today's collections" value={fmtINR(d.collections)} sub={`Cash ${fmtINR(d.collectionsCash)} · UPI ${fmtINR(d.collectionsUpi)}`} href="/daybook" highlight />
        <StatCard title="Cash in hand" value={fmtINR(d.cashInHand)} sub={`Day Book: ${d.cashStatus}`} href="/daybook" alert={d.cashStatus === "NOT TALLIED"} />
        <StatCard title={d.bank.name} value={fmtINR(d.bank.closing)} sub="After ATM, cheques and transfers" href="/daybook" />
        <StatCard title="E-Sevai wallets" value={fmtINR(d.walletTotal)} sub={d.wallets.map((w) => `${w.name.replace(" wallet", "")} ${fmtINR(w.closing)}${w.low ? " (low)" : ""}`).join(" · ")} href="/esevai" alert={d.wallets.some((w) => w.low)} />
        <StatCard title="Waiting for approval" value={`${d.waitingCount} expenses`} sub={`${fmtINR(d.waitingAdmin)} Admin · ${fmtINR(d.waitingSuperAdmin)} Super Admin`} href="/expenses?tab=approve" />
        {o && (
          <>
            <StatCard title="Profit this month" value={fmtINR(o.profit)} sub={`Income ${fmtINR(o.income)} · expenses ${fmtINR(o.expenses)}`} href="/pnl" alert={o.profit.isNegative()} />
            <StatCard title="Owner money" value={fmtINR(o.ownerOwed)} sub={`Customers owe ${fmtINR(o.customerOwes)} · to return ${fmtINR(o.toReturn)}`} href="/receipts?tab=owner" />
          </>
        )}
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4">
        {pies && (
          <Panel title={`Expenses by category – ${pies.month}`} more={{ href: "/expenses", label: "Expenses" }}>
            <DonutChart slices={pies.expenses} totalLabel="Expenses" />
          </Panel>
        )}
        <Panel title={`Collections by staff – ${staff.month}`} more={{ href: "/receipts", label: "Receipts" }}>
          <DonutChart slices={staff.slices} totalLabel="Collected" />
        </Panel>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-4">
        <RenewalsPanel title="Renewals due this week" renewals={d.renewals} />
        <Panel title="Needs your action">
          <Table>
            <TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Detail</TableHead><TableHead>Who</TableHead></TableRow></TableHeader>
            <TableBody>
              {actions.map((x) => (
                <TableRow key={x.item + x.detail}>
                  <TableCell><Link href={x.href} className="text-brand-700 hover:underline">{x.item}</Link></TableCell>
                  <TableCell className="whitespace-normal">{x.detail}</TableCell>
                  <TableCell>{x.who}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      </div>
      {o && (
        <Panel title="Collections – last 7 days">
          <CollectionsChart data={o.week} />
        </Panel>
      )}
      <p className="mt-4 rounded-lg bg-slate-100 p-3 text-xs text-muted-foreground">
        Profit and Loss is shown only to the Super Admin.
      </p>
    </>
  );
}

function RenewalsPanel({ title, renewals }: { title: string; renewals: Awaited<ReturnType<typeof userDashboard>>["renewals"] }) {
  return (
    <Panel title={title} more={{ href: "/renewals?tab=due&within=7", label: "All renewals" }}>
      <Table>
        <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Due</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
        <TableBody>
          {renewals.map((r) => (
            <TableRow key={r.id}>
              <TableCell><Link href={`/customers/${r.policy.customer.id}`} className="text-brand-700 hover:underline">{r.policy.customer.name}</Link></TableCell>
              <TableCell>{r.policy.productType === "PoRd" ? `RD ${r.policy.policyNumber}` : `${r.policy.partner} ${r.policy.productName}`}</TableCell>
              <TableCell>{fmtDate(r.dueDate)}</TableCell>
              <TableCell className="text-right">{fmtINR(r.premiumAmount)}</TableCell>
            </TableRow>
          ))}
          {renewals.length === 0 && <Empty cols={4} text="Nothing due this week." />}
        </TableBody>
      </Table>
    </Panel>
  );
}

function Panel({ title, more, children }: { title: string; more?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold">{title}</h2>
        {more && <Link href={more.href} className="text-sm text-brand-700 hover:underline">{more.label}</Link>}
      </div>
      {children}
    </div>
  );
}

function Empty({ cols, text }: { cols: number; text: string }) {
  return <TableRow><TableCell colSpan={cols} className="py-4 text-center text-muted-foreground">{text}</TableCell></TableRow>;
}

import Link from "next/link";
import { ExportButton } from "@/components/export-button";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { accountLabel } from "@/lib/accounts";
import { fmtDate, fmtTime, istToday } from "@/lib/dates";
import { db, type Tx } from "@/lib/db";
import { ratesInForce } from "@/lib/esevai";
import { esevaiEntries, serviceTime, walletSummary } from "@/lib/esevai-day";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { hasPermission, seesAll } from "@/lib/permissions";
import { requirePermission } from "@/lib/session";
import { cn } from "@/lib/utils";
import { RechargeForm, ServiceEntryForm, type ServiceOption } from "./esevai-forms";

export default async function ESevaiPage() {
  const user = await requirePermission("Service.Record");
  const today = istToday();

  const [types, { txns, recharges }, wallets, accounts] = await Promise.all([
    db.serviceType.findMany({ where: { tenantId: user.tenantId } }),
    esevaiEntries(user, today),
    walletSummary(user.tenantId, today),
    db.account.findMany({ where: { tenantId: user.tenantId } }),
  ]);
  const ORDER = ["EB", "PAN", "CERT", "OTHER"]; // counter frequency
  types.sort((a, b) => ORDER.indexOf(a.code) - ORDER.indexOf(b.code));
  const options: ServiceOption[] = await Promise.all(
    types.map(async (t) => ({
      code: t.code,
      name: t.name,
      walletId: t.walletAccountId,
      allowBankPay: t.allowBankPay,
      rates: (await ratesInForce(db as unknown as Tx, t.id, today)).map((r) => ({
        min: r.minAmount?.toFixed(2) ?? null, max: r.maxAmount?.toFixed(2) ?? null, charge: r.serviceCharge?.toFixed(2) ?? null,
        cost: r.walletCost?.toFixed(2) ?? null, customer: r.fixedCustomerAmount?.toFixed(2) ?? null,
      })),
    })),
  );
  const accountName = (id: string) => { const a = accounts.find((x) => x.id === id); return a ? accountLabel(a) : "—"; };
  const activeWallets = accounts.filter((a) => a.type === "Wallet" && a.active).map((a) => ({ id: a.id, label: a.name }));
  const banks = accounts.filter((a) => a.type === "Bank" && a.active).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map((a) => ({ id: a.id, label: accountLabel(a) }));
  const PAID_VIA = { Wallet: "", GPay: "GPay direct · ", NetBanking: "Net banking direct · " } as const;
  const byCode = (code: string) => txns.filter((t) => t.serviceType.code === code);
  const total = (xs: typeof txns, f: (t: (typeof txns)[number]) => typeof ZERO) => (xs.length ? sum(xs.map(f)) : ZERO);
  const eb = byCode("EB"), pan = byCode("PAN"), cert = byCode("CERT");
  const cash = total(txns.filter((t) => t.paymentMode === "Cash"), (t) => t.customerAmount);
  const upi = total(txns.filter((t) => t.paymentMode !== "Cash"), (t) => t.customerAmount);

  return (
    <>
      <PageHeader title="ESEVAI &amp; CSC" user={user} actions={<ExportButton report="esevai" user={user} />} />
      <div className="mb-4 grid grid-cols-5 gap-3">
        <StatCard title="EB bills paid" value={`${eb.length} · ${fmtINR(total(eb, (t) => t.baseAmount))}`}
          sub={`${eb.filter((t) => accounts.find((a) => a.id === t.paidFromAccountId)?.type === "Wallet").length} from wallet · ${eb.filter((t) => accounts.find((a) => a.id === t.paidFromAccountId)?.type === "Bank").length} from bank`} />
        <StatCard title="Certificates" value={`${cert.length} · ${fmtINR(total(cert, (t) => t.customerAmount))}`} sub="Collected from customers" />
        <StatCard title="PAN – deducted from wallet" value={fmtINR(total(pan, (t) => t.walletCost))} sub={`${pan.length} applications`} />
        <StatCard title="Collected from customers" value={fmtINR(cash.plus(upi))} sub={`Cash ${fmtINR(cash)} · UPI ${fmtINR(upi)}`} highlight />
        <StatCard title="Wallet recharge today" value={fmtINR(recharges.length ? sum(recharges.map((r) => r.amount)) : ZERO)} sub={`${recharges.length} recharge(s)`} />
      </div>

      <div className="mb-4 flex items-start gap-4">
        <ServiceEntryForm services={options} wallets={activeWallets} banks={banks} />
        <div className="min-w-0 flex-1 rounded-xl border bg-white p-4">
          <h2 className="mb-2 font-semibold">Wallets</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead><TableHead>Wallet</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">Recharge</TableHead>
                <TableHead className="text-right">Deducted</TableHead><TableHead className="text-right">Closing</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {wallets.map((d) => {
                const low = d.lowThreshold;
                const isLow = low && d.closing.lt(low);
                return (
                  <TableRow key={d.accountId}>
                    <TableCell>{fmtDate(today)}</TableCell>
                    <TableCell>{d.name}</TableCell>
                    <TableCell className="text-right">{fmtINR(d.opening)}</TableCell>
                    <TableCell className="text-right">{fmtINR(d.recharge)}</TableCell>
                    <TableCell className="text-right">{fmtINR(d.deducted)}</TableCell>
                    <TableCell className={cn("text-right font-medium", isLow && "text-destructive")}>
                      {fmtINR(d.closing)}{isLow && <span className="block text-xs font-normal">below {fmtINR(low)}</span>}
                    </TableCell>
                    <TableCell className="text-right"><Link href={`/esevai/wallets/${d.accountId}`} className="text-xs text-brand-700 hover:underline">Statement</Link></TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hasPermission(user.role, "Wallet.Recharge") && (
            <RechargeForm wallets={activeWallets} banks={banks} />
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">Today&apos;s ESEVAI &amp; CSC entries{!seesAll(user.role) && " (yours)"}</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead><TableHead>Time</TableHead><TableHead>No.</TableHead><TableHead>Service</TableHead><TableHead>Customer</TableHead><TableHead>Service no. · txn no.</TableHead>
              <TableHead className="text-right">Bill / cost</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Profit</TableHead>
              <TableHead>Mode</TableHead><TableHead>Paid from</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {txns.map((t) => (
              <TableRow key={t.id}>
                <TableCell>{fmtDate(t.txnDate)}</TableCell>
                <TableCell>{serviceTime(t)}</TableCell>
                <TableCell><a href={`/api/esevai/${t.id}/pdf`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{t.txnNo}</a></TableCell>
                <TableCell>{t.serviceName ?? t.serviceType.name}</TableCell>
                <TableCell>
                  {t.customer ? <Link href={`/customers/${t.customer.id}`} className="text-brand-700 hover:underline">{t.customer.name}</Link> : t.customerName ?? "—"}                </TableCell>
                <TableCell>{[t.providerRef, t.providerTxnNo].filter(Boolean).join(" · ") || "—"}</TableCell>
                <TableCell className="text-right">{fmtINR(t.walletCost)}</TableCell>
                <TableCell className="text-right">{fmtINR(t.customerAmount)}</TableCell>
                <TableCell className="text-right">{fmtINR(t.profit)}</TableCell>
                <TableCell>{t.paymentMode}{t.reference && ` · ${t.reference}`}</TableCell>
                <TableCell>{PAID_VIA[t.paidVia]}{accountName(t.paidFromAccountId)}</TableCell>
              </TableRow>
            ))}
            {recharges.map((r) => (
              <TableRow key={r.id} className="bg-slate-50">
                <TableCell>{fmtDate(r.entryDate)}</TableCell><TableCell>{fmtTime(r.createdAt)}</TableCell><TableCell>—</TableCell><TableCell>Wallet recharge</TableCell><TableCell>—</TableCell>
                <TableCell>{accountName(r.accountId)}</TableCell><TableCell /><TableCell /><TableCell /><TableCell>{r.mode}</TableCell>
                <TableCell>{fmtINR(r.amount)} into {accountName(r.accountId)}</TableCell>
              </TableRow>
            ))}
            {txns.length + recharges.length === 0 && (
              <TableRow><TableCell colSpan={11} className="py-6 text-center text-muted-foreground">No entries today.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

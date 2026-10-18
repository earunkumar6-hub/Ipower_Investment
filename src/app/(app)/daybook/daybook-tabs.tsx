"use client";

import { useState } from "react";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

type Txn = {
  id: string; time: string; type: string; entryType: string; reversal: boolean; particulars: string; product: string;
  account: string; mode: string | null; inAmount: string | null; outAmount: string | null; notes: string | null;
};
type Group = { label: string; amount: string };
type Props = {
  transactions: Txn[]; byProduct: Group[]; byScheme: Group[]; byCustomer: Group[];
  ownerPaid: { slipNo: string; customer: string; account: string; amount: string; poReceiptNo: string }[];
  accounts: { name: string; opening: string; totalIn: string; totalOut: string; closing: string }[];
  collectionsTotal: string;
};

const TONE: Record<string, Tone> = {
  Collection: "blue", ServiceCollection: "blue", Withdrawal: "slate", DepositToBank: "slate", DepositToPo: "indigo",
  Expense: "orange", ExpenseRepayment: "orange", ServiceCost: "purple", WalletRecharge: "purple", OwnerReturn: "green", Adjustment: "red",
};
const inr = (v: string | null) => (v ? Number(v).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 }) : "");
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });

const TABS = ["Transactions", "By product", "By scheme", "By customer", "Owner-paid", "Accounts"] as const;

export function DayBookTabs(p: Props) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Transactions");
  return (
    <>
      <div className="mb-3 flex gap-1 border-b">
        {TABS.map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn("-mb-px border-b-2 px-3 pb-2 text-sm", tab === t ? "border-blue-600 font-medium text-blue-700" : "border-transparent text-muted-foreground hover:text-foreground")}>
            {t}
          </button>
        ))}
      </div>
      {tab === "Transactions" && (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Time</TableHead><TableHead>Type</TableHead><TableHead>Particulars</TableHead><TableHead>Product / scheme</TableHead><TableHead>Mode / account</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {p.transactions.map((t) => (
              <TableRow key={t.id} className={cn(t.reversal && "text-muted-foreground")}>
                <TableCell>{time(t.time)}</TableCell>
                <TableCell><StatusBadge tone={t.reversal ? "red" : TONE[t.entryType] ?? "slate"}>{t.reversal ? "Reversal" : t.type}</StatusBadge></TableCell>
                <TableCell className="whitespace-normal">{t.particulars}{t.notes && !t.particulars.includes(t.notes) && <div className="text-xs text-muted-foreground">{t.notes}</div>}</TableCell>
                <TableCell className="whitespace-normal">{t.product || "—"}</TableCell>
                <TableCell>{t.mode ? `${t.mode} · ` : ""}{t.account}</TableCell>
                <TableCell className="text-right">{inr(t.inAmount)}</TableCell>
                <TableCell className="text-right">{inr(t.outAmount)}</TableCell>
              </TableRow>
            ))}
            {p.transactions.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">No entries for this day.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
      {(tab === "By product" || tab === "By scheme" || tab === "By customer") && (
        <Table>
          <TableHeader><TableRow><TableHead>{tab.replace("By ", "").replace(/^./, (c) => c.toUpperCase())}</TableHead><TableHead className="text-right">Collected</TableHead></TableRow></TableHeader>
          <TableBody>
            {(tab === "By product" ? p.byProduct : tab === "By scheme" ? p.byScheme : p.byCustomer).map((g) => (
              <TableRow key={g.label}><TableCell>{g.label}</TableCell><TableCell className="text-right">{inr(g.amount)}</TableCell></TableRow>
            ))}
          </TableBody>
          {tab !== "By customer" && (
            <TableFooter><TableRow><TableCell>Total (= Collections card)</TableCell><TableCell className="text-right">{inr(p.collectionsTotal)}</TableCell></TableRow></TableFooter>
          )}
        </Table>
      )}
      {tab === "Owner-paid" && (
        <Table>
          <TableHeader><TableRow><TableHead>Slip</TableHead><TableHead>Customer</TableHead><TableHead>RD account</TableHead><TableHead>PO receipt no.</TableHead><TableHead className="text-right">Amount</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.ownerPaid.map((o) => (
              <TableRow key={o.slipNo}><TableCell>{o.slipNo}</TableCell><TableCell>{o.customer}</TableCell><TableCell>{o.account}</TableCell><TableCell>{o.poReceiptNo}</TableCell><TableCell className="text-right">{inr(o.amount)}</TableCell></TableRow>
            ))}
            {p.ownerPaid.length === 0 && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">No owner-paid instalments recorded this day.</TableCell></TableRow>}
          </TableBody>
          <TableFooter><TableRow><TableCell colSpan={5} className="text-xs font-normal text-muted-foreground">Owner-paid slips are not collections and move no company money.</TableCell></TableRow></TableFooter>
        </Table>
      )}
      {tab === "Accounts" && (
        <Table>
          <TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="text-right">Opening</TableHead><TableHead className="text-right">In</TableHead><TableHead className="text-right">Out</TableHead><TableHead className="text-right">Closing</TableHead></TableRow></TableHeader>
          <TableBody>
            {p.accounts.map((a) => (
              <TableRow key={a.name}><TableCell>{a.name}</TableCell><TableCell className="text-right">{inr(a.opening)}</TableCell><TableCell className="text-right">{inr(a.totalIn)}</TableCell><TableCell className="text-right">{inr(a.totalOut)}</TableCell><TableCell className="text-right font-medium">{inr(a.closing)}</TableCell></TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}

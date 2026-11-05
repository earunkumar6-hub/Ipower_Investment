import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type PaidRow = {
  id: string; customerId: string; customer: string; product: string; policyNumber: string; due: string; amount: string; paise: number;
  paidOn: string; receiptId: string | null; receiptNo: string | null; receiptHref: string | null; collectedBy: string | null; company: string;
  status: { state: "pending" | "paid"; text: string; payable: boolean };
};

/**
 * Paid tab: what was paid and whether the money reached the company. No tick boxes (owner, 4 Nov 2026) – a receipt is
 * paid to its company from the receipt's page ("Update deposit status").
 */
export function PaidTable({ rows }: { rows: PaidRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead><TableHead>Product</TableHead><TableHead>Policy / account</TableHead><TableHead>Due</TableHead>
          <TableHead className="text-right">Amount</TableHead><TableHead>Paid · receipt</TableHead><TableHead>Collected by</TableHead><TableHead>Paid to Post office / Insurer</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell><Link href={`/customers/${r.customerId}`} className="text-brand-700 hover:underline">{r.customer}</Link></TableCell>
            <TableCell>{r.product}</TableCell>
            <TableCell>{r.policyNumber}</TableCell>
            <TableCell>{r.due}</TableCell>
            <TableCell className="text-right">{r.amount}</TableCell>
            <TableCell className="text-sm">
              {r.paidOn} · {r.receiptHref ? <Link href={r.receiptHref} className="text-brand-700 hover:underline">{r.receiptNo}</Link> : "owner paid"}
            </TableCell>
            <TableCell className="text-sm">{r.collectedBy ?? "—"}</TableCell>
            <TableCell className="text-sm">
              {r.status.state === "paid" ? <span className="text-green-700">{r.status.text}</span> : <StatusBadge tone="orange">{r.status.text}</StatusBadge>}
            </TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Nothing here.</TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}

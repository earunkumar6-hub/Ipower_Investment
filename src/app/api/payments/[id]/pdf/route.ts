import { fmtDate, fmtTime, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { dueLabel } from "@/lib/payment-lines";
import { denominationText, modeText } from "@/lib/payment-options";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission, seesAll } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

// Customer copy of a payment covering several dues: one line per receipt. Never shows commission.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Receipt.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const p = await db.payment.findFirst({
    where: { id, tenantId: user.tenantId },
    include: { customer: true, receipts: { orderBy: { receiptNo: "asc" }, include: { policy: true } } },
  });
  if (!p || !(seesAll(user.role) || p.createdById === user.id || canActOn(user, p.customer.ownerId))) {
    return new Response("Not found", { status: 404 });
  }
  const [tenant, receivedBy] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    db.user.findUnique({ where: { id: p.createdById }, select: { name: true } }),
  ]);
  const cash = denominationText(p.denominations);
  const items = await db.renewalItem.findMany({ where: { id: { in: p.receipts.map((r) => r.renewalItemId).filter((x): x is string => !!x) } } });
  const lines = p.receipts.map((r) => `<tr>
      <td>${esc(r.receiptNo)}</td>
      <td>${esc(items.find((i) => i.id === r.renewalItemId)?.billNo ?? "—")}</td>
      <td>${esc(r.policy ? `${r.policy.partner} ${r.policy.productName} · ${r.policy.policyNumber}` : r.notes ?? "")}</td>
      <td>${esc(dueLabel(r, items))}</td>
      <td class="num">${esc(fmtINR(r.amount))}</td>
    </tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}
    .stamp { color:#b91c1c; border:2px solid #b91c1c; display:inline-block; padding:4px 10px; font-weight:700; transform:rotate(-6deg); }
  </style></head><body>
    ${pdfHeader(tenant.name, `<h1>Payment receipt</h1><div>${esc(p.paymentNo)}</div>`)}
    ${p.status === "Cancelled" ? `<p class="stamp">CANCELLED</p>` : ""}
    <table>
      <tr><th style="width:30%">Received from</th><td>${esc(p.customer.name)} · ${esc(p.customer.mobile)}</td></tr>
      <tr><th>Amount</th><td><b>${esc(fmtINR(p.amount))}</b></td></tr>
      <tr><th>Mode</th><td>${esc(modeText(p))}</td></tr>
      ${cash ? `<tr><th>Cash denomination</th><td>${esc(cash)}</td></tr>` : ""}
      <tr><th>Bill date</th><td>${esc(fmtDate(p.receiptDate))}${istDate(p.createdAt).getTime() === p.receiptDate.getTime() ? `, ${esc(fmtTime(p.createdAt))}` : ""}</td></tr>
      <tr><th>Transaction date</th><td>${esc(fmtDate(p.txnDate))}</td></tr>
      <tr><th>Received by</th><td>${esc(receivedBy?.name ?? "—")}</td></tr>
    </table>
    <table>
      <thead><tr><th>Receipt no.</th><th>Bill no.</th><th>Towards</th><th>Due</th><th class="num">Amount</th></tr></thead>
      <tbody>${lines}</tbody>
      <tfoot><tr class="total"><td colspan="4">Total</td><td class="num">${esc(fmtINR(p.amount))}</td></tr></tfoot>
    </table>
    <p class="muted" style="margin-top:24px">Premiums and deposits are collected on behalf of the insurer or post office. This is a computer-generated receipt.</p>
  </body></html>`;

  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${p.paymentNo}.pdf"` },
  });
}

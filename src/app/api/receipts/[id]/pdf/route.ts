import { fmtDate, fmtTime, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { denominationText, modeText } from "@/lib/payment-options";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission, seesAll } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

// Customer copy: never shows commission.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Receipt.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const r = await db.receipt.findFirst({ where: { id, tenantId: user.tenantId }, include: { customer: true, policy: true, renewalItems: { select: { billNo: true } } } });
  if (!r || !(seesAll(user.role) || r.createdById === user.id || canActOn(user, r.customer.ownerId))) {
    return new Response("Not found", { status: 404 });
  }
  const [tenant, receivedBy] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    db.user.findUnique({ where: { id: r.createdById }, select: { name: true } }),
  ]);
  const cash = denominationText(r.denominations);
  const forText = r.policy ? `${r.policy.partner} ${r.policy.productName} · ${r.policy.policyNumber}` : r.notes ?? "";

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}
    .stamp { color:#b91c1c; border:2px solid #b91c1c; display:inline-block; padding:4px 10px; font-weight:700; transform:rotate(-6deg); }
  </style></head><body>
    ${pdfHeader(tenant.name, `<h1>Receipt</h1><div>${esc(r.receiptNo)}</div>`)}
    ${r.status === "Cancelled" ? `<p class="stamp">CANCELLED</p>` : ""}
    <table>
      <tr><th style="width:30%">Received from</th><td>${esc(r.customer.name)} · ${esc(r.customer.mobile)}</td></tr>
      <tr><th>Towards</th><td>${esc(forText)}${r.ownerPaid ? " (instalment paid earlier at the post office)" : ""}</td></tr>
      <tr><th>Amount</th><td><b>${esc(fmtINR(r.amount))}</b></td></tr>
      ${r.renewalItems[0] ? `<tr><th>Bill no.</th><td>${esc(r.renewalItems[0].billNo)}</td></tr>` : ""}
      <tr><th>Mode</th><td>${esc(modeText(r))}</td></tr>
      ${cash ? `<tr><th>Cash denomination</th><td>${esc(cash)}</td></tr>` : ""}
      <tr><th>Bill date</th><td>${esc(fmtDate(r.receiptDate))}${istDate(r.createdAt).getTime() === r.receiptDate.getTime() ? `, ${esc(fmtTime(r.createdAt))}` : ""}</td></tr>
      <tr><th>Transaction date</th><td>${esc(fmtDate(r.txnDate))}</td></tr>
      <tr><th>Received by</th><td>${esc(receivedBy?.name ?? "—")}</td></tr>
    </table>
    <p class="muted" style="margin-top:24px">Premiums and deposits are collected on behalf of the insurer or post office. This is a computer-generated receipt.</p>
  </body></html>`;

  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${r.receiptNo}.pdf"` },
  });
}

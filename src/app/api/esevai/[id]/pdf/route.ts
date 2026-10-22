import { fmtDate } from "@/lib/dates";
import { serviceTime } from "@/lib/esevai-day";
import { db } from "@/lib/db";
import { fmtINR } from "@/lib/money";
import { denominationText } from "@/lib/payment-options";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission, seesAll } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

// Customer copy of an E-Sevai / CSC entry ("Save and print receipt"). Shows what the customer paid, not the provider cost.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Service.Record")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const t = await db.serviceTransaction.findFirst({ where: { id, tenantId: user.tenantId }, include: { serviceType: true } });
  if (!t || !(seesAll(user.role) || t.createdById === user.id)) return new Response("Not found", { status: 404 });
  const [tenant, by] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    db.user.findUnique({ where: { id: t.createdById }, select: { name: true } }),
  ]);
  const cash = denominationText(t.denominations);
  const row = (k: string, v: string | null | undefined) => (v ? `<tr><th style="width:30%">${esc(k)}</th><td>${esc(v)}</td></tr>` : "");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}</style></head><body>
    ${pdfHeader(tenant.name, `<h1>E-Sevai receipt</h1><div>${esc(t.txnNo)}</div>`)}
    <table>
      ${row("Customer", [t.customerName, t.customerMobile].filter(Boolean).join(" · ") || "—")}
      ${row("Service", t.serviceName ?? t.serviceType.name)}
      ${row(t.serviceType.code === "EB" ? "Consumer / service no." : "Service / application no.", t.providerRef)}
      ${row("Transaction no.", t.providerTxnNo)}
      <tr><th>Amount received</th><td><b>${esc(fmtINR(t.customerAmount))}</b></td></tr>
      ${row("Paid by", t.paymentMode === "Cash" ? "Cash" : `UPI${t.reference ? ` · ${t.reference}` : ""}`)}
      ${row("Cash denomination", cash)}
      ${row("Date", fmtDate(t.txnDate))}
      ${row("Time", serviceTime(t))}
      ${row("Received by", by?.name)}
      ${row("Notes", t.notes)}
    </table>
    <p class="muted" style="margin-top:24px">Bills and fees are paid on your behalf to the board / department concerned. This is a computer-generated receipt.</p>
  </body></html>`;
  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${t.txnNo}.pdf"` } });
}

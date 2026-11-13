import { fmtDate, fmtTime, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { fmtINR } from "@/lib/money";
import { denominationText, modeText } from "@/lib/payment-options";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission, seesAllRecords } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

// Payer copy of a direct bill.
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Receipt.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const b = await db.directBill.findFirst({ where: { id, tenantId: user.tenantId } });
  if (!b || !(seesAllRecords(user.role) || b.createdById === user.id)) return new Response("Not found", { status: 404 });
  const [tenant, receivedBy] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    db.user.findUnique({ where: { id: b.createdById }, select: { name: true } }),
  ]);
  const cash = denominationText(b.denominations);

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}
    .stamp { color:#b91c1c; border:2px solid #b91c1c; display:inline-block; padding:4px 10px; font-weight:700; transform:rotate(-6deg); }
  </style></head><body>
    ${pdfHeader(tenant.name, `<h1>Bill</h1><div>${esc(b.billNo)}</div>`)}
    ${b.status === "Cancelled" ? `<p class="stamp">CANCELLED</p>` : ""}
    <table>
      <tr><th style="width:30%">Received from</th><td>${esc(b.payerName)} · ${esc(b.payerMobile)}</td></tr>
      <tr><th>Towards</th><td>${esc(b.purpose)}</td></tr>
      <tr><th>Amount</th><td><b>${esc(fmtINR(b.amount))}</b></td></tr>
      <tr><th>Mode</th><td>${esc(modeText(b))}</td></tr>
      ${cash ? `<tr><th>Cash denomination</th><td>${esc(cash)}</td></tr>` : ""}
      <tr><th>Bill date</th><td>${esc(fmtDate(b.billDate))}${istDate(b.createdAt).getTime() === b.billDate.getTime() ? `, ${esc(fmtTime(b.createdAt))}` : ""}</td></tr>
      <tr><th>Received by</th><td>${esc(receivedBy?.name ?? "—")}</td></tr>
    </table>
    <p class="muted" style="margin-top:24px">This is a computer-generated bill.</p>
  </body></html>`;

  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${b.billNo}.pdf"` },
  });
}

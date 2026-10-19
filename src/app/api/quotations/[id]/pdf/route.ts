import { fmtDate, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { esc, htmlToPdf, htmlToPng, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission } from "@/lib/permissions";
import { PAY_MODE_LABEL } from "@/lib/products";
import { getSessionUser } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Quote.View")) return new Response("Not allowed", { status: 403 });
  const { id } = await params;
  const q = await db.quotation.findFirst({ where: { id, tenantId: user.tenantId }, include: { items: true } });
  if (!q || !canActOn(user, q.ownerId)) return new Response("Not found", { status: 404 });
  const [tenant, users] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    userNames(user.tenantId),
  ]);

  const rows = q.items.map((i) => `
    <tr>
      <td>${esc(i.category)}</td>
      <td>${esc(i.insurer)} – ${esc(i.productName)}</td>
      <td>${esc(PAY_MODE_LABEL[i.payMode])}</td>
      <td class="num">${i.sumInsured ? esc(fmtINR(i.sumInsured)) : "—"}</td>
      <td class="num">${esc(fmtINR(i.premium))}</td>
      <td class="num">${esc(fmtINR(i.gstAmount))}</td>
      <td class="num">${esc(fmtINR(i.total))}</td>
    </tr>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}</style></head><body>
    ${pdfHeader(tenant.name, `<h1>Quotation</h1><div>${esc(q.quoteNo)}</div>`)}
    <p>
      <b>${esc(q.customerName)}</b> · ${esc(q.mobile)}<br>
      <span class="muted">Date ${esc(fmtDate(istDate(q.createdAt)))} · Valid till ${esc(fmtDate(q.validUpto))} · Prepared by ${esc(users.find((u) => u.id === q.ownerId)?.name ?? "")}</span>
    </p>
    <table>
      <thead><tr><th>Product</th><th>Plan</th><th>Pay mode</th><th class="num">Sum insured / cover</th><th class="num">Premium</th><th class="num">GST 18%</th><th class="num">Total</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total"><td colspan="4">Total payable</td><td class="num">${esc(fmtINR(q.subtotal))}</td><td class="num">${esc(fmtINR(q.gstTotal))}</td><td class="num">${esc(fmtINR(q.total))}</td></tr></tfoot>
    </table>
    <p class="muted" style="margin-top:24px">Premiums are indicative and subject to the insurer's underwriting. GST at 18% as applicable. Premiums are paid to the insurer; we collect them on the insurer's behalf.</p>
  </body></html>`;

  // ?format=png: the same quotation as an image, to share on WhatsApp.
  if (new URL(req.url).searchParams.get("format") === "png") {
    const png = await htmlToPng(html);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Content-Disposition": `attachment; filename="${q.quoteNo}.png"` },
    });
  }
  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${q.quoteNo}.pdf"` },
  });
}

import { fmtDate, istDate } from "@/lib/dates";
import { db } from "@/lib/db";
import { canActOn, userNames } from "@/lib/leads";
import { fmtINR } from "@/lib/money";
import { esc, htmlToPdf, htmlToPng, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission } from "@/lib/permissions";
import { amountHeader, amountKindOfQuoteRow, isMfCategory, payModeLabel, rowHasNoCover } from "@/lib/products";
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

  // Mutual fund rows: SIP / Lumpsum and investment amount, no cover column when every row is a mutual fund.
  const anyMf = q.items.some((i) => isMfCategory(i.category)), allMf = q.items.every((i) => isMfCategory(i.category));
  // No cover column either when every row is a post office investment or a mutual fund (owner, 10 Nov 2026).
  const showCover = q.items.some((i) => !rowHasNoCover(i));
  const rows = q.items.map((i) => `
    <tr>
      <td>${esc(i.category)}</td>
      <td>${esc(i.insurer)} – ${esc(i.productName)}</td>
      <td>${esc(payModeLabel(i.payMode, isMfCategory(i.category)))}</td>
      ${showCover ? `<td class="num">${i.sumInsured ? esc(fmtINR(i.sumInsured)) : "—"}</td>` : ""}
      <td class="num">${i.premium.gt(0) ? esc(fmtINR(i.premium)) : "—"}</td>
    </tr>`).join("");
  // Money column: Premium / Investment amount / Amount (post office schemes other than PLI), "Premium / amount" when mixed.
  const kinds = q.items.map(amountKindOfQuoteRow);
  const notes = [
    kinds.includes("premium") && "Premiums are indicative and subject to the insurer's underwriting. Premiums are paid to the insurer; we collect them on the insurer's behalf.",
    anyMf && "Mutual fund investments are subject to market risks; read all scheme related documents carefully.",
  ].filter(Boolean).map((t) => `<p class="muted" style="margin-top:${allMf || !anyMf ? 24 : 8}px">${esc(String(t))}</p>`).join("");

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}</style></head><body>
    ${pdfHeader(tenant.name, `<h1>Quotation</h1><div>${esc(q.quoteNo)}</div>`)}
    <p>
      <b>${esc(q.customerName)}</b> · ${esc(q.mobile)}<br>
      <span class="muted">Date ${esc(fmtDate(istDate(q.createdAt)))} · Valid till ${esc(fmtDate(q.validUpto))} · Prepared by ${esc(users.find((u) => u.id === q.ownerId)?.name ?? "")}</span>
    </p>
    <table>
      <thead><tr><th>Product</th><th>${allMf ? "Scheme" : anyMf ? "Plan / scheme" : "Plan"}</th><th>${allMf ? "SIP / Lumpsum" : "Pay mode"}</th>${showCover ? `<th class="num">Sum insured / cover</th>` : ""}<th class="num">${amountHeader(kinds)}</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total"><td colspan="${showCover ? 4 : 3}">${allMf ? "Total investment" : "Total payable"}</td><td class="num">${q.total.gt(0) ? esc(fmtINR(q.total)) : "—"}</td></tr></tfoot>
    </table>
    ${notes}
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

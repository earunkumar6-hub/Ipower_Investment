import { fmtDate, istToday } from "@/lib/dates";
import { db } from "@/lib/db";
import { canWorkOn } from "@/lib/leads";
import { fmtINR, sum, ZERO } from "@/lib/money";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";
import { hasPermission } from "@/lib/permissions";
import { getSessionUser } from "@/lib/session";

const isoDay = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00Z`) : null);
const monthLabel = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Instalments by date (#23): a bill (no payment) for a customer or a bill group.
 * kind=late → the overdue bills up to To; kind=advance → the advance bills raised (Due, after this month) from From to To.
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !hasPermission(user.role, "Receipt.Create")) return new Response("Not allowed", { status: 403 });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") === "advance" ? "advance" : "late";
  const customerId = url.searchParams.get("customerId"), billGroupId = url.searchParams.get("billGroupId");
  const from = isoDay(url.searchParams.get("from")), to = isoDay(url.searchParams.get("to"));
  if (!to || (!customerId && !billGroupId)) return new Response("Pick a customer or bill group and the To date", { status: 400 });
  const today = istToday();
  const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));

  const [tenant, group, customer] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    billGroupId ? db.billGroup.findFirst({ where: { id: billGroupId, tenantId: user.tenantId } }) : null,
    customerId ? db.customer.findFirst({ where: { id: customerId, tenantId: user.tenantId } }) : null,
  ]);
  if (!group && !customer) return new Response("Not found", { status: 404 });
  const items = await db.renewalItem.findMany({
    where: {
      tenantId: user.tenantId,
      policy: { status: "Active", ...(group ? { billGroup: { billGroupId: group.id } } : { customerId: customer!.id }) },
      ...(kind === "late"
        ? { status: { in: ["Due", "Overdue"] }, dueDate: { lte: to, lt: today } }
        : { status: "Due", dueDate: { gt: monthEnd, lte: to, ...(from && { gte: from }) } }),
    },
    include: { policy: { include: { customer: { select: { name: true, ownerId: true } } } } },
    orderBy: [{ policy: { customer: { name: "asc" } } }, { dueDate: "asc" }],
  });
  if (items.some((i) => !canWorkOn(user, i.policy.customer.ownerId))) return new Response("Some bills belong to another user's customers", { status: 403 });

  const total = items.length ? sum(items.map((i) => i.premiumAmount)) : ZERO;
  const rows = items.map((i) => `<tr>
      <td>${esc(i.billNo)}</td>${group ? `<td>${esc(i.policy.customer.name)}</td>` : ""}
      <td>${esc(i.policy.productType === "PoRd" ? `${i.policy.policyNumber} · Post office RD` : `${i.policy.partner} ${i.policy.productName} · ${i.policy.policyNumber}`)}</td>
      <td>${esc(i.policy.frequency === "Monthly" ? monthLabel(i.dueDate) : fmtDate(i.dueDate))}</td>
      <td class="num">${esc(fmtINR(i.premiumAmount))}</td>
    </tr>`).join("");
  const title = kind === "late" ? "Late bill" : "Advance bills";
  const to_ = group ? `${group.name}${group.contactName ? ` · ${group.contactName}` : ""}` : `${customer!.name} · ${customer!.mobile}`;

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}</style></head><body>
    ${pdfHeader(tenant.name, `<h1>${title}</h1><div>${esc(fmtDate(today))}</div>`)}
    <table>
      <tr><th style="width:30%">${group ? "Bill group" : "Customer"}</th><td>${esc(to_)}</td></tr>
      <tr><th>Bills</th><td>${kind === "late" ? `Overdue up to ${esc(fmtDate(to))}` : `${from ? `${esc(fmtDate(from))} – ` : "Up to "}${esc(fmtDate(to))}`}</td></tr>
    </table>
    <table>
      <thead><tr><th>Bill no.</th>${group ? "<th>Customer</th>" : ""}<th>Policy / account</th><th>Due</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${group ? 5 : 4}">No bills in this range.</td></tr>`}</tbody>
      <tfoot><tr class="total"><td colspan="${group ? 4 : 3}">Total</td><td class="num">${esc(fmtINR(total))}</td></tr></tfoot>
    </table>
    <p class="muted" style="margin-top:24px">${kind === "late" ? "These instalments are overdue. Please pay at the earliest to keep the policy / account active." : "Advance instalments raised at your request; pay any time before the due date."} This is a computer-generated bill, not a receipt.</p>
  </body></html>`;
  const pdf = await htmlToPdf(html);
  return new Response(new Uint8Array(pdf), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${kind === "late" ? "late-bill" : "advance-bills"}.pdf"` },
  });
}

import { Prisma } from "@prisma/client";
import { ADVISOR } from "@/lib/brand";
import { fmtDate, fmtDmy, fmtTime, istDate } from "@/lib/dates";
import type { Cell, ColType, Sheet } from "@/lib/excel";
import { fmtINR, sum } from "@/lib/money";
import { esc, htmlToPdf, PDF_STYLE, pdfHeader } from "@/lib/pdf";

// PDF version of an Excel export: same sheets and rows, one table per sheet, on the letterhead.

const isAmount = (v: Cell): v is number | Prisma.Decimal => typeof v === "number" || v instanceof Prisma.Decimal;

function text(v: Cell, type: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  if (type === "money" && isAmount(v)) return fmtINR(v);
  // DATE columns are UTC midnight already; timestamps are shown in IST.
  if (v instanceof Date) return type === "datetime" ? `${fmtDate(istDate(v))}, ${fmtTime(v)}` : type === "dmy" ? fmtDmy(v) : fmtDate(v);
  return String(v);
}

function table(sheet: Sheet) {
  const types = sheet.columns.map((c) => c.type ?? "text");
  const cls = (i: number) => (types[i] === "money" ? ` class="num"` : "");
  const head = sheet.columns.map((c, i) => `<th${cls(i)}>${esc(c.header)}</th>`).join("");
  const body = sheet.rows.length
    ? sheet.rows.map((r) => `<tr>${types.map((t, i) => `<td${cls(i)}>${esc(text(r[i], t))}</td>`).join("")}</tr>`).join("")
    : `<tr><td colspan="${types.length}" class="muted">Nothing here.</td></tr>`;
  const totals = sheet.totals && sheet.rows.length
    ? `<tfoot><tr class="total">${types.map((t, i) =>
      `<td${cls(i)}>${t === "money" ? esc(fmtINR(sum(sheet.rows.map((r) => r[i]).filter(isAmount)))) : i === 0 ? "Total" : ""}</td>`).join("")}</tr></tfoot>`
    : "";
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table>`;
}

export async function reportPdf(company: string, title: string, sheets: Sheet[]): Promise<Buffer> {
  // Wide lists (receipts, expenses, day book) go landscape with a smaller font.
  const wide = sheets.some((s) => s.columns.length > 7);
  const now = new Date();
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>${PDF_STYLE}
    h2 { font-size: 14px; margin: 22px 0 0; }
    table { font-size: ${wide ? 10 : 11}px; }
    th, td { padding: 5px 6px; }
    tr { break-inside: avoid; }
    tfoot { display: table-row-group; } /* print the total once, at the end, not on every page */
  </style></head><body>
    ${pdfHeader(company, `<h1 style="font-size:16px">${esc(title)}</h1><div class="muted">Generated ${esc(fmtDate(istDate(now)))}, ${esc(fmtTime(now))}</div>`)}
    ${sheets.map((s) => `${sheets.length > 1 ? `<h2>${esc(s.name)}</h2>` : ""}${table(s)}`).join("")}
  </body></html>`;
  return htmlToPdf(html, { landscape: wide, footer: `${company} · ${ADVISOR}` });
}

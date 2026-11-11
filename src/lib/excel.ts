import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";
import { ADVISOR, logoPng, TAGLINE } from "@/lib/brand";

// Excel downloads for Admin and Super Admin. Amounts go in as numbers (so totals and
// formulas work in Excel), business dates as dates, timestamps as IST wall-clock time.

/** `dmy`: a date shown as dd/mm/yyyy (date of birth). */
export type ColType = "text" | "money" | "date" | "dmy" | "datetime";
export type Col = { header: string; type?: ColType; width?: number };
export type Cell = string | number | Date | Prisma.Decimal | null | undefined;
/** `totals`: add a SUM row under every money column. */
export type Sheet = { name: string; columns: Col[]; rows: Cell[][]; totals?: boolean };

const FORMAT: Record<ColType, string | undefined> = {
  text: undefined,
  money: "#,##0.00",
  date: "dd/mm/yyyy",
  dmy: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy h:mm AM/PM",
};
const IST_OFFSET_MS = 5.5 * 3_600_000;

function value(v: Cell, type: ColType): ExcelJS.CellValue {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Prisma.Decimal) return v.toNumber();
  // Excel has no time zones: shift timestamps so the cell shows IST. DATE columns are UTC midnight already.
  if (v instanceof Date) return type === "datetime" ? new Date(v.getTime() + IST_OFFSET_MS) : v;
  return v;
}

const col = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

// Rows 1-3: logo with company, tagline and advisor beside it; row 4: report title; row 5: column headers.
const TITLE_ROW = 4;
const HEADER_ROW = TITLE_ROW + 1;

/** Letterhead, title row, header row, data rows; header frozen. Returns an attachment response. */
export async function xlsxResponse(filename: string, company: string, title: string, sheets: Sheet[]) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const logo = wb.addImage({ buffer: logoPng() as unknown as ArrayBuffer, extension: "png" });
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31), { views: [{ state: "frozen", ySplit: HEADER_ROW }] });
    const types = sheet.columns.map((c) => c.type ?? "text");

    ws.addImage(logo, { tl: { col: 0.1, row: 0.1 }, ext: { width: 64, height: 64 }, editAs: "absolute" });
    const letterhead: [string, Partial<ExcelJS.Font>][] = [
      [company, { bold: true, size: 14 }],
      [TAGLINE, { italic: true, color: { argb: "FF64748B" } }],
      [ADVISOR, { bold: true, color: { argb: "FFB01B21" } }],
    ];
    letterhead.forEach(([text, font], i) => {
      const cell = ws.getCell(i + 1, 1);
      cell.value = text;
      cell.font = font;
      cell.alignment = { vertical: "middle", indent: 8 }; // clears the logo
      ws.getRow(i + 1).height = 18;
    });

    ws.getCell(TITLE_ROW, 1).value = title;
    ws.getCell(TITLE_ROW, 1).font = { bold: true, size: 12 };
    ws.getRow(TITLE_ROW).height = 22;
    const header = ws.getRow(HEADER_ROW);
    sheet.columns.forEach((c, i) => {
      header.getCell(i + 1).value = c.header;
      ws.getColumn(i + 1).width = c.width ?? (types[i] === "text" ? 18 : 14);
      if (FORMAT[types[i]]) ws.getColumn(i + 1).numFmt = FORMAT[types[i]]!;
      if (types[i] === "money") header.getCell(i + 1).alignment = { horizontal: "right" };
    });
    header.font = { bold: true };
    header.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } }));

    for (const r of sheet.rows) ws.addRow(r.map((v, i) => value(v, types[i])));

    if (sheet.totals && sheet.rows.length) {
      const first = HEADER_ROW + 1, last = HEADER_ROW + sheet.rows.length;
      const total = ws.addRow(types.map((t, i) => (t === "money" ? { formula: `SUM(${col(i)}${first}:${col(i)}${last})` } : i === 0 ? "Total" : null)));
      total.font = { bold: true };
    }
    if (!sheet.rows.length) ws.addRow(["Nothing here."]);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

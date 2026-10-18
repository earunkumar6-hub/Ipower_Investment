import type { Browser } from "playwright";
import { ADVISOR, logoPng, TAGLINE } from "@/lib/brand";

// One headless Chromium per server process, launched on first use.
const globalForPdf = globalThis as unknown as { pdfBrowser?: Promise<Browser> };

async function browser() {
  globalForPdf.pdfBrowser ??= import("playwright").then(({ chromium }) => chromium.launch());
  const b = await globalForPdf.pdfBrowser;
  if (!b.isConnected()) {
    globalForPdf.pdfBrowser = undefined;
    return browser();
  }
  return b;
}

/** `footer`: text printed bottom-left of every page, with "Page x of y" on the right. */
export async function htmlToPdf(html: string, opts: { landscape?: boolean; footer?: string } = {}): Promise<Buffer> {
  const page = await (await browser()).newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({
      format: "A4",
      landscape: opts.landscape,
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
      ...(opts.footer !== undefined && {
        displayHeaderFooter: true,
        headerTemplate: "<span></span>",
        footerTemplate: `<div style="font-size:8px;color:#64748b;width:100%;padding:0 14mm;display:flex;justify-content:space-between">
          <span>${esc(opts.footer)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      }),
    });
  } finally {
    await page.close();
  }
}

/** Company logo for PDF headers, inlined so the headless page needs no URL. */
let logoTag: string | undefined;
export function pdfLogo() {
  logoTag ??= `<img class="logo" alt="" src="data:image/png;base64,${logoPng().toString("base64")}">`;
  return logoTag;
}

/** Letterhead: logo, company, tagline and advisor on the left; `right` is trusted HTML (document title, number). */
export function pdfHeader(company: string, right: string) {
  return `<div class="header">
      <div class="brand">${pdfLogo()}<div><h1>${esc(company)}</h1><div class="muted">${esc(TAGLINE)}</div><div class="advisor">${esc(ADVISOR)}</div></div></div>
      <div style="text-align:right">${right}</div>
    </div>`;
}

/** Escape text for the HTML templates. */
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PDF_STYLE = `
  body { font-family: Arial, Helvetica, sans-serif; color: #0f172a; font-size: 12px; }
  h1 { font-size: 20px; margin: 0; }
  .muted { color: #64748b; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e2e8f0; }
  th { background: #f1f5f9; font-weight: 600; }
  .num { text-align: right; }
  .total td { font-weight: 700; border-top: 2px solid #0f172a; }
  .header { display: flex; justify-content: space-between; border-bottom: 3px solid #1d4ed8; padding-bottom: 10px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .logo { height: 60px; }
  .advisor { font-weight: 600; color: #1d4ed8; margin-top: 2px; }
`;

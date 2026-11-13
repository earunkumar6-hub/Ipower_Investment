import { expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { AppShell } from "./app-shell";

export class RenewalsPage extends AppShell {
  constructor(page: Page) { super(page); }
  async goto(query = "") {
    await this.page.goto(`/renewals${query}`);
    await expect(this.heading("Renewals")).toBeVisible();
  }
  tab = (name: string) => this.page.getByRole("link", { name, exact: true });
  view = () => this.page.getByLabel("View");
  bodyRows = () => this.page.locator("main table").first().locator("tbody tr");
  rowFor = (policyNo: string) => this.bodyRows().filter({ hasText: policyNo });
  async setRange(fromDmy: string, toDmy: string) {
    await this.view().selectOption({ label: "Custom dates" }); // shows the From / To boxes (spec #19)
    await this.page.getByLabel("From date").fill(fromDmy);
    await this.page.getByLabel("To date").fill(toDmy);
    await this.page.getByRole("button", { name: "Show renewals" }).click();
    await this.page.waitForURL(/from=/);
  }
  /** Downloads the current tab's Excel through the Download menu and returns its first sheet. */
  async downloadExcel() {
    await this.page.getByRole("button", { name: "Download" }).click();
    const [dl] = await Promise.all([this.page.waitForEvent("download"), this.page.getByRole("menuitem", { name: "Excel" }).click()]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(await dl.path());
    return wb.worksheets[0];
  }
}

/** Rows 1-3 letterhead, 4 title, 5 headers, data from 6 (src/lib/excel.ts). */
export const EXCEL_HEADER_ROW = 5;
export function sheetRows(ws: ExcelJS.Worksheet) {
  const header = (ws.getRow(EXCEL_HEADER_ROW).values as unknown[]).slice(1).map(String);
  const rows: ExcelJS.Row[] = [];
  ws.eachRow((r, n) => { if (n > EXCEL_HEADER_ROW && r.getCell(1).value !== "Total" && r.getCell(1).value !== "Nothing here.") rows.push(r); });
  return { header, rows };
}

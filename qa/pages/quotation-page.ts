import { expect, type Page } from "@playwright/test";
import { AppShell } from "./app-shell";

export type QuoteRow = { product: string; company: string; plan: string; premium: string; sumInsured?: string; payMode?: string };

export class QuotationForm extends AppShell {
  constructor(page: Page) { super(page); }
  async goto(customerId: string) {
    await this.page.goto(`/quotations/new?customerId=${customerId}`);
    await expect(this.heading("New quotation")).toBeVisible();
  }
  row = (n: number) => this.page.locator("main table tbody tr").nth(n);
  product = (n: number) => this.row(n).getByLabel("Product");
  company = (n: number) => this.row(n).getByRole("combobox", { name: /^(Company|AMC)$/ });
  plan = (n: number) => this.row(n).getByRole("combobox", { name: /^(Plan|Scheme)$/ });
  payMode = (n: number) => this.row(n).getByRole("combobox", { name: /^(Pay mode|SIP or Lumpsum)$/ });
  amount = (n: number) => this.row(n).getByRole("textbox", { name: /^(Premium|Amount|Investment amount)$/ });
  async fillRow(n: number, r: QuoteRow) {
    await this.product(n).selectOption(r.product);
    await this.company(n).selectOption(r.company);
    await this.plan(n).selectOption(r.plan);
    if (r.payMode) await this.payMode(n).selectOption({ label: r.payMode });
    if (r.sumInsured) await this.row(n).getByLabel("Sum insured").fill(r.sumInsured);
    await this.amount(n).fill(r.premium);
  }
  /** Keeps only the first `count` product rows. */
  async keepRows(count: number) {
    while ((await this.page.locator("main table tbody tr").filter({ has: this.page.getByLabel("Product") }).count()) > count) {
      await this.page.locator("main table tbody tr").filter({ has: this.page.getByLabel("Product") }).last().getByRole("button", { name: "Remove" }).click();
    }
  }
  async save() {
    await this.page.getByRole("button", { name: "Save quotation" }).click();
    await this.confirmSave();
    await this.page.waitForURL(/\/quotations\/c/);
    return this.page.url().split("/").pop()!;
  }
}

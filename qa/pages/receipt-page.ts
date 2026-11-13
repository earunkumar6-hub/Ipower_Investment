import { expect, type Locator, type Page } from "@playwright/test";
import { AppShell } from "./app-shell";

/** New receipt (one customer) and Combined receipt forms, plus the cash denomination grid. */
export class ReceiptForm extends AppShell {
  constructor(page: Page) { super(page); }
  async gotoCustomer(customerId: string) {
    await this.page.goto(`/receipts/new?customerId=${customerId}`);
    await expect(this.heading("New receipt")).toBeVisible();
  }
  async gotoCombined() {
    await this.page.goto("/receipts/combined/new");
    await expect(this.page.getByLabel("Paid by")).toBeVisible();
  }
  dueBoxes = () => this.page.getByRole("checkbox", { name: /^Pay / });
  amount = () => this.page.getByLabel("Amount received (₹)");
  save = () => this.page.getByRole("button", { name: /^(Save (receipt|payment)|Generate one receipt)/ });
  mode = (name: string) => this.page.getByRole("button", { name, exact: true });

  /** The first note grid (received); `change` = the second grid that opens with "+ Change given back". */
  notes(grid: "received" | "change" = "received"): Record<string, Locator> {
    const i = grid === "received" ? 0 : 1;
    const box = (label: string) => this.page.getByLabel(label, { exact: true }).nth(i);
    return { 500: box("₹500 ×"), 200: box("₹200 ×"), 100: box("₹100 ×"), 50: box("₹50 ×"), 20: box("₹20 ×"), 10: box("₹10 ×"), coins: box("Coins ₹") };
  }
  /** Pays `rupees` in cash notes (₹500s, then ₹10s, then coins). */
  async payCash(rupees: number) {
    await this.mode("Cash").click();
    const n = this.notes();
    for (const box of Object.values(n)) await box.fill("");
    const fives = Math.floor(rupees / 500), tens = Math.floor((rupees % 500) / 10), coins = rupees % 10;
    if (fives) await n[500].fill(String(fives));
    if (tens) await n[10].fill(String(tens));
    if (coins) await n.coins.fill(String(coins));
  }
  async amountValue() {
    return Number((await this.amount().inputValue()).replace(/[^\d.]/g, ""));
  }
}

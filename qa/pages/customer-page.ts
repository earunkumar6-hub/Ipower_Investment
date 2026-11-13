import { expect, type Page } from "@playwright/test";
import { AppShell } from "./app-shell";

/** Partners / Customers list and the Customer 360 page. */
export class CustomersList extends AppShell {
  constructor(page: Page) { super(page); }
  async goto() { await this.open("/customers", "Partners / Customers"); }
  rows = () => this.page.getByRole("button", { name: /^Actions for / });
  async search(text: string) {
    await this.page.getByLabel("Search").fill(text);
    await this.page.getByRole("button", { name: "Search" }).click();
    await this.page.waitForURL(/[?&]q=/);
  }
}

export class CustomerPage extends AppShell {
  constructor(page: Page) { super(page); }
  async goto(id: string, name?: string) {
    await this.page.goto(`/customers/${id}`);
    if (name) await expect(this.page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  editDialog = () => this.page.getByRole("dialog").filter({ hasText: "Edit customer" });
  async openEdit() {
    await this.page.getByRole("button", { name: "Edit details" }).click();
    await expect(this.editDialog()).toBeVisible();
    return this.editDialog();
  }
  identityDialog = () => this.page.getByRole("dialog").filter({ hasText: "Aadhaar and PAN" });
  async openIdentity() {
    await this.page.getByRole("button", { name: /(Add|Change) Aadhaar \/ PAN/ }).click();
    await expect(this.identityDialog()).toBeVisible();
    return this.identityDialog();
  }
  /** Ticks consent (when not yet given), types the numbers and saves. */
  async saveIdentity({ pan, aadhaar }: { pan?: string; aadhaar?: string }) {
    const d = await this.openIdentity();
    const consent = d.getByRole("checkbox", { name: /Customer consent taken/ });
    if (await consent.isEnabled()) await consent.check();
    if (aadhaar !== undefined) await d.getByLabel("Aadhaar").fill(aadhaar);
    if (pan !== undefined) await d.getByLabel("PAN").fill(pan);
    await d.getByRole("button", { name: "Save" }).click();
    return d;
  }
  duplicateDialog = () => this.page.getByRole("dialog").filter({ hasText: /already belongs? to/ });
}

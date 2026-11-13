import { expect, type Page } from "@playwright/test";
import { AppShell } from "./app-shell";

export type LeadInput = { first: string; last?: string; mobile: string; dob?: string; gender?: string; source?: string; status?: string };

export class LeadsPage extends AppShell {
  constructor(page: Page) { super(page); }
  async goto() { await this.open("/leads", "Leads"); }
  dialog = () => this.page.getByRole("dialog").filter({ hasText: "New lead" });
  async openAdd() {
    await this.page.getByRole("button", { name: "Add lead" }).first().click();
    await expect(this.dialog()).toBeVisible();
    return this.dialog();
  }
  /** Fills the New lead form and submits (with the check-before-saving pop-up if shown). */
  async addLead(l: LeadInput) {
    const d = await this.openAdd();
    await d.getByLabel("First name").fill(l.first);
    if (l.last) await d.getByLabel("Last name").fill(l.last);
    await d.getByLabel("Date of birth").fill(l.dob ?? "15/06/1985");
    await d.getByLabel("Gender").selectOption({ label: l.gender ?? "Male" });
    await d.getByLabel("Mobile number 1").fill(l.mobile);
    // The dialog's Business type / Lead status share element ids with the page filters, so their labels point at the
    // filters and the dialog boxes have no accessible name (A11Y-01) – found by field name instead.
    await d.locator('select[name="source"]').selectOption({ label: l.source ?? "Walk-in" });
    await d.locator('select[name="status"]').selectOption({ label: l.status ?? "Interested" });
    await d.getByRole("button", { name: /Save lead/ }).click();
    const check = this.page.getByRole("dialog").filter({ hasText: "Check before saving" });
    if (await check.isVisible().catch(() => false)) await this.confirmSave();
    return d;
  }
}

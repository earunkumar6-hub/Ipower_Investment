import { expect, type Page } from "@playwright/test";
import { AppShell } from "./app-shell";

// The Raise ticket form's fields have no accessible names (A11Y-01), so they are found by their `name`.
export class TicketsPage extends AppShell {
  constructor(page: Page) { super(page); }
  async raise(t: { title: string; screen: string; type: string; priority: RegExp; details: string }) {
    await this.page.goto("/tickets/new");
    await expect(this.page.getByRole("heading", { name: "Raise ticket" })).toBeVisible();
    const form = this.page.locator("main form");
    await form.locator('[name="title"]').fill(t.title);
    await form.locator('[name="screen"]').selectOption({ label: t.screen });
    await form.locator('[name="type"]').selectOption({ label: t.type });
    const prio = await form.locator('[name="priority"] option').allInnerTexts();
    await form.locator('[name="priority"]').selectOption({ label: prio.find((p) => t.priority.test(p))! });
    await form.locator('[name="details"]').fill(t.details);
    await this.page.getByRole("button", { name: "Raise ticket" }).click();
  }
}

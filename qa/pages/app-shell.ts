import { expect, type Locator, type Page } from "@playwright/test";

/** Sidebar menu, page heading, header and the shared confirm / duplicate dialogs. */
export class AppShell {
  constructor(public page: Page) {}

  menu = () => this.page.getByRole("complementary");
  menuLink = (name: string | RegExp) => this.menu().getByRole("link", { name });
  heading = (name: string | RegExp) => this.page.getByRole("heading", { level: 1, name });
  signOut = () => this.page.getByRole("button", { name: "Sign out" });

  async open(path: string, heading?: string | RegExp) {
    await this.page.goto(path);
    if (heading) await expect(this.heading(heading)).toBeVisible();
  }

  /** "Check before saving" pop-up → "Yes, save". */
  async confirmSave() {
    const dialog = this.page.getByRole("dialog").filter({ hasText: "Check before saving" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /yes, save/i }).click();
    await expect(dialog).toBeHidden();
  }

  /** Toast or inline message. */
  message = (text: string | RegExp): Locator => this.page.getByText(text).first();

  async expectDenied() {
    await expect(this.page).toHaveURL(/\/dashboard\?denied=1/);
  }
}

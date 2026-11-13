import { expect, type Page } from "@playwright/test";
import { SEED_PASSWORD, USERS, type QaUser } from "../support/env";

export class LoginPage {
  constructor(private page: Page) {}

  username = () => this.page.getByLabel("Username");
  password = () => this.page.getByLabel("Password");
  signIn = () => this.page.getByRole("button", { name: /sign in/i });
  error = () => this.page.getByText(/failed|invalid|switched off|incorrect/i);

  async goto() {
    await this.page.goto("/login");
    await expect(this.username()).toBeVisible();
  }

  async submit(username: string, password: string) {
    await this.username().fill(username);
    await this.password().fill(password);
    await this.signIn().click();
  }

  /** Signs in and waits for the app (any page but /login). */
  async loginAs(user: QaUser, password = SEED_PASSWORD) {
    await this.goto();
    await this.submit(USERS[user].username, password);
    await this.page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(this.page.getByText(`Signed in as ${USERS[user].name}`)).toBeVisible();
  }
}

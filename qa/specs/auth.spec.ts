import { LoginPage } from "../pages/login-page";
import { resetDb, userId } from "../support/db";
import { SEED_PASSWORD } from "../support/env";
import { expect, newSignedInPage, stamp, test } from "../support/fixtures";

// Auth and roles: login / logout, session expiry, wrong password, role permissions, direct URLs.
test.beforeAll(async () => resetDb());

test.describe("Login and session", () => {
  test("[AUTH-01] sign in with a valid login", async ({ page, loginAs, shell }) => {
    await loginAs("admin");
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(shell.heading("Dashboard")).toBeVisible();
    await expect(page.getByText("Signed in as R. Murali (Admin)")).toBeVisible();
  });

  test("[AUTH-02] login page shows no demo users or password", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    const text = await page.locator("body").innerText();
    for (const s of ["superadmin", "arun", "divya", SEED_PASSWORD]) expect(text).not.toContain(s);
  });

  test("[AUTH-03] wrong password is refused", async ({ page, db }) => {
    const before = await db.session.count();
    const login = new LoginPage(page);
    await login.goto();
    await login.submit("admin", "wrong-password-1");
    await expect(page.getByText(/invalid|failed|incorrect/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    expect(await db.session.count()).toBe(before);
  });

  test("[AUTH-08] blank username and password do not sign in", async ({ page }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.signIn().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test("[AUTH-04] sign out ends the session", async ({ page, loginAs, shell }) => {
    await loginAs("arun");
    await shell.signOut().click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("[AUTH-06] a login lasts 1 hour of inactivity", async ({ loginAs, db }) => {
    await loginAs("divya");
    const s = await db.session.findFirstOrThrow({ where: { userId: await userId("divya") }, orderBy: { createdAt: "desc" } });
    const minutes = (s.expiresAt.getTime() - s.createdAt.getTime()) / 60_000;
    expect(Math.round(minutes)).toBe(60);
  });

  test("[AUTH-05] an expired session goes back to login", async ({ page, loginAs, db }) => {
    await loginAs("divya");
    const uid = await userId("divya");
    await db.session.updateMany({ where: { userId: uid }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    // The server redirects mid-navigation, which Playwright reports as ERR_ABORTED; where the page lands is what counts.
    await page.goto("/customers").catch(() => undefined);
    await expect(page).toHaveURL(/\/login/);
  });

  test("[AUTH-07] a switched-off login cannot sign in", async ({ page, db }) => {
    await db.user.update({ where: { username: "divya" }, data: { active: false } });
    try {
      const login = new LoginPage(page);
      await login.goto();
      await login.submit("divya", SEED_PASSWORD);
      await expect(page.getByText(/switched off/i)).toBeVisible();
      await expect(page).toHaveURL(/\/login/);
    } finally {
      await db.user.update({ where: { username: "divya" }, data: { active: true } });
    }
  });
});

test.describe("Roles – every staff member works on every customer, bill, receipt and expense (#10)", () => {
  test("[AUTH-20] a User sees all customers", async ({ page, loginAs, shell, db }) => {
    await loginAs("arun");
    await shell.open("/customers", "Partners / Customers");
    const total = await db.customer.count();
    await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(total);
  });

  test("[AUTH-21] a User opens and can edit another staff member's customer", async ({ page, loginAs, db }) => {
    const divyas = await db.customer.findFirstOrThrow({ where: { ownerId: await userId("divya") } });
    await loginAs("arun");
    await page.goto(`/customers/${divyas.id}`);
    await expect(page.getByRole("heading", { level: 2, name: divyas.name })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
  });

  test("[AUTH-22] a User sees receipts entered by others", async ({ page, loginAs, shell, db }) => {
    const other = await db.receipt.findFirstOrThrow({ where: { createdById: await userId("divya"), paymentId: null } });
    await loginAs("arun");
    await shell.open(`/receipts?q=&policyNo=`, "Receipts");
    await page.getByLabel("Policy / account no.").fill("");
    await expect(page.getByRole("cell", { name: other.receiptNo, exact: true })).toBeVisible();
  });

  test("[AUTH-23] a User sees expenses entered by others", async ({ page, loginAs, shell, db }) => {
    const other = await db.expense.findFirstOrThrow({ where: { NOT: { createdById: await userId("arun") } } });
    await loginAs("arun");
    await shell.open("/expenses", "Expenses");
    await expect(page.getByText(other.expenseNo, { exact: true })).toBeVisible();
  });

  test("[AUTH-29] leads stay own-only for Users", async ({ page, loginAs, shell, db }) => {
    const mine = await db.lead.count({ where: { ownerId: await userId("arun") } });
    await loginAs("arun");
    await shell.open("/leads", "Leads");
    await expect(page.locator("tbody tr")).toHaveCount(mine);
    await expect(page.getByRole("cell", { name: "Divya", exact: true })).toHaveCount(0);
  });
});

test.describe("Restricted pages by direct URL", () => {
  test("[AUTH-24] Admin and User cannot open Commission", async ({ page, loginAs, shell }) => {
    await loginAs("admin");
    await page.goto("/commission");
    await shell.expectDenied();
    const userPage = await newSignedInPage(page.context().browser()!, "arun");
    await userPage.goto("/commission");
    await expect(userPage).toHaveURL(/\/dashboard\?denied=1/);
    await userPage.context().close();
  });

  test("[AUTH-26] Commission is not in the menu but opens by URL for the Super Admin", async ({ page, loginAs, shell }) => {
    await loginAs("superadmin");
    await expect(shell.menuLink(/commission/i)).toHaveCount(0);
    await shell.open("/commission");
    await expect(page).toHaveURL(/\/commission/);
    await expect(page.getByRole("heading", { name: /commission/i }).first()).toBeVisible();
  });

  test("[AUTH-27] Profit & Loss is Super Admin only", async ({ page, loginAs, shell }) => {
    await loginAs("admin");
    await expect(shell.menuLink("Profit & Loss")).toHaveCount(0);
    await page.goto("/pnl");
    await shell.expectDenied();
    const owner = await newSignedInPage(page.context().browser()!, "superadmin");
    await owner.goto("/pnl");
    await expect(owner.getByRole("heading", { level: 1, name: /profit/i })).toBeVisible();
    await owner.context().close();
  });

  test("[AUTH-28] a User cannot open Settings → Users by URL", async ({ page, loginAs, shell }) => {
    await loginAs("arun");
    await page.goto("/settings/users");
    await shell.expectDenied();
  });

  test("[AUTH-25] a User has no Deactivate / delete on Renewals", async ({ page, loginAs, shell }) => {
    await loginAs("arun");
    await shell.open("/renewals", "Renewals");
    await expect(page.getByRole("button", { name: "Send reminder" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Deactivate / delete" })).toHaveCount(0);
  });
});

test.describe("Users (#30)", () => {
  test("[AUTH-30] the Super Admin adds another Super Admin who can sign in", async ({ page, loginAs, shell, db }) => {
    const u = `qa_sa_${stamp()}`;
    await loginAs("superadmin");
    await shell.open("/settings/users", "Settings");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add login" }) });
    await form.getByLabel("Name", { exact: true }).fill("QA Super Admin");
    await form.getByLabel("Username").fill(u);
    await form.getByLabel("Role", { exact: true }).selectOption({ label: "Super Admin" });
    await form.getByLabel("Password (at least 8 characters)").fill("qa-pass-123");
    await form.getByLabel("Password again").fill("qa-pass-123");
    await form.getByRole("button", { name: "Add login" }).click();
    await expect(page.getByRole("cell", { name: u })).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { username: u } })).role).toBe("SuperAdmin");

    const ctx = await page.context().browser()!.newContext();
    const p2 = await ctx.newPage();
    const login = new LoginPage(p2);
    await login.goto();
    await login.submit(u, "qa-pass-123");
    await expect(p2.getByText("Signed in as QA Super Admin (Super Admin)")).toBeVisible();
    await ctx.close();
  });

  test("[AUTH-31] a password shorter than 8 characters is refused", async ({ page, loginAs, shell, db }) => {
    const u = `qa_short_${stamp()}`;
    await loginAs("superadmin");
    await shell.open("/settings/users", "Settings");
    const form = page.locator("form").filter({ has: page.getByRole("button", { name: "Add login" }) });
    await form.getByLabel("Name", { exact: true }).fill("QA Short");
    await form.getByLabel("Username").fill(u);
    await form.getByLabel("Password (at least 8 characters)").fill("short12");
    await form.getByLabel("Password again").fill("short12");
    await form.getByRole("button", { name: "Add login" }).click();
    await expect(page.getByText(/at least 8/i).last()).toBeVisible();
    expect(await db.user.count({ where: { username: u } })).toBe(0);
  });
});

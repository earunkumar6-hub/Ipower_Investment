import { test as base, expect, type Browser, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";
import { AppShell } from "../pages/app-shell";
import { LoginPage } from "../pages/login-page";
import { qaDb } from "./db";
import type { QaUser } from "./env";

type Fixtures = {
  db: PrismaClient;
  shell: AppShell;
  /** Signs the page in as a seed user. */
  loginAs: (user: QaUser) => Promise<void>;
  /** A second, separately signed-in browser context (LAN: another PC). */
  otherUser: (user: QaUser) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  db: async ({}, use) => use(qaDb()),
  shell: async ({ page }, use) => use(new AppShell(page)),
  loginAs: async ({ page }, use) => use((user) => new LoginPage(page).loginAs(user)),
  otherUser: async ({ browser }, use) => {
    const pages: Page[] = [];
    await use(async (user) => {
      const p = await newSignedInPage(browser, user);
      pages.push(p);
      return p;
    });
    for (const p of pages) await p.context().close();
  },
});

export async function newSignedInPage(browser: Browser, user: QaUser) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
  const page = await ctx.newPage();
  await new LoginPage(page).loginAs(user);
  return page;
}

export { expect };

/** Unique suffix for data made by a test. */
export const stamp = () => `${Date.now()}`.slice(-6);

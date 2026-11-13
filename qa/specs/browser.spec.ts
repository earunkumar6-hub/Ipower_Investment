import { resetDb } from "../support/db";
import { expect, test } from "../support/fixtures";

// Browser check: runs in the browser-chrome-1366 / -1920 and browser-edge-1366 / -1920 projects (playwright.config.ts).
// Report IDs: XBR-01 Chrome 1366, XBR-02 Chrome 1920, XBR-03 Edge 1366, XBR-04 Edge 1920.
test.beforeAll(async () => resetDb());

const PAGES: [string, string | RegExp][] = [
  ["/dashboard", "Dashboard"], ["/customers", "Partners / Customers"], ["/renewals", "Renewals"], ["/receipts", "Receipts"],
  ["/leads", "Leads"], ["/quotations", "Quotations"], ["/daybook", "Day Book"], ["/expenses", "Expenses"], ["/tickets", "Tickets"],
];

test("[XBR] main screens render without errors or page-wide horizontal scroll", async ({ page, loginAs }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs("admin");
  const wide: string[] = [];
  for (const [path, heading] of PAGES) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) wide.push(`${path} (+${over}px)`);
  }
  const vp = page.viewportSize()!;
  await page.screenshot({ path: test.info().outputPath(`dashboard-${vp.width}x${vp.height}.png`) });
  expect(errors, "uncaught page errors").toEqual([]);
  expect(wide, `pages wider than the ${vp.width}px window: ${wide.join(", ")}`).toEqual([]);
});

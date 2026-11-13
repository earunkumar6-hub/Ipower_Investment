import type { Page } from "@playwright/test";
import { qaDb, resetDb, userId } from "../support/db";
import { expect, test } from "../support/fixtures";

// Volume: 2,000 customers and ~10,000 policies (with a bill each) in the TEST database, then page load times.
// Target < 3 s per page (measured after one warm-up load, so dev-server compilation is not counted).
// The dev server (next dev) is slower than a production build: a pass here is conservative.
const CUSTOMERS = 2000, POLICIES_PER_CUSTOMER = 5, LIMIT_MS = 3000;

test.describe.configure({ timeout: 600_000 });

test.beforeAll(async () => {
  test.setTimeout(600_000);
  await resetDb();
  const db = qaDb();
  if (await db.customer.count({ where: { id: "vol-c-0" } })) return; // already loaded (worker restarted after a failed test)
  const tenant = await db.tenant.findFirstOrThrow();
  const owners = [await userId("arun"), await userId("divya")];
  const now = Date.now();
  for (let start = 0; start < CUSTOMERS; start += 500) {
    const batch = Array.from({ length: Math.min(500, CUSTOMERS - start) }, (_, k) => {
      const i = start + k;
      return { id: `vol-c-${i}`, tenantId: tenant.id, name: `Vol Customer ${String(i).padStart(4, "0")}`, mobile: `7${String(100000000 + i)}`, ownerId: owners[i % 2] };
    });
    await db.customer.createMany({ data: batch });
  }
  const types = ["Insurance", "PoRd", "MutualFund", "PoTd", "Insurance"] as const;
  for (let start = 0; start < CUSTOMERS; start += 200) {
    const pols = [], bills = [];
    for (let i = start; i < Math.min(start + 200, CUSTOMERS); i++) {
      for (let j = 0; j < POLICIES_PER_CUSTOMER; j++) {
        const id = `vol-p-${i}-${j}`;
        const due = new Date(now + ((i * 7 + j * 3) % 120 - 30) * 86_400_000);
        pols.push({ id, tenantId: tenant.id, customerId: `vol-c-${i}`, productType: types[j], partner: j % 2 ? "Post Office" : "Vol Insurer", productName: `Vol Plan ${j}`,
          policyNumber: `VOL-${i}-${j}`, premiumAmount: 1000 + j * 250, frequency: types[j] === "PoRd" ? "Monthly" as const : "Yearly" as const,
          startDate: new Date(now - 400 * 86_400_000), ownerId: owners[i % 2] });
        bills.push({ tenantId: tenant.id, policyId: id, dueDate: new Date(due.toISOString().slice(0, 10)), premiumAmount: 1000 + j * 250,
          status: due.getTime() < now ? "Overdue" as const : "Due" as const, billNo: `VOL-B-${i}-${j}` });
      }
    }
    await db.policy.createMany({ data: pols });
    await db.renewalItem.createMany({ data: bills });
  }
});

test.afterAll(async () => {
  // Leave a normal-size test database behind.
  process.env.QA_RUN_ID = `${process.env.QA_RUN_ID}-after-volume`;
  await resetDb();
});

async function timed(page: Page, path: string, ready: () => Promise<unknown>) {
  await page.goto(path); // warm-up (compiles the route on the dev server)
  await ready();
  const t0 = Date.now();
  await page.goto(path);
  await ready();
  return Date.now() - t0;
}

const record = (name: string, ms: number) => test.info().annotations.push({ type: "timing", description: `${name}: ${ms} ms` });

test("[PERF-01] customer list with 2,000 customers", async ({ page, loginAs, db }) => {
  expect(await db.customer.count()).toBeGreaterThanOrEqual(CUSTOMERS);
  expect(await db.policy.count()).toBeGreaterThanOrEqual(CUSTOMERS * POLICIES_PER_CUSTOMER);
  await loginAs("admin");
  const ms = await timed(page, "/customers", () => page.getByRole("button", { name: /^Actions for / }).first().waitFor());
  record("/customers", ms);
  expect(ms).toBeLessThan(LIMIT_MS);
});

test("[PERF-02] customer search at volume", async ({ page, loginAs }) => {
  await loginAs("admin");
  const ms = await timed(page, "/customers?q=Vol%20Customer%2019", () => page.getByRole("button", { name: /^Actions for Vol Customer 19/ }).first().waitFor());
  record("search", ms);
  expect(ms).toBeLessThan(LIMIT_MS);
});

test("[PERF-03] renewals (next 30 days) at volume", async ({ page, loginAs }) => {
  await loginAs("admin");
  const ms = await timed(page, "/renewals?tab=due&range=next30", () => page.getByRole("button", { name: "Send reminder" }).first().waitFor());
  record("/renewals", ms);
  expect(ms).toBeLessThan(LIMIT_MS);
});

test("[PERF-04] receipts at volume", async ({ page, loginAs }) => {
  await loginAs("admin");
  const ms = await timed(page, "/receipts", () => page.getByRole("heading", { level: 1, name: "Receipts" }).waitFor());
  record("/receipts", ms);
  expect(ms).toBeLessThan(LIMIT_MS);
});

test("[PERF-05] dashboard at volume", async ({ page, loginAs }) => {
  await loginAs("superadmin");
  const ms = await timed(page, "/dashboard", () => page.getByRole("heading", { level: 2, name: /Renewals due this week/ }).waitFor());
  record("/dashboard", ms);
  expect(ms).toBeLessThan(LIMIT_MS);
});

test("[PERF-06] customer list Excel at volume", async ({ page, loginAs }) => {
  await loginAs("admin");
  await page.request.get("/api/export/customers"); // warm-up
  const t0 = Date.now();
  const res = await page.request.get("/api/export/customers");
  const ms = Date.now() - t0;
  record("customers.xlsx", ms);
  expect(res.status()).toBe(200);
  expect(ms).toBeLessThan(LIMIT_MS);
});

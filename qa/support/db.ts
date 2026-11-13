import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { assertTestDb, QA_DB_URL } from "./env";

const APP_DIR = path.resolve(__dirname, "../..");

let client: PrismaClient | undefined;
/** Prisma client bound to the QA test database only. */
export function qaDb() {
  client ??= new PrismaClient({ datasourceUrl: assertTestDb(QA_DB_URL) });
  return client;
}

/** Migrate (idempotent) the QA database. */
export function migrateQaDb() {
  execSync("pnpm exec prisma migrate deploy", { cwd: APP_DIR, stdio: "pipe", env: { ...process.env, DATABASE_URL: assertTestDb() } });
}

/**
 * Reset between suites: the seed script wipes every table and loads the demo agency again (≈5 s).
 * `quietCalls` moves open follow-up calls a few days ahead so the call-reminder pop-up does not cover the
 * screens of suites that are not about follow-ups.
 */
export async function resetDb({ quietCalls = true } = {}) {
  // A failed test restarts the Playwright worker, which runs the suite's beforeAll again. Reset each suite only once
  // per run (marker per spec file + run id from global setup), so later tests in the suite keep their data.
  const runId = process.env.QA_RUN_ID;
  const file = expectTestFile();
  if (runId && file) {
    const marker = path.join(APP_DIR, "qa/report/.resets", `${runId}-${file.replace(/[\\/:.]/g, "_")}`);
    if (existsSync(marker)) return;
    mkdirSync(path.dirname(marker), { recursive: true });
    writeFileSync(marker, new Date().toISOString());
  }
  execSync("pnpm exec prisma db seed", { cwd: APP_DIR, stdio: "pipe", env: { ...process.env, DATABASE_URL: assertTestDb() } });
  if (quietCalls) await qaDb().call.updateMany({ where: { outcome: null }, data: { dueAt: new Date(Date.now() + 3 * 86_400_000) } });
}

/** The spec file that is running (when called inside a test hook). */
function expectTestFile() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { test } = require("@playwright/test");
    return test.info().file as string;
  } catch {
    return undefined;
  }
}

export async function userId(username: string) {
  return (await qaDb().user.findUniqueOrThrow({ where: { username } })).id;
}

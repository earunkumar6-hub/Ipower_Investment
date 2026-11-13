import { migrateQaDb, qaDb, resetDb } from "./db";
import { assertTestDb } from "./env";

/** Before the run: make sure the target is the *_qa test database, migrate it and load the seed. */
export default async function globalSetup() {
  assertTestDb();
  process.env.QA_RUN_ID = `${Date.now()}`; // workers inherit it: each suite resets the DB once per run (support/db.ts)
  migrateQaDb();
  await resetDb();
  await qaDb().$disconnect();
}

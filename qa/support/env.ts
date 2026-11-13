// QA suite settings. The suite only ever talks to the separate test database `flcrm_qa`
// and to the QA copy of the app on port 3100 – never the dev / demo database `flcrm`.

export const QA_DB_URL = process.env.QA_DATABASE_URL ?? "postgresql://flcrm:flcrm@localhost:5433/flcrm_qa";
export const QA_PORT = Number(process.env.QA_PORT ?? 3100);
export const QA_BASE_URL = process.env.QA_BASE_URL ?? `http://localhost:${QA_PORT}`;
/** Seed users (prisma/seed.ts) – test-only accounts that exist only in the test database. */
export const SEED_PASSWORD = process.env.QA_PASSWORD ?? "demo1234";
export const USERS = {
  superadmin: { username: "superadmin", name: "Owner", role: "Super Admin" },
  admin: { username: "admin", name: "R. Murali", role: "Admin" },
  arun: { username: "arun", name: "Arun", role: "User" },
  divya: { username: "divya", name: "Divya", role: "User" },
} as const;
export type QaUser = keyof typeof USERS;

/** Refuses to run against anything but a database whose name ends in `_qa`. */
export function assertTestDb(url = QA_DB_URL) {
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!/_qa$/.test(name)) throw new Error(`QA suite refused: database "${name}" is not a *_qa test database`);
  return url;
}

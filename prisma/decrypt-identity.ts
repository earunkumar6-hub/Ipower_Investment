// One-off (owner decision, 24 Nov 2026: Aadhaar and PAN are stored in full): copies the numbers saved encrypted
// (aadhaarEnc / panEnc, AES-256-GCM with DATA_ENCRYPTION_KEY) into the plain columns aadhaarNo / panNo on customers and
// proposals. Safe to run again – only rows whose plain column is still empty are filled. Rows that never had a full
// number (older records with only the masked form) are left as they are.
//   pnpm tsx prisma/decrypt-identity.ts          (reads DATABASE_URL and DATA_ENCRYPTION_KEY from .env)
import { prisma } from "@/lib/db";
import { decryptJson } from "@/lib/crypto";

async function main() {
  const counts = { customers: 0, proposals: 0, failed: 0 };
  for (const table of ["customer", "proposal"] as const) {
    const model = prisma[table] as typeof prisma.customer; // same shape for the four columns used here
    const rows = await model.findMany({
      where: { OR: [{ aadhaarEnc: { not: null }, aadhaarNo: null }, { panEnc: { not: null }, panNo: null }] },
      select: { id: true, aadhaarEnc: true, aadhaarNo: true, panEnc: true, panNo: true },
    });
    for (const r of rows) {
      try {
        await model.update({
          where: { id: r.id },
          data: {
            ...(r.aadhaarEnc && !r.aadhaarNo && { aadhaarNo: decryptJson<string>(r.aadhaarEnc) }),
            ...(r.panEnc && !r.panNo && { panNo: decryptJson<string>(r.panEnc) }),
          },
        });
        counts[table === "customer" ? "customers" : "proposals"]++;
      } catch (e) {
        counts.failed++;
        console.error(`${table} ${r.id}: could not decrypt (${e instanceof Error ? e.message : e})`);
      }
    }
  }
  console.log(`Decrypted: ${counts.customers} customers, ${counts.proposals} proposals, ${counts.failed} failed.`);
}

main().finally(() => prisma.$disconnect());

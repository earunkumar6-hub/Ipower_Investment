-- Owner decision (24 Nov 2026): Aadhaar and PAN are stored and shown in full, and the same number may be on more than
-- one customer. New plain columns; the old encrypted / fingerprint columns stay (unused) until
-- prisma/decrypt-identity.ts has copied the existing values across.
ALTER TABLE "Customer" ADD COLUMN "aadhaarNo" TEXT, ADD COLUMN "panNo" TEXT;
ALTER TABLE "Proposal" ADD COLUMN "aadhaarNo" TEXT, ADD COLUMN "panNo" TEXT;
DROP INDEX "Customer_tenantId_aadhaarHash_key";
DROP INDEX "Customer_tenantId_panHash_key";

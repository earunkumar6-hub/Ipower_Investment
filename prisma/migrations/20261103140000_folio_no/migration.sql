-- Mutual fund folio number (owner, 3 Nov 2026). Not unique: several SIPs can share one folio.
ALTER TABLE "Proposal" ADD COLUMN "folioNo" TEXT;
ALTER TABLE "Policy" ADD COLUMN "folioNo" TEXT;

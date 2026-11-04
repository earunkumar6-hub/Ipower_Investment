-- Mutual fund SIP date (owner, 3 Nov 2026): day of the month the SIP is debited, 1–28. Bills fall on it.
ALTER TABLE "Proposal" ADD COLUMN "sipDay" INTEGER;
ALTER TABLE "Policy" ADD COLUMN "sipDay" INTEGER;

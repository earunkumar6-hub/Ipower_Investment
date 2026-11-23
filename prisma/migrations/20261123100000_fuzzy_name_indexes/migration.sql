-- Typo-tolerant name search (src/lib/fuzzy.ts): trigram indexes for the name columns that did not have one yet.
-- Customer.name already has one (20261113180000_performance_indexes). Created here only, like those: Prisma's schema
-- cannot express them, so "prisma migrate dev" may suggest dropping them – keep them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Lead_name_trgm_idx" ON "Lead" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Quotation_customerName_trgm_idx" ON "Quotation" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Proposal_customerName_trgm_idx" ON "Proposal" USING gin ("customerName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "Payment_payerName_trgm_idx" ON "Payment" USING gin ("payerName" gin_trgm_ops);

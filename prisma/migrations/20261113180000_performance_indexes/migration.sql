-- QA D-03 / D-04 (13 Nov 2026): indexes for 2,000 customers / 10,000 policies.
-- Ordinary indexes (also declared in schema.prisma):
CREATE INDEX "Policy_customerId_idx" ON "Policy"("customerId");
CREATE INDEX "Policy_tenantId_status_idx" ON "Policy"("tenantId", "status");
CREATE INDEX "MessageLog_tenantId_relatedType_relatedId_idx" ON "MessageLog"("tenantId", "relatedType", "relatedId");

-- Search boxes match anywhere inside names, mobiles and policy / folio numbers (ILIKE '%text%'), which a normal
-- index cannot serve. Trigram indexes (pg_trgm) can. Created here only: Prisma's schema cannot express them
-- without a preview feature, so "prisma migrate dev" may suggest dropping them – keep them.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX "CustomerMobile_number_trgm_idx" ON "CustomerMobile" USING gin ("number" gin_trgm_ops);
CREATE INDEX "Policy_policyNumber_trgm_idx" ON "Policy" USING gin ("policyNumber" gin_trgm_ops);
CREATE INDEX "Policy_folioNo_trgm_idx" ON "Policy" USING gin ("folioNo" gin_trgm_ops);

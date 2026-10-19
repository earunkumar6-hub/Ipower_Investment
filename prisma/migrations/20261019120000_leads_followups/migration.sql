-- Phase 2 (Oct 2026 round 2): lead fields, status Interested / Not interested / Call back, automatic stage,
-- business type, several mobiles per lead, follow-up calls for renewals and proposals.
-- Old lead data is mapped simply (owner decision D03/D04: real old leads are imported after go-live).

-- New enums
CREATE TYPE "LeadStage" AS ENUM ('Lead', 'Quotation', 'Proposal', 'Customer');
CREATE TYPE "Gender" AS ENUM ('Female', 'Male', 'Other');
ALTER TYPE "CallOutcome" ADD VALUE 'Done';

-- Lead columns; first / last name split from the full name
ALTER TABLE "Lead" ADD COLUMN "firstName" TEXT,
ADD COLUMN "gender" "Gender",
ADD COLUMN "lastName" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "referrerName" TEXT,
ADD COLUMN "stage" "LeadStage" NOT NULL DEFAULT 'Lead';
UPDATE "Lead" SET "firstName" = split_part(trim("name"), ' ', 1),
  "lastName" = NULLIF(trim(substr(trim("name"), length(split_part(trim("name"), ' ', 1)) + 1)), '');
ALTER TABLE "Lead" ALTER COLUMN "firstName" SET NOT NULL;

-- Stage from what already happened to the lead
UPDATE "Lead" l SET "stage" = 'Quotation' WHERE l."status"::text = 'Quoted' OR EXISTS (SELECT 1 FROM "Quotation" q WHERE q."leadId" = l."id");
UPDATE "Lead" l SET "stage" = 'Proposal' WHERE EXISTS (SELECT 1 FROM "Proposal" p JOIN "Quotation" q ON q."id" = p."quotationId" WHERE q."leadId" = l."id");
UPDATE "Lead" l SET "stage" = 'Customer' WHERE l."status"::text = 'Converted'
  OR EXISTS (SELECT 1 FROM "Proposal" p JOIN "Quotation" q ON q."id" = p."quotationId" WHERE q."leadId" = l."id" AND p."status" = 'Issued');

-- Business type: Partner and Call become Direct
CREATE TYPE "LeadSource_new" AS ENUM ('Direct', 'WalkIn', 'Referral', 'Website', 'SocialMedia');
ALTER TABLE "Lead" ALTER COLUMN "source" TYPE "LeadSource_new"
  USING (CASE "source"::text WHEN 'WalkIn' THEN 'WalkIn' WHEN 'Website' THEN 'Website' WHEN 'Referral' THEN 'Referral' ELSE 'Direct' END)::"LeadSource_new";
ALTER TYPE "LeadSource" RENAME TO "LeadSource_old";
ALTER TYPE "LeadSource_new" RENAME TO "LeadSource";
DROP TYPE "LeadSource_old";

-- Status: New / Call scheduled → Call back; Quoted / Converted → Interested (the stage keeps where they got to)
CREATE TYPE "LeadStatus_new" AS ENUM ('Interested', 'NotInterested', 'CallBack');
ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lead" ALTER COLUMN "status" TYPE "LeadStatus_new"
  USING (CASE "status"::text WHEN 'NotInterested' THEN 'NotInterested' WHEN 'Interested' THEN 'Interested'
    WHEN 'Quoted' THEN 'Interested' WHEN 'Converted' THEN 'Interested' ELSE 'CallBack' END)::"LeadStatus_new";
ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";
ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";
DROP TYPE "LeadStatus_old";
ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'CallBack';

-- Every mobile of a lead; existing leads get their one number
CREATE TABLE "LeadMobile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "isWhatsApp" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "LeadMobile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LeadMobile_leadId_idx" ON "LeadMobile"("leadId");
CREATE UNIQUE INDEX "LeadMobile_tenantId_number_key" ON "LeadMobile"("tenantId", "number");
ALTER TABLE "LeadMobile" ADD CONSTRAINT "LeadMobile_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "LeadMobile" ("id", "tenantId", "leadId", "number", "isWhatsApp", "sort")
  SELECT 'lm_' || "id", "tenantId", "id", "mobile", "onWhatsApp", 0 FROM "Lead";

-- Calls can be about a lead, a renewal (policy) or a proposal
ALTER TABLE "Call" DROP CONSTRAINT "Call_leadId_fkey";
ALTER TABLE "Call" ADD COLUMN "policyId" TEXT,
ADD COLUMN "proposalId" TEXT,
ALTER COLUMN "leadId" DROP NOT NULL;
ALTER TABLE "Call" ADD CONSTRAINT "Call_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Call" ADD CONSTRAINT "Call_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

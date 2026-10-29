-- No GST on insurance / investment quotes (owner, 29 Oct 2026).
-- Take the 18% back out of everything that was built from a quoted product, then drop the GST columns.
-- Only amounts that still equal the GST-inclusive quote total are changed (staff edits are kept).
-- Dues already paid (receipt or owner-paid slip) keep their amounts: that money was collected.

-- Unpaid dues of policies issued from a quote
UPDATE "RenewalItem" r SET "premiumAmount" = qi."premium"
FROM "Policy" po
JOIN "Proposal" pr ON pr."id" = po."proposalId"
JOIN "QuotationItem" qi ON qi."id" = pr."quotationItemId"
WHERE r."policyId" = po."id"
  AND r."status" IN ('Due', 'Overdue')
  AND r."paidReceiptId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "OwnerPaidSlip" s WHERE s."renewalItemId" = r."id")
  AND qi."gstAmount" > 0
  AND r."premiumAmount" = qi."total";

-- Policies issued from a quote
UPDATE "Policy" po SET "premiumAmount" = qi."premium"
FROM "Proposal" pr
JOIN "QuotationItem" qi ON qi."id" = pr."quotationItemId"
WHERE pr."id" = po."proposalId"
  AND qi."gstAmount" > 0
  AND po."premiumAmount" = qi."total";

-- Proposals (draft or issued) made from a quote
UPDATE "Proposal" pr SET "premium" = qi."premium"
FROM "QuotationItem" qi
WHERE qi."id" = pr."quotationItemId"
  AND qi."gstAmount" > 0
  AND pr."premium" = qi."total";

-- Quotes themselves
UPDATE "QuotationItem" SET "total" = "premium";
UPDATE "Quotation" SET "total" = "subtotal";

-- AlterTable
ALTER TABLE "Quotation" DROP COLUMN "gstTotal";

-- AlterTable
ALTER TABLE "QuotationItem" DROP COLUMN "gstAmount",
DROP COLUMN "gstRate";

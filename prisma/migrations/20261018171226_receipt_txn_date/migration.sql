-- Transaction date (when the customer actually paid). Existing receipts take their bill date.
ALTER TABLE "Receipt" ADD COLUMN "txnDate" DATE;
UPDATE "Receipt" SET "txnDate" = "receiptDate";
ALTER TABLE "Receipt" ALTER COLUMN "txnDate" SET NOT NULL;

-- CreateEnum
CREATE TYPE "VerifyStatus" AS ENUM ('Pending', 'Verified', 'Mismatch');

-- CreateEnum
CREATE TYPE "PayOptionKind" AS ENUM ('Mode', 'Bank');

-- AlterEnum
ALTER TYPE "PaymentMode" ADD VALUE 'NetBanking';

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'DirectBill';

-- AlterTable
ALTER TABLE "CompanyPayment" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifyNote" TEXT,
ADD COLUMN     "verifyStatus" "VerifyStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "denominations" JSONB;

-- AlterTable
ALTER TABLE "PoDeposit" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" TEXT,
ADD COLUMN     "verifyNote" TEXT,
ADD COLUMN     "verifyStatus" "VerifyStatus" NOT NULL DEFAULT 'Pending';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "denominations" JSONB;

-- BL- bill numbers: one sequence; existing dues numbered in due-date order, new ones by default.
CREATE SEQUENCE "bill_no_seq";
CREATE FUNCTION next_bill_no() RETURNS text LANGUAGE sql AS $$
  SELECT 'BL-' || lpad(v::text, greatest(4, length(v::text)), '0') FROM nextval('bill_no_seq') AS v
$$;
ALTER TABLE "RenewalItem" ADD COLUMN "billNo" TEXT;
UPDATE "RenewalItem" r SET "billNo" = 'BL-' || lpad(n.rn::text, greatest(4, length(n.rn::text)), '0')
FROM (SELECT id, row_number() OVER (ORDER BY "dueDate", id) AS rn FROM "RenewalItem") n WHERE n.id = r.id;
SELECT setval('bill_no_seq', greatest((SELECT count(*) FROM "RenewalItem"), 1), (SELECT count(*) FROM "RenewalItem") > 0);
ALTER TABLE "RenewalItem" ALTER COLUMN "billNo" SET DEFAULT next_bill_no(), ALTER COLUMN "billNo" SET NOT NULL;

-- CreateTable
CREATE TABLE "PaymentOption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "PayOptionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PaymentOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectBill" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billNo" TEXT NOT NULL,
    "billDate" DATE NOT NULL,
    "customerId" TEXT,
    "payerName" TEXT NOT NULL,
    "payerMobile" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "accountId" TEXT NOT NULL,
    "reference" TEXT,
    "bankName" TEXT,
    "denominations" JSONB,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'Saved',
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOption_tenantId_kind_name_key" ON "PaymentOption"("tenantId", "kind", "name");

-- CreateIndex
CREATE INDEX "DirectBill_tenantId_payerMobile_idx" ON "DirectBill"("tenantId", "payerMobile");

-- CreateIndex
CREATE UNIQUE INDEX "DirectBill_tenantId_billNo_key" ON "DirectBill"("tenantId", "billNo");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalItem_tenantId_billNo_key" ON "RenewalItem"("tenantId", "billNo");

-- AddForeignKey
ALTER TABLE "OwnerPaidSlip" ADD CONSTRAINT "OwnerPaidSlip_renewalItemId_fkey" FOREIGN KEY ("renewalItemId") REFERENCES "RenewalItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectBill" ADD CONSTRAINT "DirectBill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Default payment modes and net banking banks for every tenant (Settings → Payment modes).
INSERT INTO "PaymentOption" ("id", "tenantId", "kind", "name", "sort")
SELECT md5(random()::text || clock_timestamp()::text || t.id || o.name), t.id, o.kind::"PayOptionKind", o.name, o.sort
FROM "Tenant" t CROSS JOIN (VALUES
  ('Mode', 'Cash', 1), ('Mode', 'UPI', 2), ('Mode', 'NetBanking', 3), ('Mode', 'Cheque', 4), ('Mode', 'Card', 5),
  ('Bank', 'SBI', 1), ('Bank', 'HDFC', 2), ('Bank', 'IOB', 3), ('Bank', 'Indian Bank', 4), ('Bank', 'Canara Bank', 5),
  ('Bank', 'ICICI', 6), ('Bank', 'Axis', 7)
) AS o(kind, name, sort);

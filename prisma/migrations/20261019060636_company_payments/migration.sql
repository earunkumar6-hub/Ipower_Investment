-- AlterEnum
ALTER TYPE "EntryType" ADD VALUE 'PaidToCompany';

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'CompanyPayment';

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "companyPaymentId" TEXT;

-- CreateTable
CREATE TABLE "CompanyPayment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "paidOn" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyPayment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "RenewalItem" ADD CONSTRAINT "RenewalItem_paidReceiptId_fkey" FOREIGN KEY ("paidReceiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_companyPaymentId_fkey" FOREIGN KEY ("companyPaymentId") REFERENCES "CompanyPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

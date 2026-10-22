-- CreateEnum
CREATE TYPE "CommissionReceiptStatus" AS ENUM ('Saved', 'Cancelled');

-- CreateTable
CREATE TABLE "CommissionReceipt" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "forMonth" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "accountId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "receivedOn" DATE NOT NULL,
    "note" TEXT,
    "status" "CommissionReceiptStatus" NOT NULL DEFAULT 'Saved',
    "cancelReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionReceipt_tenantId_forMonth_idx" ON "CommissionReceipt"("tenantId", "forMonth");

-- AddForeignKey
ALTER TABLE "CommissionReceipt" ADD CONSTRAINT "CommissionReceipt_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


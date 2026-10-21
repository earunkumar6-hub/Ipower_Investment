-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('Customer', 'Combined', 'BillGroup');

-- DropForeignKey
ALTER TABLE "DirectBill" DROP CONSTRAINT "DirectBill_customerId_fkey";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "billGroupId" TEXT,
ADD COLUMN     "kind" "PaymentKind" NOT NULL DEFAULT 'Customer',
ADD COLUMN     "payerMobile" TEXT,
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "poReceiptNo" TEXT,
ALTER COLUMN "customerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BillGroup" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactMobile" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillGroupMember" (
    "id" TEXT NOT NULL,
    "billGroupId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillGroup_tenantId_name_key" ON "BillGroup"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BillGroupMember_policyId_key" ON "BillGroupMember"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "RenewalItem_policyId_dueDate_key" ON "RenewalItem"("policyId", "dueDate");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billGroupId_fkey" FOREIGN KEY ("billGroupId") REFERENCES "BillGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DirectBill" ADD CONSTRAINT "DirectBill_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillGroupMember" ADD CONSTRAINT "BillGroupMember_billGroupId_fkey" FOREIGN KEY ("billGroupId") REFERENCES "BillGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillGroupMember" ADD CONSTRAINT "BillGroupMember_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


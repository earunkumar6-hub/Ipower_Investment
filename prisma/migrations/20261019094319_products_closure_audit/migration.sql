-- CreateEnum
CREATE TYPE "InvoiceRule" AS ENUM ('UntilMaturity', 'UntilPremiumTerm', 'UntilClosed', 'None');

-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('Text', 'Number', 'Date', 'Dropdown');

-- AlterEnum
ALTER TYPE "EntryType" ADD VALUE 'OtherIncome';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PolicyStatus" ADD VALUE 'PrematureClosed';
ALTER TYPE "PolicyStatus" ADD VALUE 'Withdrawn';

-- AlterEnum
ALTER TYPE "RenewalStatus" ADD VALUE 'Stopped';

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "closeReason" TEXT,
ADD COLUMN     "closedOn" DATE,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "schemeId" TEXT;

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productType" "ProductType" NOT NULL,
    "partner" TEXT NOT NULL,
    "invoiceRule" "InvoiceRule" NOT NULL,
    "payModes" "Frequency"[],
    "lockInMonths" INTEGER,
    "bankDetailsRequired" BOOLEAN NOT NULL DEFAULT false,
    "bankFields" TEXT[],
    "prematureClosure" BOOLEAN NOT NULL DEFAULT true,
    "fields" TEXT[],
    "requiredFields" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scheme" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenureMonths" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scheme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemeRate" (
    "id" TEXT NOT NULL,
    "schemeId" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchemeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCustomField" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_partner_name_key" ON "Product"("tenantId", "partner", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Scheme_productId_name_key" ON "Scheme"("productId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SchemeRate_schemeId_effectiveFrom_key" ON "SchemeRate"("schemeId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCustomField_productId_label_key" ON "ProductCustomField"("productId", "label");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "Scheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scheme" ADD CONSTRAINT "Scheme_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemeRate" ADD CONSTRAINT "SchemeRate_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "Scheme"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductCustomField" ADD CONSTRAINT "ProductCustomField_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

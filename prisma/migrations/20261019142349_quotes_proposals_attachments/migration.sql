-- CreateEnum
CREATE TYPE "QuoteItemDecision" AS ENUM ('Pending', 'Selected', 'NotAccepted');

-- CreateEnum
CREATE TYPE "AttachmentOwner" AS ENUM ('Quotation', 'Proposal', 'Customer');

-- AlterEnum
ALTER TYPE "QuotationStatus" ADD VALUE 'NotAccepted';

-- DropForeignKey
ALTER TABLE "Proposal" DROP CONSTRAINT "Proposal_quotationId_fkey";

-- DropForeignKey
ALTER TABLE "Proposal" DROP CONSTRAINT "Proposal_quotationItemId_fkey";

-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "bankDetailsEnc" TEXT,
ADD COLUMN     "customValues" JSONB,
ADD COLUMN     "nominee" TEXT,
ADD COLUMN     "premiumPayingTermMonths" INTEGER,
ADD COLUMN     "rateAtOpen" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "bankDetailsEnc" TEXT,
ADD COLUMN     "customValues" JSONB,
ADD COLUMN     "frequency" "Frequency",
ADD COLUMN     "nominee" TEXT,
ADD COLUMN     "premiumPayingTermMonths" INTEGER,
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "productType" "ProductType" NOT NULL DEFAULT 'Insurance',
ADD COLUMN     "rateAtOpen" DECIMAL(5,2),
ADD COLUMN     "schemeId" TEXT,
ADD COLUMN     "startDate" DATE,
ADD COLUMN     "termMonths" INTEGER,
ALTER COLUMN "quotationId" DROP NOT NULL,
ALTER COLUMN "quotationItemId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "deleteReason" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "notAcceptedReason" TEXT;

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "decision" "QuoteItemDecision" NOT NULL DEFAULT 'Pending',
ADD COLUMN     "payMode" "Frequency" NOT NULL DEFAULT 'Yearly';

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ownerType" "AttachmentOwner" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attachment_ownerType_ownerId_idx" ON "Attachment"("ownerType", "ownerId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "QuotationItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_schemeId_fkey" FOREIGN KEY ("schemeId") REFERENCES "Scheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Products that already have a proposal were selected by the customer
UPDATE "QuotationItem" SET "decision" = 'Selected' WHERE "id" IN (SELECT "quotationItemId" FROM "Proposal" WHERE "quotationItemId" IS NOT NULL);

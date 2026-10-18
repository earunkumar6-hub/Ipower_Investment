-- DropIndex
DROP INDEX "Proposal_quotationId_key";

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "quotationItemId" TEXT NOT NULL,
ADD COLUMN     "sumInsured" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "category" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_quotationItemId_key" ON "Proposal"("quotationItemId");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_quotationItemId_fkey" FOREIGN KEY ("quotationItemId") REFERENCES "QuotationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


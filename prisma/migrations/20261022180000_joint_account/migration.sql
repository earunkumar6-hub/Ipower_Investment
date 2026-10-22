-- AlterTable
ALTER TABLE "Policy" ADD COLUMN     "secondHolderId" TEXT;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "jointAccount" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "secondHolderId" TEXT,
ADD COLUMN     "secondHolderMobile" TEXT,
ADD COLUMN     "secondHolderName" TEXT;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_secondHolderId_fkey" FOREIGN KEY ("secondHolderId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_secondHolderId_fkey" FOREIGN KEY ("secondHolderId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;


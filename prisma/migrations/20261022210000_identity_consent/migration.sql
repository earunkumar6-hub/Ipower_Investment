-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "aadhaarEnc" TEXT,
ADD COLUMN     "aadhaarHash" TEXT,
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentById" TEXT,
ADD COLUMN     "panEnc" TEXT,
ADD COLUMN     "panHash" TEXT;

-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "aadhaarEnc" TEXT,
ADD COLUMN     "aadhaarHash" TEXT,
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentById" TEXT,
ADD COLUMN     "panEnc" TEXT,
ADD COLUMN     "panHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_aadhaarHash_key" ON "Customer"("tenantId", "aadhaarHash");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_tenantId_panHash_key" ON "Customer"("tenantId", "panHash");


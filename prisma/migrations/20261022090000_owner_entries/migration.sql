-- CreateEnum
CREATE TYPE "OwnerEntryKind" AS ENUM ('Withdrawal', 'Contribution');

-- CreateEnum
CREATE TYPE "OwnerEntryStatus" AS ENUM ('Pending', 'Confirmed', 'Rejected');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "EntryType" ADD VALUE 'OwnerWithdrawal';
ALTER TYPE "EntryType" ADD VALUE 'OwnerContribution';

-- AlterEnum
ALTER TYPE "SourceType" ADD VALUE 'OwnerEntry';

-- CreateTable
CREATE TABLE "OwnerEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "OwnerEntryKind" NOT NULL,
    "entryDate" DATE NOT NULL,
    "accountId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "reference" TEXT,
    "reason" TEXT NOT NULL,
    "denominations" JSONB,
    "status" "OwnerEntryStatus" NOT NULL DEFAULT 'Pending',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerEntry_tenantId_entryDate_idx" ON "OwnerEntry"("tenantId", "entryDate");

-- AddForeignKey
ALTER TABLE "OwnerEntry" ADD CONSTRAINT "OwnerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('Savings', 'Current');

-- CreateEnum
CREATE TYPE "WalletKind" AS ENUM ('CSC', 'ESevai', 'Other');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "accountKind" "BankAccountKind",
ADD COLUMN     "accountNoEnc" TEXT,
ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "branch" TEXT,
ADD COLUMN     "ifsc" TEXT,
ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "micr" TEXT,
ADD COLUMN     "walletKind" "WalletKind";

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "closeDuringLockIn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "dayCloseGraceDays" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "DropdownOption" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "list" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "addedByStaff" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DropdownOption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DropdownOption_tenantId_list_idx" ON "DropdownOption"("tenantId", "list");

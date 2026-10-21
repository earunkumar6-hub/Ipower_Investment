-- AlterTable
ALTER TABLE "DirectBill" ADD COLUMN     "netType" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "netType" TEXT;

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "netType" TEXT;

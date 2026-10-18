-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "address" TEXT,
ADD COLUMN     "dob" DATE,
ADD COLUMN     "onWhatsApp" BOOLEAN NOT NULL DEFAULT false;
